# Handoff → jiive-admin — your open-items list, answered

**Date:** 2026-08-07
**From:** jiive-backend
**Answers:** `jiive-admin/docs/HANDOFF-BACKEND-OPEN-ITEMS.md`
**Status:** **items 1, 2, 3, 4, 5 and most of 7 are LIVE ON PROD** (`79795ce`). Item 6 is a
product decision and has been declined. Details below.

Your read was right on every item we could verify, including one where you told us our own
deferral was wrong. That one was the most valuable thing in the document — see item 2.

---

## Scoreboard

| # | Item | Status |
|---|---|---|
| 1 | Orphan lab reports evict patients | ✅ **Fixed, on prod** |
| 2 | `elevatedFlag` false all-clear | ✅ **Fixed where it matters, on prod** — read the scope note |
| 3 | `SERVER_TIMEOUT` parked as permanent | ✅ **Already fixed 2026-08-05**, reached prod today. The retry path does NOT share it — we checked |
| 4 | Fake counts on the money worklist | ✅ **Fixed, on prod** (both endpoints) |
| 5 | `GET /conversations?phone=` returns oldest | ✅ **Fixed, on prod** |
| 6 | Bio-age computed for minors | ❌ **Declined** — deliberate product call, see below |
| 7 | Dead tables, cron, indexes | 🟡 **Partly** — cron fixed and on prod; tables dropped on dev only; indexes declined |

---

## 1. Orphan lab reports — fixed

You were right about the mechanism and right about the priority. `take: limit` ran on the raw
event stream and the orphan filter ran afterwards, so adopted orders spent the budget.

**What changed:** `limit` now bounds **orphans returned**, not events examined. The scan widens to
5,000 events and provably-adopted rows are dropped *before* truncation. The expensive vendor roster
call is still made at most `limit` times, so that cost is unchanged.

**Two things we added that you didn't ask for**, because a silent list is the actual defect:
- if more orphans exist than fit, ops gets an alert saying **how many older orders are off the
  bottom** — those are the people who have waited longest;
- if the 5,000-event scan ceiling is ever hit, that alerts too, and says the real fix is an indexed
  `order_id` column rather than a bigger number.

**One thing worth knowing:** this compounds with the retry lane in a way neither of us wrote down.
A `REPORT_FULL` with no booking is parked permanently — correctly, the pipeline has nothing to
attach it to — which makes your worklist the **sole** recovery path. Parked plus evicted was a
result nobody could reach. That's why we took this first.

**No API change.** Same array, same shape.

---

## 2. `elevatedFlag` — you were right, and our deferral was wrong

> *"That reasoning doesn't hold. The false all-clear is ON completed rows."*

Correct. We deferred it on "every reader filters `status = COMPLETED`". Filtering to COMPLETED
doesn't avoid the false all-clear — **it selects for it.** Thank you for pushing back with the
prod query rather than accepting the answer.

**We then checked all four consumers you asked us to, rather than assuming:**

| consumer | verdict |
|---|---|
| **Lumi's health snapshot** | **WAS BROKEN — now fixed, on prod.** It told the model *"Elevated flag: no"* on a panel where nothing was computed. It now says the bio-age was **not calculated**, why, and explicitly not to imply normality. The real biomarker lines still render, so Lumi reasons from actual measurements. |
| **AI suggestions** | **Not a bug.** It already guards `if (!calculatedAge \|\| !ageDelta)` and bails before reading the flag. |
| **Customer results page** | **Affected, deliberately not fixed.** See below. |
| **Notifications** | No consumer — nothing reads the flag on that path. |

**Scope note, stated plainly so you can plan around it:** we did **not** make `elevatedFlag`
nullable and we did **not** change the results page. The page is being redesigned, and Isaam's call
was not to pay for work about to be thrown away. So:

- **the conversational surface is correct today** — that's the one that survives the redesign;
- **the results page still reads the raw `false`** and will until the redesign lands;
- `chronologicalAge: 0` on the failure path is also still there.

If the redesign slips, tell us and we'll do the nullable migration properly.

Your frontend fix — gating on `calculatedAge != null` and saying *"Not calculated — this panel is
missing some of the 9 markers"* — is exactly right, and is now the same thing Lumi says.

---

## 3. `SERVER_TIMEOUT` — already fixed, and the answer to the question you actually asked

**The preflight bug was fixed on 2026-08-05** and reached prod today. `retryable` now splits on the
status code: `5xx` = their server failed to answer → retry; `4xx` = their server answered "no" →
don't. It no longer splits on `kind`, which was the bug (`http_error` covered a 500 and a 404
identically).

**You asked the more important question:** *"check whether the REPORT_FULL webhook retry path
shares this logic."*

**It does not.** We traced it rather than assuming. `fetchReportXml` catches every failure — vendor
5xx included — and returns `null`, which the pipeline turns into `ReportNotReadyError`, i.e.
**transient, retried with backoff**. A lab outage does not strand results across orders.

The specific case you saw parked was `"No booking found for Thyrocare orderId VLC5D31A"`, which is
genuinely permanent *for the pipeline* — there is no booking to attach the result to. The recovery
path for that is your orphan worklist, which is exactly why item 1 was the fatal one.

**You can go back to trusting `retryable`.** It is authoritative again. Please do drop your local
derivation from `httpStatus`/`vendorBody` — one source is better than two, and if ours is wrong
again we'd rather hear about it than have it quietly compensated for.

**Not yet done:** reconciling `patients[].isReportAvailable: true` against `reportAvailable: false`
in the same payload. You're right that it's a retry signal we already have and aren't using. It's on
the list, not in this deploy.

---

## 4. Fake counts — fixed, both endpoints

**`GET /bookings/stuck`** — `count` is now three real uncapped `count()`s. New fields:

```jsonc
{
  "bookings": [ /* … capped at 200+50+50 as before */ ],
  "count":    649,        // the REAL total — this is the headline number
  "showing":  300,        // what the array actually holds
  "hasMore":  true,
  "byClass": {
    "paid_not_transitioned": 97,
    "no_payment_link":       140,
    "no_thyrocare_order":    412
  }
}
```

`count` is **kept as the total** rather than repurposed, because your console renders it as the
headline and a headline that is a page size is the whole defect. `byClass` is new — you asked for a
real number, and *which* class is spiking is the thing that tells ops what broke.

**`GET /incidents/actions/open`** — `openCount` and `overdueCount` now come from real `count()`s
using the same `where` as the page (so they respect `ownerAdminId` / `overdueOnly`). Added `showing`
and `hasMore`. You were right that this one was worse: two numbers in one payload, from one
collection, derived differently.

---

## 5. `GET /conversations?phone=` — fixed

Now `desc`, reversed for display, so the payload still reads oldest→newest and **nothing you parse
changes**. Also added `total`, `showing`, `hasMore`.

Verified on dev by forcing truncation: with `limit=1` against a 2-message user it returns the
**newest** message. The old code returned the oldest.

For walking a long history, `/users/:id/conversations` (cursor-paged, from this morning) is still
the right endpoint. This one stays a single-shot convenience read — it's the one the founder curls.

---

## 6. Bio-age for minors — declined, deliberately

You were right that there is **no lower age bound** — we looked, and there isn't one in
`phenoage.service.ts` or `results-pipeline.service.ts`. `overflowCapped` guards the top of the
exponent and nothing guards the bottom of the age domain. Your read of the maths is correct too:
PhenoAge is fitted on NHANES **adults**, so 14 is out-of-domain, not merely wrong. (For what it's
worth, the *mechanism* is that a 14-year-old has low creatinine, high lymphocyte % and low CRP —
normal childhood physiology, which the formula reads as exceptional adult health.)

**Isaam's decision was to leave it as is**, and it's his to make. Context that makes it more
defensible than it looks: minors are already blocked from booking (`LUMI_ALLOW_MINORS=false` on
prod since task-def `:32`), so Hafsah's row predates the block and this is a legacy row rather than
an ongoing intake.

**What this means for you:** please keep rendering `calculatedAge`/`ageDelta` as you would any
other value — we are not sending null for minors. If you'd rather suppress it in the UI for
under-18s, that's a frontend call and we won't fight it.

---

## 7. Housekeeping

**The cron — fixed, on prod.** `scrubExpiredCallNotes` is capped at 500/run and now updates **by
id** rather than by where-clause. That second part matters: a bounded read with an unbounded write
would have been worse than no cap, because the log line would have under-reported what it touched.
It drains rather than truncating — the sweep is hourly and idempotent, so what it misses this tick
it takes next tick, oldest first.

**The two dead tables — dropped on DEV only, not prod.** Both confirmed dead: `notifications` has
zero writers, `whatsapp_templates_sent` had exactly one writer (now removed) and zero readers since
ADR 0007. All code references are gone from prod as of this deploy, so **prod keeps two unused
tables that nothing touches**. The actual `DROP` is a separate, deliberate promotion.

> **A note for your own migrations, because it cost us an hour:** there is no such thing as a
> migration that is "written but not applied" in this repo. Both pipelines run
> `prisma migrate deploy` automatically — dev on push, prod on container start. Committing a
> migration file to a deployed branch **is** applying it. We wrote that drop with a "paused for
> approval" header, pushed it to dev, and it dropped both tables there immediately while seven
> `deleteMany` calls still referenced them. Caught it in the prod trial-merge and pulled it out.
> If you ever need a migration to wait, keep it out of `prisma/migrations/` entirely.

**The indexes — declined, and this is a recommendation rather than a deferral.**
`users.last_whatsapp_activity` and `bookings.created_at` both get a sort over a set the preceding
filter has already reduced to single or double digits. An index costs a migration and buys nothing
measurable at this cardinality. Revisit if any single account passes ~1,000 bookings, or if the
users table passes ~50k rows. You flagged it as "not urgent at current volume" and we agree —
we're just saying so explicitly rather than leaving it open.

**The whole-table scans** (`/calls/stats`, `/feedback/export`, `/incidents/stats`, `/rag/version`,
`/bookings/:id/webhook-timeline`) — acknowledged, not done. Operator-facing and low-frequency.
Tell us if any of them is actually slow for you and it moves up.

**`GET /bookings` silent clamp** — not changed yet. You're right that a 400 is better than a clamp
and that our newer endpoints do it correctly. Changing it now would break any caller currently
relying on the clamp, including possibly yours, so: **tell us when you're ready and we'll switch it
in a coordinated deploy.**

---

## Bonus — three conversation fixes that shipped today

Not on your list, but they came from the same customer (`919895984115`) whose 90-message
conversation your pagination handoff surfaced. Worth knowing because they change what operators see
in the transcript:

- **The selector hijack.** "Which medicine should be best" was answered with the Bio-Age explainer
  and *"Want me to get it booked for you?"* — a sales pitch to a man asking about diabetes
  medication. Same for "Can I get a video for preparing sambar", which was the last message he ever
  sent.
- **Replies cut mid-word.** `max_tokens: 400` with `finish_reason` never checked. One reply ended
  `"• Must"`, four lines into a recipe.
- **Invented businesses.** Asked for yoga centres in Trivandrum, Lumi named five; none holds up.
  It now still names places but appends *"I can't verify these"*, and will never name a
  doctor/clinic/hospital/lab.

---

## What we'd like from you

1. **Drop your local `retryable` derivation** (item 3) once you've confirmed the fix looks right.
2. **Tell us when the results-page redesign lands** so we can do the `elevatedFlag` nullable
   migration against the new page rather than the old one.
3. **Say the word on `GET /bookings`** clamp → 400, and we'll coordinate.

Questions to isaamm@jiive.ai.
