# Handoff → jiive-backend — Incident Log + Feedback Calls

**Date:** 2026-07-13
**From:** jiive-admin (frontend)
**Design + research:** `docs/proposal-incidents-and-feedback-calls.md` — read the "why" there. This is the contract.
**Verified against:** `origin/dev` @ `76f09d2` (`prisma/schema.prisma`, `src/modules/lumi/whatsapp/whatsapp.service.ts`).

We state the **outcome** and the user-facing constraints. The "how" is yours.

---

## Why this exists

2026-06-21: a phlebo no-showed a 07:20–08:20 slot. The customer had fasted 14+ hours and broke the fast
for nothing. Six orders (`VL8E1FF6`, `VLB2CE67`, `VL1D9908`, `VLA7A4E2`, `VL581FAF`, `VL0CB785`) were
placed for one person — the vendor pointed out that's 18 vials of blood — and the address was incomplete.
Thyrocare promised an operations RCA. **It was never tracked. The entire incident exists only as a
WhatsApp scroll.** The CEO wants incidents filed and referable.

The system must answer, six months later: *"How many phlebo no-shows did Thyrocare have this quarter, on
which orders, and what did they commit to each time?"*

---

## Constraint 1 — filing takes under 60 seconds, on a phone

Only **six** fields may be required at creation: `title`, `severity`, `category`, `occurredAt`,
`whatHappened` (free text), and one or more Thyrocare order IDs. Everything else must be optional and
fillable later.

This is not a preference. Healthcare's own reporting systems capture **under 10% of real adverse events**,
and the top cause is form friction. If filing takes longer than the gap between two WhatsApp messages, it
will not happen, and the feature is dead. **A system that captures 100% of incidents with 6 fields beats
one that captures 30% with 20.**

`filedBy` / `reportedAt` are stamped server-side. Never ask the client for them.

## Constraint 2 — one order ID must expand into full context

The operator types `VL8E1FF6`. The backend resolves and stores the links. **All of this already exists on
`Booking`** (`prisma/schema.prisma:92`):

- `thyrocareOrderId` / `thyrocareLeadId` → the booking
- `userId` → the customer
- `addressId` → the address (June 21's RCA hinged on a bad address)
- `appointmentDate` / `appointmentTime` → the slot that was missed
- `phleboName` / `phleboPhone` → **who** didn't show up
- `paymentBatchId` → **the sibling orders.** This is how "6 orders / 18 vials" becomes one visible event
  instead of six unrelated ones. **Please surface the whole batch.**

`affectedOrderIds` is an **array** — the motivating incident had six. A single-order field loses the plot.
An order ID matching nothing must fail loudly, not silently store a dangling string.

## Constraint 3 — everything is team-visible

All incidents and call logs are visible to **every** admin. `filedBy` / `owner` / `calledBy` are
**attribution, not authorization**. **Do not scope list queries to the requesting admin.**

## Constraint 4 — reuse `OpsAlertService`. Do not add a channel.

**Use `OpsAlertService.alert(category: string, detail: string): void`**
(`src/modules/lumi/whatsapp/ops-alert.service.ts`). Despite living under `whatsapp/`, it sends via **AWS
SES email** to `OPS_ALERT_EMAIL`. Fire-and-forget, never throws, always logs to CloudWatch first. IAM is
already wired (`jiive-ecs-task-role` → `OpsAlertSESSend`). Already injected elsewhere as a constructor
dep. **Zero new env vars, zero new IAM, zero new service — a two-line integration.**

⚠️ **Do NOT use `WhatsAppService.sendText()` for these alerts.** Meta only permits free-form messages inside
the 24-hour user-initiated window, which makes unprompted ops alerts unreliable — the team already learned
this and **migrated ops alerts off WhatsApp to SES on 2026-05-11** (see the service's own header comment).
An earlier draft of this handoff got that wrong.

- **S1 or S2 filed** → `alert('incident_filed', ...)`: severity, one-liner, customer, order ID, who filed.
- **RCA overdue** (incident RESOLVED, RCA obligation past due) → a recurring nudge. **This is the alert that
  would have saved June 21.**

**Recipient: `isaamm@jiive.ai`** (i.e. `OPS_ALERT_EMAIL` — confirm it's already set to this; if so, there is
literally nothing to configure). Note this alerts Isaam only — the incident *log* is team-visible to all
admins, but the email nudge goes to one inbox. If Juvi/Jabir should also be alerted, a shared/alias address
is the cleaner answer than a second recipient list.

`WhatsAppService` remains the right channel for messaging the **customer** (e.g. a call-scheduling nudge) —
use `sendTemplate()` outside the 24h window. It is not for internal alerts.

Nothing else pushes. Silence is the default.

## Constraint 5 — action items need a human and a date

Research is unambiguous: action items with no named owner and no due date are never done, and a postmortem
whose actions don't complete is theatre. So `ownerAdminId` and `dueDate` are **required, not nullable**.
An action item without an owner is not an action item.

Note: an action's owner may be **the vendor** ("Thyrocare written RCA, due 16 Jul") — model this so a
vendor commitment lands in the same overdue list as everything else.

---

## Data model (shape, not prescription)

FK target for admin attribution: **`AdminUser`** (`schema.prisma:468`), PK `id String @id @default(uuid())`.

### Incident
- **Human-readable ref** (`INC-2026-014`) — operators quote these to the vendor. A UUID is useless in a WhatsApp message.
- `severity`: `S1` (harm/safety) | `S2` (real detriment, no clinical harm) | `S3` (recoverable friction) | `S0` (near miss)
  Plus `originalSeverity` (shadow field, set once) — severity is re-assignable, and the drift tells us if we systematically under-call.
- `status`: `OPEN` → `RESOLVED` → `CLOSED`.
  **`RESOLVED` and `CLOSED` must be distinct.** June 21's customer was made whole while the cause was never
  closed. If resolving the customer's problem also closes the record, the RCA never gets written — that is
  literally what happened. Entering `RESOLVED` on an S1/S2 **creates the RCA obligation**.
- `category` — **required at file time, fixed enum.** This is the field that makes the CEO's question a
  single query; free-text tags would never aggregate. Resist growing this list:
  `phlebo_no_show` · `phlebo_late` · `sample_issue` · `wrong_test_or_panel` · `result_delayed` ·
  `result_wrong` · `booking_error` (our model produced something nonsensical — the 18-vial case) ·
  `address_or_dispatch` · `billing_refund` · `app_or_backend` · `other`
- `vendor`: `thyrocare` | `internal` | `none` — the axis the vendor scorecard is built on. Filterable + countable.
- Timestamps: `occurredAt` (**manual, back-datable** — it hit the customer at 07:20; we filed it hours
  later) vs `reportedAt` (auto). **The gap between them is itself a metric** — our detection latency.
  Plus `resolvedAt`, `closedAt`.
- `filedByAdminId`, `ownerAdminId` → `AdminUser`
- Links: bookings (many), users (derived), `affectedOrderIds[]`
- `whatHappened` — free text, **long**. Operators paste WhatsApp threads. Do not cap at 255.
- `slaBreached` (bool) + which SLA — e.g. "collection within the booked 60-min slot"
- `vendorCommitment` — what they promised, and by when
- **Timeline updates — append-only**: `{ at, adminId, body, attachments[] }`.
  - **Never edited, never deleted.** That's what makes it usable as evidence later.
  - **`at` must be back-datable** — people paste yesterday's thread today, and forcing `now()` destroys the
    chronology that is the whole point.
  - **Image attachments required** (WhatsApp screenshots *are* the evidence in a vendor conversation).
- RCA: **`contributingFactors[]` — plural, deliberately.** Not "root cause". June 21 has at least three
  (incomplete address; booking model → 18 vials; vendor dispatch failure). A singular field forces you to
  pick one and lose the others.
- `actionItems[]`: `{ description, ownerAdminId (required), dueDate (required), doneAt }`
- `whatWentWell` — free text, optional. Cheap, and it's what keeps people willing to write the next one.
- `tags[]`

### CallLog
- `userId` (required), `bookingId` (from queue context), `incidentId` (optional — a call closing the loop)
- `queueReason`: `incident` | `first_time` | `low_csat` | `nth_repeat`
- `attemptNumber` — **derived**, never typed (count prior logs for that booking)
- `calledByAdminId`, `startedAt`, `endedAt` (duration comes free — **never ask anyone to type a duration**)
- `disposition` — **exactly these 7**: `connected` | `refused` | `callback` | `no_answer` | `unreachable` |
  `wrong_number` | `do_not_contact`
  - **No `voicemail`** — effectively dead on Indian mobile networks; the code would never be legitimately used.
  - **`unreachable` stays distinct from `no_answer`** — switched-off vs. actively ignoring justify different retry timing.
  - **`callback` must NOT burn an attempt.**
- `csat` (int 1–5) — **required iff `disposition = connected`**, else null. Enforce server-side. Report as top-2-box.
- `tags[]` (fixed chip vocabulary — **never a free-text tag field**), `notes` (free text), `verbatim` (one quote), `resolved` (bool)
- `callbackAt` (nullable, only when `disposition = callback`) — re-enqueues automatically
- **No recording, no audio.** Deliberate: DPDP 2023 consent/retention burden on health-adjacent data, for
  recordings a 3-person team would never listen to.

**`do_not_contact` is a hard, permanent, system-enforced exclusion from every future queue.** It is a
consent withdrawal under DPDP, not a preference. It must never depend on someone remembering.

**Retention:** call notes are health-adjacent personal data. 12-month retention, then actual deletion.

### Call queue (endpoint, not a table)
Returns who to ring next, each row carrying **why**, priority-ordered:
1. hit an incident (call within 48–72h) → 2. first-time customer → 3. previous CSAT ≤ 3 → 4. every Nth repeat (N=5, configurable)

**Exclude:** `do_not_contact` (permanently), 3+ attempts, a future `callbackAt`, or a call already logged
for that booking. Cap attempts at 3.

The caller opens one screen and rings the top row. **They must never have to decide who's next** — if
choosing is a task, calling stops happening.

---

## Endpoints (shape)

Match the existing admin convention (`@Controller('api/v1/admin/...')`, Bearer token, **admin resolved
server-side** — the `admin_audit_log.adminUserId` precedent shows the mechanism exists. The frontend has
**no access to the admin's ID**, only name/role, so `filedBy`/`calledBy` **must** be stamped from the
token, never sent by the client).

- `POST /incidents` — the 60-second file. Accepts order IDs; resolves and links them.
- `GET /incidents` — list + filters (severity, category, vendor, status, date, customer, order). Paginated. Default: not CLOSED.
- `GET /incidents/:id` — detail incl. resolved booking/customer/phlebo/**payment-batch siblings** + timeline.
- `PATCH /incidents/:id` — status, owner, severity (preserving `originalSeverity`), RCA fields.
- `POST /incidents/:id/timeline` — append an update (**back-datable `at`, image attachments**).
- `POST /incidents/:id/actions` · `PATCH .../actions/:actionId` — owner + due date **required**.
- `GET /incidents/actions/open` — **cross-incident** open action items, with overdue flags. *This is the screen that turns a diary into an operating system — please don't skip it.*
- `GET /incidents/stats` — counts by category × severity × vendor × month. Powers the CEO's question and the Thyrocare scorecard.
- `GET /calls/queue` — the worklist, with reason + priority + attempt number.
- `POST /calls` — log a call.
- `GET /users/:id` — **please add `incidents[]` and `callLogs[]`** to the existing response. That page
  already renders 6 nested collections from this one call; two more means the new tabs need near-zero plumbing.

## Round 2 — resolutions from backend review (2026-07-13). These supersede anything above.

The backend team raised four gaps. **All four accepted.** Two were genuine contradictions in our spec.

### R1. Attachments live in Postgres as `bytea`, served via an admin-auth'd endpoint
No S3 client exists, and RAG's ECS-local disk dies on redeploy — **evidence for a vendor dispute cannot
evaporate on a deploy.** Zero new infra/IAM/env vars, and there's house precedent (results was
deliberately built S3-free). Volume is trivial.

**Conditions (frontend asks):**
- **Reject SVG.** Allowlist `image/png`, `image/jpeg`, `image/webp`, **sniffed from the bytes** — never
  trusted from the filename or the client-supplied `Content-Type`. An SVG is an image to the user and an
  executable script to the browser; we'd be serving admin-uploaded XSS from our own origin.
- Serve with `X-Content-Type-Options: nosniff`. Never render inline as HTML.
- Cap size (~5 MB/image, a few per update). "Volume is trivial" is only true if it's *enforced*.
- **Never `SELECT` the blob column in list/detail queries** — fetch bytes only from the dedicated endpoint.

### R2. `ownerAdminId` stays required; add optional `ownerVendor`
Our spec contradicted itself (required admin owner vs. "the owner may be the vendor" — Thyrocare has no
`AdminUser` row). **The backend's fix is sharper than our spec and we're adopting their reasoning verbatim:**

> June 21 failed precisely BECAUSE the RCA's only owner was the vendor and nobody internal owned chasing it.

An action item owned by Thyrocare is an action item with **no owner**. So: `ownerAdminId` (required) is the
internal person who chases it; `ownerVendor` (optional) records who owes the deliverable. Frontend POST body unchanged.

### R3. Call-queue exclusion rules (our spec contradicted itself)
- **Terminal** — removes the booking from the queue permanently: `connected`, `refused`, `wrong_number`, `do_not_contact`.
- **Non-terminal** — stays queued up to **3 attempts**: `no_answer`, `unreachable`.
- **`callback`** — does not burn an attempt; re-enqueues at `callbackAt`.

### R4. Retention must not delete the opt-out (the important one)
Taken literally, our "12-month deletion of call notes" would **delete the row recording `do_not_contact`,
resurrecting an opted-out customer back into the call queue** — our own retention job causing a DPDP consent
violation. Twelve months after launch, in the worst possible way.

**Fix:**
- At 12 months, **scrub the health-adjacent free text** (`notes`, `verbatim`) but **keep the structural row**
  (disposition, csat, tags, timestamps — aggregate value, not health-adjacent).
- **`do_not_contact` gets its own permanent opt-out table.** The exclusion must never depend on the retention
  job, on the call-log row surviving, or on anyone remembering.
- **Key the opt-out on phone number, not just `userId`** (frontend addition). If a person re-registers with a
  new user row on the same number, a `userId`-keyed exclusion silently lapses and we phone someone who told
  us not to.

---

## House conventions to follow (verified on `origin/dev` — no discovery needed)

- **No Prisma enums for lifecycle status.** House style is a plain `String` column + a TypeScript enum as
  the compile-time source of truth (see `src/modules/booking/booking-status.enum.ts:1-11` — raw status
  strings "were the root cause of the 9 booking bugs shipped 2026-04-29"). So: `status String` +
  `IncidentStatus` / `CallDisposition` TS enums. **Never raw strings in code.**
- **Controller:** its own file at `@Controller('api/v1/admin/incidents')` (feature modules mount their own
  sub-prefix rather than bloating `admin.controller.ts`). Guard per route with
  `@UseGuards(RolesGuard)` + `@Roles('admin')`.
- **Identity:** copy the private `identify(authorization)` helper (`admin.controller.ts:367-401`) — each
  admin sub-controller owns its own copy; that's the house pattern. It returns `{ adminUserId, label, role }`
  and is exactly what populates `AdminAuditLog.adminUserId` today. **Use it for `filedBy` / `calledBy`.**
- **`filedBy` should be nullable** (`String?`), matching the existing precedent on `AdminAuditLog.adminUserId`,
  `RagDocument.uploadedByAdminId`, `PlaygroundConversation.adminUserId` — null when invoked via the legacy
  static `ADMIN_TOKEN` path.
- **Audit:** write through `AdminAuditService.log()` on every mutation, like every other admin write. Action
  naming follows `<resource>.<verb>` (`incident.file`, `incident.close`, `call.log`) — see
  `docs/admin-console-credits-spec.md` for the convention.
- **Lookup is already indexed:** `Booking` has `@@index([thyrocareOrderId])` and `@@index([paymentBatchId])`,
  so order-ID resolution and sibling-batch expansion are both cheap.

## Migrations

Additive only. Standard `prisma migrate` — timestamped dirs under `prisma/migrations/`. Nothing here alters
existing tables except adding two nested collections to `GET /users/:id`.

⚠️ **Pre-existing landmine, not caused by this work:** the migration chain is **not replayable from an empty
database** (open Lattice finding `MEDIUM-deploy-migrations-cannot-apply-from-scratch`, fails at
`20260429_add_payment_link_lifecycle`). Harmless for live dev/prod, which were migrated incrementally — but
worth knowing if anyone tries a from-scratch rebuild for DR or local onboarding.

## Explicitly out of scope

NPS · CES · call recording · SLA countdown timers · on-call rotation · incident-commander roles ·
urgency×impact matrices · public status page · roles/permissions · any new notification channel ·
extending `admin_audit_log` (before/after **diff** log for config mutations — wrong shape; this needs its own model).
