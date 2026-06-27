# Handoff → jiive-backend — Playground: open a real patient from the admin

> **STATUS: ✅ DONE (2026-06-27).** Backend shipped `GET /patients/by-user/:userId` (Option A)
> to dev + prod; frontend "Ask AI about this patient" buttons (user detail / booking expanded /
> result detail) are live on prod and verified (by-user route returns 401 unauth → route exists).
> Kept for reference.

**Date:** 2026-06-25
**From:** jiive-admin (frontend / head)
**Env:** dev — `/api/v1/admin/llm-playground`
**Priority:** MEDIUM (real team friction — they're using the playground daily now)

## The friction (from the team)

Operators don't *start* in the playground. They're looking at a real patient
somewhere in the admin (users page, a booking, a result), and *then* want to ask
the LLM about that same person. Today they have to leave the patient, go to the
playground, and re-find them in a list of near-identical de-identified labels
(`male · 30–39 · bio-age 39.0` × N). It's guesswork and they hate it.

The admin identifies patients by **name + phone** — there is no human-readable
"patient id" anywhere, and the playground hides name/phone on purpose. So showing
an id in the picker doesn't help. The fix is to let them jump straight from the
patient they're already looking at into the playground with that patient loaded.

## What we want to build (frontend)

An **"Ask AI about this patient"** button on the user/booking/result pages →
opens `/playground?userId=<realUserId>` → the playground resolves that to its
de-identified patient and pre-selects it. The operator never sees or handles an id.

## The one thing we need from you

A way to resolve **a real user id → that user's de-identified playground patient.**
Pick whichever is cheapest on your side:

**Option A (preferred) — resolve endpoint:**
`GET /llm-playground/patients/by-user/:userId`
→ returns the **same shape** as `GET /llm-playground/patients/:id`
   (`{ id, label, deidentified: {...} }`), so the frontend can pre-select + preview.
→ `404 { error: "patient_not_found" }` if that user isn't in the de-identified
   set or has no clinical data to ground on.

**Option B — accept userId on the existing detail call:**
`GET /llm-playground/patients/:id?idType=user` (or a `userId` query param).

Either works. We just need: *given the real user id we already have on the
admin page, hand us back the playground patient (id + de-identified detail).*

## Questions

1. Is **every** real user available as a de-identified playground patient, or only
   a curated subset? (Decides whether the button should be shown always, or only
   when a patient exists — we can hide/disable it on a 404.)
2. Any users we must **never** expose this way (consent / data-sensitivity)? If so,
   the resolve endpoint should 404 them like any other miss.
3. Confirm the resolve returns the **same de-identified shape** — frontend handles
   no PII, same as today.

Dev-only for now. Ping the frontend session with the firm shape and the teammate
wires the button + deep-link + pre-select, and I verify live.
