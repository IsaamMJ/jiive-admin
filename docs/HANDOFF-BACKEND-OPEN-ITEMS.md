# Handoff → jiive-backend — everything still open, in one place

**Date:** 2026-08-07
**From:** jiive-admin (frontend)
**Supersedes for forwarding purposes:** `handoff-backend-truncation-sweep.md`,
`handoff-backend-identity-mismatch-sweep.md` (items 7–8),
`handoff-backend-server-timeout-parked-as-permanent.md`.
Those three still hold the long-form detail; this is the single document to work from.

Everything below was **verified live against prod on 2026-08-07**, read-only. Where something is
already fixed on our side, it says so, so you don't duplicate work.

---

## Priority order

| # | Item | Why it's first | Status |
|---|---|---|---|
| 1 | Orphan lab reports evict patients | A patient who gave blood and got no result disappears permanently | Open |
| 2 | `elevatedFlag` is a false all-clear on **7 of 17 live prod results** | Clinical signal, wrong today | Open — deferred on reasoning that doesn't hold |
| 3 | `SERVER_TIMEOUT` parked as permanent | Strands lab results silently | Open |
| 4 | Fake counts on the money worklist | The number lies exactly when it matters | Open |
| 5 | `GET /conversations?phone=` returns the OLDEST messages | One word; it's the founder's read path | Open |
| 6 | Bio-age computed for minors | Needs a product decision, not code | Open |
| 7 | Two dead tables, missing indexes, unbounded queries | Housekeeping with real fuses | Open |

---

# 1. Orphan lab reports evict patients — HIGHEST

`admin/orphan-report.service.ts:242` takes the **200 newest** `REPORT_FULL` webhook events
(`orderBy: createdAt desc`), then filters to unadopted ones **in JS at :296-373**.

The cap is applied to the *unfiltered* event stream; the orphan filter runs after. So:

> **Successfully adopted orders evict un-adopted ones.** Healthy throughput is the mechanism that
> pushes a patient who gave blood and never received a result off the only screen that can rescue them.

- **The limit is not caller-controllable** — `admin.controller.ts:3332` calls `listOrphanReports()`
  with no argument, so it is always the default 200. We cannot widen it from the frontend.
- **The file's own comments promise the opposite**: `:237` *"the order is KEPT"*, `:326` *"Fail toward
  VISIBLE"*, `:340` *"never hide a patient"* — all three live **inside the loop**, downstream of the
  cap that already dropped the row. The one failure direction they don't guard is the only permanent one.

Prod today: 7 orphan orders, 19 completed bookings. At ~1 `REPORT_FULL` per completed draw the window
fills at roughly 10× current volume.

**Fix:** filter on unadopted-ness **before** the take, or return an uncapped total so the UI can say
"7 shown, N total". We'd prefer the former — a count doesn't help once the row is gone.

---

# 2. `elevatedFlag` is a false clinical all-clear — 7 of 17 live prod results

**You deferred this** (item 7 of the identity sweep) on the grounds that *"runtime risk today is zero:
every reader filters status=COMPLETED and can never fetch a failed row."*

**That reasoning doesn't hold. The false all-clear is ON completed rows.** Filtering to
`status = COMPLETED` does not avoid it — it selects for it.

A run completes normally on a panel that doesn't carry all 9 PhenoAge markers. It stores the
biomarkers it got and leaves `calculatedAge` and `ageDelta` null — both correctly nullable. But
`elevatedFlag` cannot be null, so it stays at its `@default(false)`.

**Verified live on prod, 2026-08-07 — 7 of 17 results:**

```
patientName            status      calculatedAge   ageDelta   elevatedFlag
Juveira Abdulhameed    completed   null            null       false
Alfanniah              completed   null            null       false
Mohamed Jahir  (x5)    completed   null            null       false
```

Every one was rendering **"Elevated: No"** in the admin. That was ours and is fixed — we now gate on
`calculatedAge != null` and say *"Not calculated — this panel is missing some of the 9 markers"*.

**But we can only fix what we render.** Any other consumer of `elevatedFlag` — the customer results
page, notifications, Lumi's context, the AI suggestion input — reads the same confident `false`.
**Please check those.**

**Fix:** make `elevatedFlag` nullable and set it only when a bio-age was actually computed. Also stop
writing `chronologicalAge: 0` on the failure path (`results-pipeline.service.ts:628-650`) — `0` is not
a safer placeholder than null, it's a more convincing one.

---

# 3. A Thyrocare `SERVER_TIMEOUT` is parked as a permanent failure

Order `VLC5D31A`, lead `SP86410123` — **Juveira A H, 22**, collected 2026-08-04. Your alert:

```
REPORT_FULL retry for order VLC5D31A hit a permanent error:
No booking found for Thyrocare orderId VLC5D31A. Parked (no further retries).
```

The live payload contradicted itself:

```jsonc
reportAvailable: false
reportDiagnostic: {
  httpStatus: 500,
  vendorBody: "{\"errors\":[{\"code\":\"SERVER_TIMEOUT\",\"message\":\"EXECUTION TIMEOUT EXPIRED…\"}]}",
  ourSide: false,
  retryable: false        // ← the bug
}
patients: [{ name: "Juveira A H", isReportAvailable: true, adopted: false }]   // ← report EXISTS
```

`SERVER_TIMEOUT` is the canonical *retryable* error. Thyrocare didn't say the order was unknown — it
said it ran out of time. `ourSide` answers *whose network leg failed*, not *does this order exist*,
and the retry decision is being made from it. One slow response from the lab permanently strands a
paying customer's result.

Juveira has since been linked manually (booking `2410df91`), and Thyrocare recovered on its own —
which is the proof it was transient.

**Fix:**
1. Treat `httpStatus >= 500` and timeout bodies as retryable. Reserve `retryable: false` for a
   definitive `404 / DATA_NOT_FOUND`.
2. **Check whether the REPORT_FULL webhook retry path shares this logic** — if so, every transient lab
   outage is silently converting into permanently stranded results across all orders.
3. Reconcile the two signals in your own payload: `patients[].isReportAvailable: true` alongside
   `reportAvailable: false` means the report exists and the fetch failed. That's a retry signal you
   already have and aren't using.

**Note:** we now derive retryability from `httpStatus` and `vendorBody` and treat your `retryable` as
advisory, because it was demonstrably wrong here. We'd rather go back to trusting one authoritative
field — tell us when it's fixed.

---

# 4. Fake counts — these rank above missing ones, because they read as authoritative

| Endpoint | Source | Ceiling | The lie |
|---|---|---|---|
| `GET /bookings/stuck` | `admin.controller.ts:2233` | 300 (200+50+50) | `count: bookings.length`, post-cap. **This is the money worklist** — and a payment-webhook outage is exactly what pushes it past 200, so the number becomes unreliable precisely when it matters most. |
| `GET /incidents/actions/open` | `incident.service.ts:978` | 200 (max 500) | `openCount: actions.length`, post-cap — while `completionRate` in the **same response** comes from real uncapped `count()` calls. Two numbers, one payload, same collection, derived differently. |

`incidents/rca-owed` does this correctly with a dedicated count endpoint. That's the pattern.

**Caps with no total at all** (honestly silent, still a dead end):
`GET /results` — 200, `admin.controller.ts:2949`, bare `{results:[]}`, **and no `offset` param exists**,
so result #201 is unreachable *and* unknowable. Grows one row per completed booking, forever, and holds
clinical data. Also: `/users/:id` aggregate (50 conversations, 20 credit tx), `/rag/overview` (500),
`rag-document.service.ts:1260` (200 — internal conflict detection silently misses candidates),
`incident-sweep.service.ts:126` (50 — truncates the overdue-RCA alert email), llm-playground patients
and conversations (200, bare arrays; the server logs the dropped count and never tells the client).

---

# 5. `GET /conversations?phone=` returns the OLDEST messages

`orderBy: { createdAt: 'asc' }` at `admin.controller.ts:730`. Verified on prod, user
`5087e500-5713-4a0d-86d3-5f861eac8627` (117 messages):

```
GET /conversations?phone=919489601444&limit=100
  → returns 2026-06-20T11:03 … 2026-06-24T03:59
  actual newest message: 2026-06-26T15:54
```

**Recent messages are unreachable at any limit.** Our console doesn't call this endpoint — but it's the
one the founder curls to read a conversation, which is the access path that started this whole
workstream.

**Fix:** `desc`, or paginate it like the tab endpoint. If something depends on ascending order, say so
rather than us guessing.

---

# 6. Bio-age is computed for minors, and the AI consumes it

Live on prod, result `13b6bc3c…` — Hafsah Abdulhameed:

```
chronologicalAge: 14      calculatedAge: 5.0      ageDelta: -9
GET /llm-playground/patients/by-patient/7b757eca-…  → 200
  label: "female · 10–19 · bio-age 5.0"
```

A bio-age of 5 for a 14-year-old isn't a wrong number, it's an out-of-domain one — PhenoAge (Levine
2018) is fitted on NHANES **adults**. We found no lower age bound in `results/phenoage.service.ts` or
`thyrocare/results-pipeline.service.ts`; `overflowCapped` guards the top of the exponent, nothing
guards the bottom of the age domain. Correct us if there's a guard elsewhere.

It's now deep-linked into the LLM playground as patient context, so an operator asking the AI about
this patient gets reasoning built on a biological age of 5. It is presumably also on the
customer-facing results page.

**This needs a decision, not a patch:** the minimum age at which PhenoAge is reported at all. Below it,
produce no bio-age rather than an out-of-domain one — `calculatedAge`/`ageDelta` null plus a reason,
which our frontend already renders correctly as "—". A number that cannot be right is worse than a
blank, especially one a parent will read.

---

# 7. Housekeeping with real fuses

**Two dead tables — delete rather than scale:**
- `notification` — **zero writers** anywhere in `src/`; only `deleteMany` in the purge paths.
- `whatsappTemplateSent` — one writer (`lumi/whatsapp/whatsapp.service.ts:176`), **zero readers**.
  ADR 0007 moved templates into `lumiConversation` and dropped the merge (`admin.controller.ts:726-728`).
  Write-only, grows per template sent, never read.

**One real cron bug:** `incidents/incident-sweep.service.ts:240` — `scrubExpiredCallNotes`, hourly,
loads **every** un-scrubbed callLog older than 12 months before its `updateMany`. **No `MAX_PER_RUN`**,
unlike the nine sibling sweeps that have one. It fails on its first run against a real retention
backlog, silently.

**Whole-table scans, operator-facing:** `call.service.ts:640` (`/calls/stats`, entire callLog when no
date range), `feedback.service.ts:338` (`/feedback/export`, every dump ever into one in-memory CSV),
`incident.service.ts:1046` (`/incidents/stats`), `rag-document.service.ts:1326` (`/rag/version`, whole
collection per call, uncached), `admin.controller.ts:3730` (`/bookings/:id/webhook-timeline`, `contains`
with a leading wildcard — cannot use the unique index).

**Missing indexes on columns every list sorts by:** `users.last_whatsapp_activity` — the `User` model
has **no `@@index` at all** (`schema.prisma:13-95`) yet `GET /users` sorts on it every load.
`bookings.created_at` — `:268-271` covers `[userId,status]`, `[thyrocareOrderId]`, `[appointmentDate]`,
`[paymentBatchId]` but not the default sort column. Both confirmed absent from `prisma/migrations/`
too, so this is a decision rather than drift. Not urgent at current volume.

**`GET /bookings` clamps silently:** `Math.min(parseInt(limit || '50'), 200)` at `:2032` is a clamp,
not a 400. Three of our callers asked for 500 and got 200 with no error — one was the incident order
picker, where **293 of 493 bookings were invisible** and an operator filing an incident could not
select the affected order. That was ours and is fixed (we now page with `offset` to completeness).
We raise it only because **your `/users/:id/conversations` 400s on an out-of-range limit, and that is
the better behaviour** — a silent clamp is indistinguishable from success.

---

## What we've already fixed on our side

Conversations tab paginated (all 117 messages of your biggest customer reachable); incident order
picker and suspected-incidents panel page to completeness; day-view stat tiles no longer computed from
a truncated array and now state their scope; `/calls/queue` renders the real `total` you were already
sending; `/results`, `/rag/documents` and the playground picker say what they're showing; per-user
Bookings and Results tabs wired to your paginated endpoints; failed and no-bio-age results no longer
render a clinical all-clear; vendor timeouts no longer reported as "this order never existed".

## The shape underneath all of it

Every item here is one of two things: **a value that means one thing where it's written and another
where it's read** (`ourSide`, `elevatedFlag`, `retryable`), or **a page count standing in for a total**.
Your `{ items, total, hasMore, nextCursor }` envelope killed the second class for three endpoints in a
morning. The list of endpoints still returning a bare array is exactly the list of things still able to
lie.

Questions to isaamm@jiive.ai.
