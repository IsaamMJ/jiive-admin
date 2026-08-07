# Handoff → jiive-backend — the 50-message bug is a pattern, not an incident

**Date:** 2026-08-07
**From:** jiive-admin (frontend)
**Follows:** `handoff-backend-user-detail-pagination.md` (which you shipped — thank you, the envelope
is exactly right and is the reason this document is short)

After this morning's fix we swept both codebases for the same defect. It is not one endpoint. Below
is everything, verified live, with the frontend half already fixed on our side.

---

## The shape

**A list is capped, the cap is not disclosed, and a page count is returned or rendered as a total.**

The two sub-forms, in order of how much damage they do:

1. **A fake total** — `count: rows.length` computed *after* a `take`. Reads as authoritative, is not.
2. **No total at all** — a bare array, or an envelope missing `total`. At least this one is honestly silent.

Your `memory-readback.service.ts:123` gets it right and is worth copying: it caps `facts` but computes
`counts.total` independently, with a comment at `:46` citing the 30-day-dormancy incident as why.

---

## 1. Orphan lab reports evict patients — HIGHEST PRIORITY

This is the only finding in this document with a patient behind it.

`admin/orphan-report.service.ts:242` takes the **200 newest** `REPORT_FULL` webhook events
(`orderBy: createdAt desc`), then filters to unadopted ones **in JS at :296-373**.

The cap is applied to the *unfiltered* event stream. The orphan filter runs after. So:

> **Successfully adopted orders evict un-adopted ones.** Healthy throughput is the mechanism that
> pushes a patient who gave blood and never received a result off the only screen that can rescue them.

Two things sharpen it:

- **The limit is not caller-controllable.** `admin.controller.ts:3332` calls `listOrphanReports()`
  with no argument, so it is always the default 200. We cannot widen it from the frontend.
- **The file's own comments promise the opposite.** `:237` *"If the roster lookup fails, the order is
  KEPT"*. `:326` *"Fail toward VISIBLE"*. `:340` *"never hide a patient"*. All three guarantees live
  **inside the loop** — downstream of the cap that already dropped the row. The one failure direction
  they don't guard is the only permanent one.

Prod today: 7 orphan orders, 19 completed bookings. At roughly 1 `REPORT_FULL` per completed draw,
the window fills at ~10× current volume.

**Fix:** filter on unadopted-ness **before** the take, or return an uncapped total alongside so the
UI can say "7 shown, N total". We'd prefer the former — a count doesn't help if the row itself is
gone.

---

## 2. Fake totals — these rank above missing ones

| Endpoint | Source | Ceiling | The lie |
|---|---|---|---|
| `GET /bookings/stuck` | `admin.controller.ts:2233` | 300 (200+50+50) | `count: bookings.length`, post-cap. **This is the money worklist**, and a payment-webhook outage is exactly what pushes it past 200 — so the number becomes unreliable precisely when it matters. |
| `GET /incidents/actions/open` | `incident.service.ts:978` | 200 (max 500) | `openCount: actions.length`, post-cap — while `completionRate` in the **same response** is computed from real uncapped `count()` calls. Two numbers, one payload, same collection, derived differently. |

`incidents/rca-owed` does this correctly with a dedicated count endpoint. That's the pattern.

---

## 3. Caps with no total

| Endpoint | Cap | Note |
|---|---|---|
| `GET /results` | 200, `admin.controller.ts:2949` | Bare `{results:[]}`. **No `offset` param exists**, so result #201 is unreachable *and* unknowable. Grows one row per completed booking, forever, and holds clinical data. |
| `GET /users/:id` aggregate | 50 conversations, 20 credit tx | Still live and correct to leave — see §6. |
| `GET /conversations?phone=` | `min(limit\|\|100, 500)`, `:706-778` | See §4 — worse than a cap. |
| `GET /rag/overview` | 500, `:190` | |
| `rag-document.service.ts:1260` | 200 | Internal conflict detection silently misses candidates past 200. |
| `incident-sweep.service.ts:126` | 50 | Truncates the overdue-RCA alert email. |
| `llm-playground` patients / conversations | 200 | Bare arrays. Server logs the dropped count and never tells the client. |

---

## 4. `GET /conversations?phone=` returns the OLDEST messages

`orderBy: { createdAt: 'asc' }` at `admin.controller.ts:730`.

Verified on prod, user `5087e500-5713-4a0d-86d3-5f861eac8627` (117 messages):

```
GET /conversations?phone=919489601444&limit=100
  → returns 2026-06-20T11:03 … 2026-06-24T03:59
  actual newest message: 2026-06-26T15:54
```

**Recent messages are unreachable at any limit.** Our console doesn't call this endpoint, so it never
surfaced — but it is the one the founder reaches for when he curls to read a conversation, which is
exactly the access path that started this whole workstream.

**Fix:** `desc`, or paginate it like the tab endpoint. If anything depends on ascending order, please
say so rather than us guessing.

---

## 5. Unbounded queries worth attention

90 of 148 `findMany` calls have no `take`. Most are correctly scoped to one entity with single-digit
cardinality — not worth touching. These are the ones that aren't:

**Whole-table scans, operator-facing:**
- `incidents/call.service.ts:640` — `GET /calls/stats` loads the entire `callLog` table when no date range is given
- `incidents/feedback.service.ts:338` — `GET /feedback/export` concatenates every feedback dump ever into one in-memory CSV
- `incidents/incident.service.ts:1046` — `GET /incidents/stats`, whole table, aggregated in JS
- `rag-document.service.ts:1326` — `GET /rag/version`, whole ready-doc collection, per call, uncached
- `admin.controller.ts:3730` — `/bookings/:id/webhook-timeline`, `dedupKey: { contains }` — leading wildcard, cannot use the unique index, full scan per expansion

**One real cron bug:**
- **`incidents/incident-sweep.service.ts:240`** — `scrubExpiredCallNotes`, hourly, loads **every**
  un-scrubbed callLog older than 12 months before its `updateMany`. **No `MAX_PER_RUN`**, unlike the
  nine sibling sweeps that have one. It fails on its first run against a real retention backlog, and
  silently.

---

## 6. Two dead tables — delete rather than scale

- **`notification`** — **zero writers** anywhere in `src/`. Only `deleteMany` in the purge paths.
- **`whatsappTemplateSent`** — one writer (`lumi/whatsapp/whatsapp.service.ts:176`), **zero readers**.
  ADR 0007 moved templates into `lumiConversation` and dropped the merge (`admin.controller.ts:726-728`).
  Write-only, grows per template sent, never read.

---

## 7. Missing indexes on columns every list sorts by

- **`users.last_whatsapp_activity`** — the `User` model carries **no `@@index` at all**
  (`schema.prisma:13-95`), yet `GET /users` sorts on this column on every load.
- **`bookings.created_at`** — `:268-271` has `[userId,status]`, `[thyrocareOrderId]`,
  `[appointmentDate]`, `[paymentBatchId]` but not `created_at`, which is the default sort.

Both confirmed absent from `prisma/migrations/` as well, so this isn't schema drift. Not urgent at
current volume — flagging so it's a decision rather than an oversight.

---

## 8. `GET /bookings` clamps silently

`Math.min(parseInt(limit || '50'), 200)` at `:2032` is a **clamp, not a 400**.

Three of our callers asked for 500 and got 200 with no error. One is the incident order picker over a
210-day window: on dev, **293 of 493 bookings were invisible**, so an operator filing an incident
could not select the affected order.

That is our bug and we've fixed it — we now page with `offset` to completeness (verified: 200+200+94
= 494 unique, matching `total`).

We mention it only because **your `/users/:id/conversations` endpoint 400s on an out-of-range limit,
and that is the better behaviour.** A silent clamp is indistinguishable from success. Worth making
`/bookings` consistent with the newer endpoints when it's cheap.

---

## What we fixed on our side

So you don't duplicate: incident order picker and suspected-incidents panel now page to completeness;
day-view stat tiles no longer computed from a truncated array and now state their scope; `/calls/queue`
renders the real `total` you were already sending; `/results`, `/rag/documents` and the playground
picker now say what they're showing instead of implying completeness; the per-user Bookings and
Results tabs are wired to your new paginated endpoints.

## Suggested order

**1 first** — it's the only one with a patient behind it, and the eviction is permanent.
**2 next** — fake totals read as authoritative and one of them is the money worklist.
**4** is a one-word fix with an outsized effect on how the founder actually works.
**6** is deletion, which is free.
The rest are real but bounded.

Questions to isaamm@jiive.ai.
