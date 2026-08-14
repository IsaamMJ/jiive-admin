# Handoff → jiive-backend — the de-blend is half-done: chat rejects the new patient ids

**Date:** 2026-07-27
**From:** jiive-admin (frontend)
**Severity:** the "Ask AI about this patient" feature is **non-functional on prod**.
The buttons deep-link correctly, but the chat 404s the moment a message is sent.

## What's wrong

You moved the **read** side to FamilyMember ids (great — Aisha & Nisha are now
separate). But `/llm-playground/chat` and `/llm-playground/patients/:id` still only
understand the **old account-keyed id space**. So the ids we're handed can't be
used to chat.

### Two disjoint id spaces (verified live on prod)

| Endpoint | id it returns / accepts | Example |
|---|---|---|
| `GET /users/:id` results `.patientId` | **FamilyMember** | `1f63678a…` (Aisha) |
| `GET /llm-playground/patients/by-user/:userId` | **FamilyMember** | `1f63678a…`, `d10b43c0…` |
| `GET /llm-playground/patients/by-patient/:id` | **FamilyMember** | echoes `1f63678a…` |
| `GET /llm-playground/patients` (list) | **legacy/account** | `25059b7e…`, `50113eba…` |
| `GET /llm-playground/patients/:id` (detail) | **legacy/account** | 200 for `25059b7e…`, **404 for `1f63678a…`** |
| `POST /llm-playground/chat` `{patientId}` | **legacy/account** | 201 for `25059b7e…`, **404 for `1f63678a…`** |

Proof:
```
POST /llm-playground/chat { patientId: "1f63678a…" (Aisha, from by-patient) }
  → 404 { "error":"patient_not_found", "message":"Patient 1f63678a… not found or has no health data" }

POST /llm-playground/chat { patientId: "25059b7e…" (a legacy /patients id) }
  → 201 (streams fine)
```

Note the legacy list still contains `50113eba…` labelled "Unknown · 70–79 · bio-age
65.7" — that's **Isaam's account id**, i.e. the old *blended* entry. So the legacy
space is exactly the pre-fix, account-keyed, blended world.

## The fix

Make the **chat** (and the patient detail/list the picker uses) speak the **same
FamilyMember id space** that `by-user` / `by-patient` / `result.patientId` now
return. Concretely:

1. `POST /llm-playground/chat` must resolve a **FamilyMember `patientId`** to that
   one person's health data (the same context `by-patient/:id` already builds).
2. `GET /llm-playground/patients/:id` should resolve a FamilyMember id too (the
   picker fetches this to show the selected-patient chip — it currently 404s).
3. Ideally `GET /llm-playground/patients` (list) returns FamilyMember-keyed
   patients as well, so the manual picker and the deep-link agree. Otherwise
   there are two patient systems and the manual picker still serves blended,
   account-keyed entries.

Once `/chat` accepts FamilyMember ids, the whole flow lights up — no frontend
change needed; we already pass exactly that id through.

## Frontend status

Correct and unchanged: the Results-tab per-patient "Ask AI" deep-links
`?patientId=<FamilyMember id>`, the profile button resolves `by-user` → picker,
and both set that id as the chat's `patientId`. The chat just has to accept it.

**Question:** do you want us to temporarily hide the Ask-AI entry points on prod
until `/chat` resolves the new ids (so operators don't hit "patient not found"),
or will the chat fix land fast enough to leave them up? One flag on our side either
way.
