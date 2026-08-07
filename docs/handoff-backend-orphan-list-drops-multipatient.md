# Handoff → jiive-backend — the orphan worklist drops a multi-patient order after the FIRST adopt

**Date:** 2026-08-03
**From:** jiive-admin (frontend)
**Severity:** High. This puts the second patient back exactly where §8 found her —
tested, paid for, and invisible. Nobody would ever find her again.
**Breaks:** your own §8 rule 4 — *"The worklist keeps an order while anyone on it is unadopted."*

---

## What happened

`VL21989C` covers two patients. We linked **one** of them (Shahina). The order
then disappeared from the worklist entirely, so there is no route left to
**Fareetha** — the whole reason §8 was written.

## Evidence (live prod, just now)

```
GET /thyrocare/orphan-reports
  → ["VL23C8DF","VL11F1CC","VLE2C673","VLE2C673","VLDSIM001","VL0853EA","VL0853EA"]
  → VL21989C ABSENT

GET /thyrocare/orphan-reports/VL21989C      (same moment)
  patientCount: 2   multiPatient: true
  SP86247867  Shahina Rizvana  age 24  adopted=true   booking d6aab876-0aa6-4a62-87d3-653647aac8ab
  SP86247868  Fareetha Rafi    age 50  adopted=false  booking —
```

**Preflight knows Fareetha is unadopted. The list doesn't.** The two endpoints
disagree about the same order at the same instant.

## Likely cause

Adopt marks the `webhook_events` row processed, and the list is built from
unprocessed events. There is **one event per order**, not per patient — so
linking any single person retires the order for everyone on it.

That is the same order-level-vs-lead-level assumption you fixed in the results
pipeline in §8 (`(order, lead)` instead of order alone). The list endpoint still
has it.

## What we need

The list should keep an order while **any** patient on it is unadopted. Either:

- build the list per-patient (a row per unadopted lead — this would also let the
  operator see *who* is outstanding without opening the row), or
- keep it per-order but filter on "any patient unadopted" rather than on the
  webhook event being processed.

We'd mildly prefer **per-patient rows**, since the count in the heading would then
mean "people waiting for results" rather than "orders", which is the number that
actually matters. But either fixes the defect — your call.

Please also confirm the same assumption isn't present anywhere else that keys off
`webhook_events.processed` for a multi-patient order.

## Frontend status

No change needed our side — we render whatever the list returns, and the
multi-patient UI (roster, per-patient adopt, `remainingPatients` warning) is live
and verified against this exact order. It simply never gets the chance to show,
because the row is gone.

Once the list is fixed, `VL21989C` should reappear with Fareetha outstanding and
the existing UI handles her.

## Immediate workaround (not a fix)

Preflight and adopt both still work for `VL21989C` directly — only the discovery
path is broken. If this will take a while, tell us and we'll add a "look up an
order by ID" box so an operator can reach a dropped order manually in the
meantime.
