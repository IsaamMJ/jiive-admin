# Handoff → jiive-backend — the AI patient context blends multiple people into one

**Date:** 2026-07-26
**From:** jiive-admin (frontend)
**Severity:** clinical. The playground AI is handed two different people's biology
as if they were one patient. It's the AI-side twin of the results mis-attribution
you just fixed — same root cause (an account is a household, not a person).

## What's wrong

The profile "Ask AI about this patient" button deep-links to the playground with
`?userId=<account>`, which calls:

```
GET /llm-playground/patients/by-user/<userId>
```

That endpoint returns **one** de-identified patient. But an account can have booked
for several family members, and this endpoint merges them into a single record.

Live, prod account **Mohamed Isaam** (`50113eba-…`), whose account has two
results — Aisha Beevi (chrono 74, bio-age 65.7) and Nisha Fathima (chrono 52,
bio-age 60.1):

```jsonc
{
  "id": "50113eba-…",
  "sex": null,
  "ageBand": "70–79",
  "chronologicalAge": 74,        // ← Aisha's age, presented as THE patient's age
  "latestBioAge": 65.7,          // ← Aisha's result
  "bookings": [
    { "testType": "…", "results": [ …Aisha's biomarkers… ] },
    { "testType": "…", "results": [ …NISHA's biomarkers… ] }   // ← a 52-year-old's
  ]
}
```

So the model is told "one 74-year-old, two tests." It isn't — it's a 74-year-old
**and** a 52-year-old. Nisha's biomarkers get reasoned about under Aisha's age
header. For a tool that gives health guidance, that's the dangerous kind of wrong.

## What we need

The AI context must be **one subject per patient**, never blended across family
members. Concretely, `by-user/<userId>` should return **a list** — one
de-identified context per FamilyMember on the account — instead of a single merged
record:

```jsonc
{
  "patients": [
    { "id": "<patient-1>", "label": "70–79 · bio-age 65.7", "deidentified": { …only Aisha… } },
    { "id": "<patient-2>", "label": "50–59 · bio-age 60.1", "deidentified": { …only Nisha… } }
  ]
}
```

- Each `deidentified` block contains **only that one person's** age, bookings, and
  biomarkers. No cross-member data.
- Keep the de-identification exactly as-is (no names) — that part is right. The
  problem is purely that two bodies share one record.
- A single-patient account returns a one-element list. An account with no patient
  record returns an empty list (we already handle "no patient available").
- The individual patients already look like they exist as separate playground
  entries (`GET /llm-playground/patients` lists per-person rows) — so this is
  about `by-user` returning the right per-member set, not inventing a new model.

### Question

Is each de-identified patient keyed to a **FamilyMember id** (so the split is
clean and stable), the same id-based link you used for the results fix? If so this
is the same join, applied here.

## Two more things we need for the per-patient "Ask AI" button

We're adding an **"Ask AI about this patient"** button on the Results tab, grouped
per person (so Nisha's three tests get ONE button that loads all three, never one
isolated result, never blended with Aisha). For that button to target the right
person we need:

1. **`patientId` on each result** — the FamilyMember id — in both `GET /users/:id`
   `results[]` and `GET /results`. It's the same id-based link behind the
   `patientName`/`relationship` you just shipped; we just need the id itself
   exposed so we can deep-link to that one person.

2. **A per-patient context endpoint** to deep-link into, e.g.:
   ```
   GET /llm-playground/patients/by-patient/:patientId
   → { id, label, deidentified }   // only that ONE person's history
   ```
   Same shape as `by-user` returns for a single patient today — just keyed by the
   FamilyMember id instead of the account, and never merged.

With both, the button links to `/playground?patientId=<patientId>` and the AI gets
exactly that person's full de-identified history.

## Frontend plan (waiting on the above)

Once `by-user` returns a list:
- One patient → auto-load it exactly as today (no change for the common case).
- Two or more → show a picker ("this account has N patients: <label>, <label> —
  which one?") and load only the chosen person's context.

The Results-tab per-patient button (gated on `patientId` being present) and the
`?patientId=` playground deep-link are already built on our side — they render and
work the moment the two items above ship. Confirm the response shapes and we're
done.
