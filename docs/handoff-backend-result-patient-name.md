# Handoff → jiive-backend — results don't say WHO they're for

**Date:** 2026-07-26
**From:** jiive-admin (frontend)
**Severity:** clinical mis-attribution. On a diagnostics product this is the
dangerous kind of missing field — a result is shown under the wrong person.

## What's wrong

One account can book for several people (self, family). But on the user profile,
the **Results** tab shows every result with no indication of *whose* it is — so
they all read as the account holder's.

Live example, prod account **Mohamed Isaam** (`50113eba-d082-42f3-b0e4-56dda2c6f774`):

| Bio Age | Chrono | Delta | elevatedFlag | Actually the subject |
|--------:|-------:|------:|:------------:|----------------------|
| 65.7    | 74     | −8.3  | false        | **Aisha Beevi**      |
| 60.1    | 52     | +8.1  | **true**     | **Nisha Fathima**    |

Isaam is the account holder (the WhatsApp number) and the subject of **neither**.
The 60.1 result is flagged elevated — and right now it looks like it's Isaam's.
An operator reading this could act on the wrong person's clinical flag.

## The data already exists — one payload just drops it

- `GET /users/:id` → each object in `results[]` has **no** patient/subject field.
  **This is the payload the profile Results tab renders.**
- `GET /results?userId=…` → each result **does** carry `booking.patientName`
  ("Aisha Beevi", "Nisha Fathima").

So you already know who each result belongs to; it's simply absent from the
`/users/:id` results objects.

## The ask

Add the subject's name to each result in the `GET /users/:id` `results[]` array —
the same value `GET /results?userId=` exposes as `booking.patientName`:

```jsonc
{
  "id": "bed40853-…",
  "testType": "bio_age",
  "calculatedAge": "65.7",
  "chronologicalAge": "74",
  "patientName": "Aisha Beevi",   // ← ADD THIS (the booking subject)
  "reportUrl": "https://…",
  …
}
```

One field, already on the record. We add a "Patient" column and the ambiguity is
gone.

### While you're there — same gap, other direction

`GET /results?userId=` has `patientName` but is **missing** `reportUrl` and the
`retestReminder*` fields that `/users/:id` has. If it's little effort, making the
two result shapes carry the same fields (patientName + reportUrl + reminder on
both) would let us stop special-casing which endpoint we read. Not required —
the one field above is the fix.

## Frontend status

Ready to add the Patient column the moment `patientName` is on the `/users/:id`
results. Not guessing the key — confirm `patientName` (vs `subjectName` / nested
`booking.patientName`) and we render it.
