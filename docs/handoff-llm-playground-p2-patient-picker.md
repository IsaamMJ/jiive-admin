# Handoff → jiive-backend — Playground P2: de-identified patient picker

**Date:** 2026-06-23
**From:** jiive-admin (frontend / head)
**Env:** dev — `/api/v1/admin/llm-playground`
**Scope:** P2 is **just the de-identified patient picker.** We are **dropping answer ratings** (👍/👎) — not worth the added surface. So no ratings endpoint needed.

## What we're building
In the chat, the operator picks a de-identified patient; the chat then answers **about that patient** using their clinical data (e.g. "is this patient's HbA1c concerning?"). We need the API below.

## Proposed contract (build to this; tweak and tell us)

**1. List patients (for the picker)** — `GET /llm-playground/patients`
```jsonc
{ "patients": [
  { "id": "pt_…", "label": "Patient A · 45M", "summary": "T2DM, on metformin" }  // de-identified label + short summary
] }
```

**2. Patient detail (to DISPLAY what's loaded)** — `GET /llm-playground/patients/:id`
```jsonc
{ "id": "pt_…", "label": "Patient A · 45M",
  "data": { /* structured de-identified clinical data: labs, vitals, history */ } }
// or a preformatted text block if that's easier — tell us which.
```

**3. Use the patient in chat** — extend `POST /chat`
- Add optional `patientId: string`.
- **Backend injects that patient's de-identified data as context server-side** (so the frontend never handles raw clinical data — cleaner + safer). We just send the `patientId` alongside `messages` / `model` / `useRag` / `systemPrompt`.
- Confirm: where does the patient context go (system message? appended context?), and how does it interact with `useRag`?

## Questions for you
1. Where do these de-identified patients come from — a curated test set, or real patients anonymized server-side?
2. Is **de-identification done entirely server-side** (frontend never sees PII)? Please confirm — we want to only ever handle the `id` + the de-identified `label`/`data` you return.
3. Do you prefer the **`patientId`-on-/chat** approach (backend injects), or should the frontend fetch the data and put it in the prompt? We strongly prefer backend-injects.
4. Detail format for display: structured fields or a text block?

Dev-only for now. Ping the frontend session with the firm shapes and I'll wire the picker in + verify live.
