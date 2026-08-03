# Handoff → jiive-backend — seven places an identifier means one thing to you and another to us

**Date:** 2026-08-03
**From:** jiive-admin (frontend)
**Scope:** backend-only items from a targeted sweep. The frontend half is already fixed and shipped.

---

## Why these are grouped together

Every real bug we hit this fortnight had the same shape:

> **An identifier or signal means one thing at one layer and something else at the next, and nothing flags the mismatch.**

You've already fixed several of these — the results pipeline keying on `(order, lead)` instead of order alone, the orphan worklist retiring an order when only one patient on it was adopted. This is the same sweep run across the rest of the surface. Seven items, ranked by patient harm.

Everything below was verified against **source or live prod**. Where we could not confirm something, we say so rather than guess. We made no changes to the backend codebase.

---

## 1. `GET /admin/results/:id` doesn't say who the patient is — HIGH, live now

**The endpoint returns the account holder and the patient's *name*, but no patient id.** So the admin has no way to link a result to the person it belongs to.

Live on prod right now:

```
GET /admin/results/13b6bc3c-b19e-495e-8fc6-129da5b1dc07
  user.name           = "Zahrah Abdulhameed"     ← the ACCOUNT holder
  booking.patientName = "Hafsah Abdulhameed"     ← whose blood this is
  booking keys        = [patientName, appointmentDate, appointmentTime]
  patientId           = ABSENT
```

**2 of 15 live results already have a different patient from the account holder.**

Until now the admin titled that page with `user.name`, so Hafsah's blood result was headed *"bio_age — Zahrah Abdulhameed"*, and the "Ask AI about this patient" button opened the AI on Zahrah. We've fixed our side to lead with `patientName` and label the account explicitly — but with no `patientId` we still cannot deep-link to the actual patient, so the AI button remains account-scoped and is now labelled honestly as such.

**What we need:** the same patient triple your sibling endpoints already return — `admin.controller.ts:2742` (results list) and `:1705` (user detail) both do the FamilyMember id-join and emit flat `patientId` / `patientName` / `relationship`. The detail endpoint at `:3752-3758` was left behind and selects only `booking.patientName`.

Give us `patientId` there and we'll link precisely and drop the workaround.

---

## 2. The memories readback drops subject scoping — HIGH, latent today

Your own schema is emphatic about this. `prisma/schema.prisma:539-541`:

> *"whose fact this is, never inferred from `userId` alone (an account books for a whole family)"*

`LumiMemory` carries `subjectType`, `subjectId` (FK → FamilyMember) and `subjectKey`, and writers populate them for real (`lumi/memory/retrieval/active-subject.ts:151` writes `subjectType: 'family_member'`).

But `GET /admin/users/:id` queries `where: { userId: id }` and selects only `memoryType, content, relevanceScore, createdAt` — **the subject is dropped entirely** (`admin.controller.ts:1672-1681`, same drop at `:882-891`).

So a fact extracted about the mother — *"diabetic, on metformin"* — renders in our Memories tab under the account holder's name, as the account holder's condition.

The same query also has no `state` filter and omits `verified` / `unconfirmed`, so staged rows (invisible to Lumi's own retrieval), superseded rows, and hedged mentions (*"I think I'm allergic"* — `schema.prisma:568-570`) all render identically to confirmed active facts.

**Latency check, so you can size this correctly:** prod currently has **5 memories across 13 users, 0 clinical, 0 non-self-subject**. Nobody is being shown a wrong attribution *today*. It fires the first time an account records a family member's clinical fact.

**What we need:** mostly deletion, not new code. `memory-readback.service.ts:132-175` **already** returns `subjectLabel` (resolved to the family member's real name), `state`, `clinical`, `verified`, `unconfirmed`, `attributionConfidence`, and is exposed at `GET /admin/lumi/memory/:phone`. Nothing in jiive-admin calls it — we were pointed at the lossy one.

Either enrich the `/users/:id` payload to match, or tell us to switch the Memories tab to the readback endpoint and we will. We'd prefer the latter: it's your canonical read and it already carries everything.

---

## 3. `POST /admin/chat` can create a duplicate account under a real customer's number — MED

The debug "simulate inbound message" box. Chain:

- `admin.controller.ts:1537-1544` (`testChat`) validates shape only — `/^\d{10,15}$/` — and deliberately allows real phones. **No country-code normalization.**
- → `lumi-agent.service.ts:259` calls `normalizePhone()`, which per `lumi/phone-utils.ts:40-49` strips non-digits and **never adds `91`**.
- → `lumi-agent.service.ts:296, 2184-2192` — `prisma.user.upsert({ where: { whatsappPhone: phone } })`.

Type a real customer's number without the `91` and you get a **second** User row with its own conversation history and funnel state. WhatsApp always delivers `91…`, so the two never merge — and `phone-utils.ts` states plainly that existing duplicates are not merged.

This is the identical root cause as the orphan-adopt bug we fixed on our side, through a different door.

**Note the inconsistency:** every `:phone` path param and `?phone=` query param in `admin.controller.ts` *does* normalize — `stripped.length === 10 ? '91'+stripped : stripped` at `:708-709, 873-874, 931-932, 986-987, 1085-1086, 1223-1224, 1466-1467`. Seven copies of the same seven lines. `testChat` is the one that doesn't have it.

**What we need:** normalize in `testChat` too, or reject a bare 10-digit non-synthetic input. Keep the `test_` / `eval_` prefixes passing through untouched — that's the point of the box, and we've matched exactly that gate in our guard.

Note there are two different synthetic allowlists in play, which is itself worth a look: `testChat` at `:1537` accepts only `/^(test_|eval_)/`, while `normalizePhone()` in `lumi/phone-utils.ts:40-49` passes through `test_` / `eval_` / `inv_` / `markdown_`. We matched the narrower endpoint gate. If the wider set is ever meant to reach `testChat`, it currently 400s.

Worth considering: seven duplicated copies of a normalization rule is itself the setup for this class of bug. One shared helper would mean the eighth caller can't forget.

We have added a frontend guard that sends the canonical form, so this can no longer be triggered from our UI. The endpoint is still open to curl.

---

## 4. Feedback customer search claims to match phone, matches name only — MED, live

`feedback.service.ts:196-203` (`listCustomers`) filters on `where: { name: { contains: q.search, mode: 'insensitive' } }`. There is no phone clause.

Confirmed live on prod:

```
GET /admin/feedback/customers                      → 3 rows
GET /admin/feedback/customers?search=919489601444  → 0 rows
GET /admin/feedback/customers?search=9489601444    → 0 rows
GET /admin/feedback/customers?search=Jahir         → 1 row
```

Our UI says *"Search name or phone…"*. An operator searching by number gets zero results and concludes there's no feedback for that customer — when the record exists. Not a format mismatch; the clause simply isn't there.

**What we need:** an `OR` across name and `whatsappPhone`, the way `getCredits` already does it at `admin.controller.ts:2356-2359`. Please use `contains`, not equality — operators type numbers with and without the country code.

---

## 5. `GET /admin/users` returns no total, so our count is a guess — MED, latent

The payload has exactly one key: `users`. No total, no pagination metadata (verified live).

We fetch `?limit=200` and paginate client-side. At 201 users the page will show "200 users" forever and the search box will silently miss everyone past the cap — "no results" would become a lie. Prod is at 14, so it's latent.

**What we need:** a total on the list response, and ideally real server-side pagination + search. We've shipped a stopgap that says "showing first 200 of more" when exactly the limit comes back, but that's inference, not information.

---

## 6. `POST /admin/bookings/:id/inject-report` computes bio-age from the ACCOUNT holder's DOB — MED

`admin.controller.ts:3577-3597` selects only `user: { select: { id, dob } }`, rejects when `!booking.user.dob`, and computes `chronologicalAge` from it. It never reads `booking.patient.dob`. At `:3660` it also hardcodes `gender: 'M'` into the AI-suggestion input.

The production pipeline was fixed for exactly this and cites the Lattice finding in a comment — `results-pipeline.service.ts:144-149`, `HIGH-thyrocare-result-uses-wrong-dob-source`. This endpoint didn't get the same fix.

Nothing in jiive-admin calls it (grep for `inject-report` across `app/` and `lib/` returns nothing) — it's curl-only today. But it writes a **real Result with a real bio-age**, so a booking for a family member produces a bio-age computed from the wrong person's date of birth, with gender forced to male.

**What we need:** read the patient's DOB and gender, same as the production pipeline. Or delete the endpoint if it has outlived its purpose — we'd genuinely prefer that if nothing depends on it.

---

## 7. `saveFailedResult` writes values that were never computed — MED

`results-pipeline.service.ts:628-650` creates the failed row with `chronologicalAge: 0`, and never sets `elevatedFlag` — so it takes the schema default at `prisma/schema.prisma:289`, `Boolean @default(false)`.

The result: a FAILED row is **indistinguishable at the type level** from a genuinely-not-elevated one. `calculatedAge` and `ageDelta` are correctly nullable (`schema.prisma:276, 278`) and come back null; `elevatedFlag` cannot, so it comes back a confident `false`.

Our detail page was rendering that as **"Elevated: No"** next to a fabricated **"Chrono Age: 0"** — a clinical all-clear on a result that was never computed. We've fixed our side to gate the whole block on `status === "completed"`.

**What we need:** make `elevatedFlag` nullable and set it only on the success path, and stop writing `chronologicalAge: 0` — a real age was never established, and `0` is not a safer placeholder than null, it's a more convincing one. If the column can't be nullable for schema reasons, tell us and we'll keep gating on status permanently.

The principle we're applying on our side, for what it's worth: **an absent signal is never a positive assurance.** A value that means "we don't know" must not be storable as a value that means "we checked, and it's fine."

---

## What we've already fixed on our side

So you don't duplicate work:

- Results detail page leads with the patient's name, labels the account holder, and honestly labels the AI button as account-scoped (item 1's workaround).
- Failed / non-completed results no longer render bio-age, chrono age, delta or elevated as values (item 7).
- Results with no booking no longer crash the page (`Result.bookingId` is nullable and the WhatsApp upload path at `results/report-parser.service.ts:423-435` creates rows without one; 0 such rows on prod today, but the page had no error boundary).
- `tel:` links now emit proper `+91…` E.164 — every stored phone is bare `91…` with no `+`, so every Call button in the admin was handing the dialer a 12-digit domestic number.
- Purged users (`whatsappPhone` = `purged:<uuid>`) no longer render as ordinary customers and can no longer be selected in the feedback picker. One such row exists on prod.
- Debug chat sends the canonical `91…` form and refuses unresolvable input, while still allowing the synthetic `test_` / `eval_` / `inv_` / `markdown_` prefixes.
- Usage dashboard no longer shows "0.0% error rate / 0 ms latency" for a range with zero traffic (`langfuse.service.ts:377-384` returns hardcoded zeros on an empty observation set — that's correct as a data contract, it was our rendering that turned it into a verdict).

## Priority we'd suggest

**1 and 2 first** — those are the two where a person's clinical data is attached to, or displayed under, the wrong human being. Item 1 is already happening on prod; item 2 is one family-member fact away.

4 is a five-minute fix and stops an operator drawing a false conclusion daily.

3, 5, 6, 7 are real but bounded. 6 may be deletable.

Questions to isaamm@jiive.ai — happy to jump on a call if any of the evidence above needs walking through.
