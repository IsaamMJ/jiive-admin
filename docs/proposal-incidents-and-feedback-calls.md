# Proposal — Incident Log + Feedback Calls

**Date:** 2026-07-13
**Author:** jiive-admin (frontend)
**Status:** proposal, awaiting sign-off
**Driver:** CEO asked for incidents to be filed and referable. Second ask: phone customers for feedback and document it.

---

## The incident this is designed around

2026-06-21, 08:50. Six orders (`VL8E1FF6`, `VLB2CE67`, `VL1D9908`, `VLA7A4E2`, `VL581FAF`, `VL0CB785`)
for **one person**. Slot 07:20–08:20. Phlebo never showed, didn't answer calls. Customer had fasted
**14+ hours** and was told to break the fast. Vendor's read: 6 packages = 18 vials, which no customer
would accept; the address was incomplete ("Nagarcoil + pincode"). Adhish promised an operations RCA.

**That RCA never landed anywhere.** The whole thing lives in a WhatsApp scroll. We cannot answer *"how
many phlebo no-shows has Thyrocare had this quarter?"* — and that is the question that turns a vendor
conversation from anecdote into evidence.

Three distinct failures sit in that one thread, and a good log catches all three:
1. **Vendor:** phlebo no-show, then unreachable.
2. **Ours:** the booking model let 6 panels become 6 separate orders for one person (63 possible
   combinations — the vendor's "just make combined packages" is unworkable at scale).
3. **Ours:** an incomplete address reached a live order.

---

## What the research actually says

### The finding that drives the entire design

Healthcare's own incident-reporting literature is a warning against building the obvious thing.
Hospital reporting systems capture **under 10% of real adverse events**. The causes are consistent:
tedious forms, time pressure, uncertainty about what counts — and the big one, **56% of clinicians say
they never get feedback on a report they filed, so they stop filing**
([AHRQ PSNet](https://psnet.ahrq.gov/perspective/incident-reporting-more-attention-safety-action-feedback-loop-please)).
incident.io says it in ops language: *"When you're asking someone to input structured data, you're
creating additional work for your responders."*

**A system that captures 100% of incidents with 6 fields beats one that captures 30% with 20 fields** —
because the CEO's ask is a *counting* problem, and counting only works if everything got filed.

And the corollary that matters at your size: **a big org dies of bureaucracy; a three-person team dies of
silence.** Nobody will chase you to file. The only thing that keeps this alive is that *reading* it
produces something you actually want — the quarterly no-show count, the Thyrocare scorecard.
**Build the read side as carefully as the write side, or the write side dies within a month.**

### Why these systems rot

[incident.io on why action items fail](https://incident.io/blog/sre-incident-postmortem-best-practices):
*"15 action items with zero completed, no owner, no deadline, no follow-up."* And their bar for honesty:
*if action-item completion falls below 50%, your postmortems are theatre.* [The harder critique](https://odd.fyi/blog/article/incident-post-mortems-that-change-nothing-the-ritual-of-blameless-accountability/):
teams keep the word "blameless" and drop the machinery.

The single most expensive failure mode is **"postmortem archaeology"** — reconstructing a timeline from
memory afterwards. If updates are captured live, the RCA is 80% pre-written. **This feature is not
documentation. It is RCA cost reduction.**

### Feedback metric — CSAT, and only CSAT

**NPS's foundational claim failed to replicate.** Keiningham et al. (*Journal of Marketing*, 2007;
21 firms, 15,500+ interviews) found no consistent superiority for NPS over plain satisfaction. And
de Haan et al. (2015, n=6,649) found **top-two-box satisfaction correlated best with two-year retention
(r=.184)**, NPS behind it (r=.170), and **CES *negatively* correlated (r=−.073)**
([MeasuringU](https://measuringu.com/customer-effort-score/)).

Practically: a 0–10 NPS scale is miserable to administer *by voice* — people ask you to repeat the
anchors and default to 8. Worse, asking *"would you recommend us to a friend"* **when the founder is the
one on the phone** will produce a wall of 9s that tells you nothing. CES is designed for *issue
resolution*, not service delivery, so its wording doesn't even parse for a blood test.

**CSAT. One metric. Not three.** Three metrics on a 3-person team is theatre; you'll act on none.

---

## Design principle 1 — filing must not require a laptop

June 21 happened **on a phone, in WhatsApp, at 8:50am, mid-firefight.** Nobody opens a dashboard and
fills twelve fields while a customer is 14 hours into a fast. **This decides whether the system lives.**

- **Filing is 6 fields, under 60 seconds:** title, severity (one tap), category (one tap), when it
  happened (defaults to now, back-datable), what happened (free text — *paste the WhatsApp thread*),
  order IDs. Nothing else required.
- **Category is required and it's a fixed enum** — not free tags. It is the field that makes
  `count(phlebo_no_show, this quarter)` a single click. Free-text tags would never aggregate.
- **One order ID expands into everything.** Type `VL8E1FF6` → the backend resolves the booking, customer,
  address, slot, **the phlebo's name and phone**, and **`paymentBatchId` — which surfaces all six sibling
  orders**, so the "18 vials" case appears as *one* event, not six unrelated ones. Every one of those
  fields already exists on `Booking`.
- **Everything else is enrichment**, done later from a laptop when the fire is out.
- **The page works one-handed on a phone.** Not "responsive-ish".

## Design principle 2 — push, don't pull

You don't check dashboards. So the dashboard is where incidents are *read back*, never how you learn
one happened.

**An alert channel already exists** — `OpsAlertService`, which sends **email via AWS SES** to the ops
address. It's already used for things like failed refunds, and its permissions are already wired. Adding
incident alerts to it is a two-line change: **no new provider, no new account, no new env var, no rotation chore.**

⚠️ **Not WhatsApp** — and this corrects an earlier draft of this doc. Meta only allows free-form messages
inside a 24-hour window after the *customer* messages you, which makes unprompted internal alerts
unreliable. The backend team hit this and **moved ops alerts off WhatsApp to email on 2026-05-11.** Email
is still a push channel: it comes to you; you don't go looking for it.

- **S1/S2 filed** → immediate alert: severity, one-liner, customer, order ID, who filed.
- **RCA overdue** → a nudge that keeps coming. **This is the alert that would have saved June 21** —
  Adhish's promised RCA would have kept surfacing until someone chased it.

*(WhatsApp is still the right channel for messaging the **customer** — e.g. a call-scheduling nudge — via
approved templates. Just not for alerting us.)*

Nothing else pings you. Silence is the default.

## Design principle 3 — everything is team-visible

One shared log. `filedBy` / `owner` / `calledBy` are **attribution, not permissions** — so you know who's
on it and who already spoke to the customer. Anyone can read, comment on, update anything.

---

## Severity ladder (harm-based)

Graded by **degree of harm**, following NHS England's model — because when the product is a blood draw,
customer impact *is* harm. (This ladder is a synthesis for Jiive, not an off-the-shelf standard.)

| | Name | Definition | Alert |
|---|---|---|---|
| **S1** | Harm / safety event | Customer harmed; a clinical decision made on a wrong or mismatched result; sample mixed up or mislabelled; health data leaked. Anything that would embarrass us in a regulator's hands. | WhatsApp, now. RCA mandatory. |
| **S2** | Real detriment, no clinical harm | Concrete, non-recoverable cost to the customer: **fasted 14h for nothing**, took leave from work, billed for a service not delivered. | WhatsApp, now. RCA mandatory. |
| **S3** | Recoverable friction | Phlebo late but the collection happened; wrong panel caught before the draw. Annoying; nothing lost. | No alert. Logged. |
| **S0** | Near miss | Caught **before** it reached the customer — the 18-vial order spotted pre-dispatch, the bad address flagged at confirmation. | No alert. Logged, and counted. |

**June 21 is an S2** — real detriment, no clinical harm. *(I initially called it S1; the harm-based ladder
is the more honest read, and keeping S1 for genuine clinical harm is what stops severity inflation.)*

**S0 is the sleeper.** Near-misses are the cheapest lessons available and the first thing to stop being
reported when filing has friction. **The 18-vial defect is systemic — it would have shown up as a string
of S0s long before it produced an S2, if there had been anywhere to put them.**

Two rules from the sources: **unsure? pick the higher one and move on** — and severity is re-assignable
afterwards, keeping the original in a shadow field, so you can see whether you systematically under-call.

## Status lifecycle

```
OPEN ──────────► RESOLVED ──────────► CLOSED
customer still   customer is whole    contributing factors written +
affected         again; RCA is OWED   every action item owned and dated
```

**`RESOLVED` and `CLOSED` must be different things.** June 21's customer was handled; the *cause* never
was. If resolving the customer's problem also closed the record, the RCA never gets written — the pain is
gone and so is the motivation. That is precisely what happened. S0/S3 may skip straight to CLOSED.

---

## Screen 1 — Incidents

**List** — fork the existing `audit-log` table/filter/pagination pattern so it looks native on day one.
Filters: severity, category, vendor, status, date, customer, order. Default view: everything not CLOSED.

**Detail** — header (ref, title, severity, status, owner, links to customer/orders/vendor refs) → the
**append-only timeline as the dominant element**: paste-friendly, **image attachments** (the WhatsApp
screenshots *are* the evidence), and **back-datable timestamps** — people paste yesterday's thread today,
and forcing `now()` destroys the chronology that is the entire point. Nothing is ever edited or deleted.

**RCA block** — collapsed until RESOLVED, then it unfurls and nags. **Contributing factors are plural**
(June 21 has at least three; a singular "root cause" field would force you to pick one and lose the rest).
Action items each carry **one named human and a real date** — *"Thyrocare written RCA, owner: thyrocare,
due: 16 Jul"* sits in the same overdue list as everything else.

## Screen 2 — Look back (the read side — do not skip this)

This is what stops the log dying of silence. Three panels:

1. **Counts by category × severity over a date range** — answers the CEO directly.
2. **Open action items across *all* incidents**, owner + due date, **overdue in red**. This is what turns
   a diary into an operating system.
3. **Vendor scorecard** — Thyrocare incidents by month × category × severity. *"Nine no-shows this
   quarter, three S2, here are the timestamps, here's what you committed to in March and didn't do."*
   **That is the ROI of this entire system**, and today it's unavailable because the evidence is a WhatsApp scroll.

**One sidebar badge: "RCA owed (3)."** If we build one thing beyond the filing form, build that badge.

## Screen 3 — Feedback calls

**The queue is the product.** If deciding who to call is itself a task, calling stops happening. The
system must always have a *next*. Auto-enqueued, in priority order:

| Reason | Why |
|---|---|
| 1. Hit an incident | Close the loop on people we hurt (within 48–72h) |
| 2. First-time customer | Highest information density; retention is won or lost here |
| 3. Previous CSAT ≤ 3 | A known-bad relationship is the strongest signal in the closed-loop literature |
| 4. Every Nth repeat customer (start N=5) | Baseline, so the queue isn't purely a complaint funnel |

Everyone else: **don't call.**

Each row: name, phone (**tap to dial**), what they booked, when, **why they're queued** (coloured pill),
attempt badge ("Attempt 2 of 3"). The call screen pins booking context **above the fold** — including
**notes from every previous call to this person** — so you're not reading while the phone is at your ear.

**Logging is two stages, built for a phone in one hand:**

- **Stage 1 — always, one tap.** Seven big disposition buttons. Tapping any *non-connected* one saves and
  returns to the queue **immediately**. **A failed call costs exactly one tap.** This is the most important
  decision in the feature: if a no-answer costs more than one tap, no-answers stop being logged, and
  attempt-tracking silently becomes fiction.
- **Stage 2 — only on `connected`.** CSAT (five big buttons, required) → tags (chips) → notes → one
  optional verbatim quote. Four inputs on a good call. Completable while still saying goodbye.

**Dispositions (7, flat):** `connected` · `refused` · `callback` (doesn't burn an attempt) · `no_answer` ·
`unreachable` · `wrong_number` · `do_not_contact`.

*No `voicemail`* — effectively dead on Indian mobile networks; carrying the code adds a choice nobody will
legitimately use. *`unreachable` stays separate from `no_answer`* — switched-off vs. actively ignoring are
different things and justify different retry timing.

**CSAT — read aloud, verbatim, every time:**

> *"Overall, how satisfied were you with your Jiive blood test? On a scale of 1 to 5, where 5 is very
> satisfied and 1 is very dissatisfied."*

Stored 1–5, reported as **top-2-box** (% answering 4 or 5). Follow immediately with the unscored question
that produces the actual insight: **"What's the one thing we could have done better?"**

**Attempts: cap at 3**, spaced across *different times of day* (morning / evening / weekend), 1–2 days
apart. Varying the time beats increasing the count — someone who didn't answer at 11am Tuesday is at work,
and 11am Wednesday tests the same hypothesis twice. Sales literature says 8–12 touches; **ignore it** —
that's cold B2B prospecting. This is a courtesy call to someone who already paid and had a stranger draw
blood in their home. Attempt eight is harassment.

**Tags are chips, never a text input.** A free-text tag field guarantees "phlebo late", "Phlebo Late", and
"phlebotomist was late" all coexist and none of them count. Seed ~12 from the first 20 calls, freeze,
allow "propose new tag" into a monthly review list. **Report raw counts, not percentages** — *"phlebo-late
×7"* is more honest and more actionable than "18.4% cited timeliness". **Put that count where the caller
can see it** — data entry that never comes back to the person entering it is exactly why CRMs go unused.

---

## On recording calls: don't

**Recommendation: notes only, no audio.** The person on the call *is* the person who will act on it —
you're not doing agent QA, so there is nothing to review a tape for. Meanwhile DPDP 2023 moves commercial
call recording materially toward two-party consent and would add a new storage class, a new breach
surface, a new consent script, and a new deletion obligation. Bad trade for three people.

**What still applies without recording** (your typed notes are health-adjacent personal data):
- **A one-line notice at the start of every call**, scripted in the UI so it's never forgotten:
  *"Hi, this is [name] from Jiive. I'm calling about your recent test so we can improve — two minutes, is
  now okay? I'll note down your comments; you can skip anything."*
- **`do_not_contact` must be enforced by the system, permanently.** That's consent withdrawal, not a
  preference. Never rely on memory.
- **Purpose-limit the notes.** Service feedback ("phlebo was late") — fine. **Nothing about diagnoses or
  results.** Notes must never become a shadow clinical record.
- **12-month retention, then actually delete.**

⚠️ **This is a research read, not legal advice** — the DPDP points come from law-firm summaries, not the
statute. Worth 20 minutes with counsel before launch.

---

## Scope — what I am NOT building

No NPS · no CES · no call recording · no SLA countdown timers · no on-call rotation or incident-commander
role · no urgency×impact matrix · no public status page · no roles/permissions (attribution ≠ permission) ·
no new notification channel · not extending `admin_audit_log` (it's a before/after **diff** log for config
mutations — the wrong shape for incident narratives).

## Build order

1. **File-it form + incident list** — 60 seconds, phone-first, order-ID auto-linking.
2. **"RCA owed" badge + WhatsApp alerts** (S1/S2 on file, RCA overdue). *The bit that would have saved June 21.*
3. **RCA block** — contributing factors (plural), action items with owner + due date.
4. **Look-back screen** — category counts, cross-incident action items, vendor scorecard.
5. **Feedback calls** — queue, two-stage log, CSAT, tags.

## Open questions for Isaam

1. **Where should S1/S2 alerts land** — your number, or a group with Juvi and Jabir?
2. **Backfill June 21 as INC-001?** It's the proof the system works, and Thyrocare still owes you that RCA.
3. **Default owner** — whoever filed it, or whoever owns that customer?

---

## Research sources

Incidents: [AHRQ PSNet](https://psnet.ahrq.gov/perspective/incident-reporting-more-attention-safety-action-feedback-loop-please) ·
[Google SRE](https://sre.google/sre-book/postmortem-culture/) ·
[PagerDuty](https://response.pagerduty.com/before/severity_levels/) ·
[incident.io severities](https://incident.io/guide/foundations/severities) ·
[incident.io postmortems](https://incident.io/blog/sre-incident-postmortem-best-practices) ·
[NHS England harm grading](https://www.england.nhs.uk/long-read/policy-guidance-on-recording-patient-safety-events-and-levels-of-harm/) ·
[Venminder vendor SLA](https://www.venminder.com/blog/tracking-vendor-performance-service-level-agreements)

Calls: [MeasuringU on CES/NPS/CSAT evidence](https://measuringu.com/customer-effort-score/) ·
[Keiningham et al. 2007](https://journals.sagepub.com/doi/abs/10.1509/jmkg.71.3.039) ·
[Dixon et al., HBR 2010](https://hbr.org/2010/07/stop-trying-to-delight-your-customers) ·
[disposition taxonomy](https://leadadvisors.com/blog/disposition-taxonomy-outbound/) ·
[Qualtrics closed-loop](https://www.qualtrics.com/experience-management/customer/closed-loop-cx/) ·
[EY on DPDP 2023](https://www.ey.com/en_in/insights/cybersecurity/decoding-the-digital-personal-data-protection-act-2023)

**Sourcing caveat:** the S0–S3 ladder and the category enum are our synthesis for Jiive, not published
standards. The DPDP points are from secondary summaries, not the statute.
