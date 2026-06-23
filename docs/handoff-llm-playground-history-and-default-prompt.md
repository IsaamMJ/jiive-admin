# Handoff → jiive-backend — Playground: chat history (backend-synced) + expose default system prompt

**Date:** 2026-06-23
**From:** jiive-admin (frontend / head)
**Env:** dev — `/api/v1/admin/llm-playground`
**Why:** The CEO wants (1) to reopen previous conversations, and we decided to store them **backend-synced** (so they persist across devices / can be shared), and (2) to see the default system prompt in the UI. Both need backend support. Below is the proposed contract — build to this and the frontend wires straight in.

---

## A. Chat history — proposed `conversations` API

Scope: tie conversations to the **logged-in admin** (the session token). Please confirm whether each admin sees **only their own** history or a **shared** pool — default to per-admin unless you want shared.

Behavior we'll implement on the frontend: **auto-save** — create a conversation on the first message, update it after each turn. No manual "save" button.

**1. Create** — `POST /llm-playground/conversations`
```jsonc
// request
{ "title": "What is HbA1c?",            // optional; backend may auto-title from first msg
  "model": "hf",                          // "hf" | "aws"
  "useRag": false,
  "systemPrompt": "",                     // "" / omitted = default
  "messages": [ { "role": "user", "content": "..." }, { "role": "assistant", "content": "..." } ] }
// response
{ "id": "conv_…", "title": "What is HbA1c?", "createdAt": "…", "updatedAt": "…" }
```

**2. List** — `GET /llm-playground/conversations`
```jsonc
{ "conversations": [
  { "id": "conv_…", "title": "What is HbA1c?", "updatedAt": "…", "preview": "first ~80 chars…" }
] }   // most-recent first; pagination optional (limit/offset) if it grows
```

**3. Get one** — `GET /llm-playground/conversations/:id`
```jsonc
{ "id": "conv_…", "title": "…", "model": "hf", "useRag": false, "systemPrompt": "",
  "messages": [ { "role": "user", "content": "…" }, { "role": "assistant", "content": "…" } ],
  "createdAt": "…", "updatedAt": "…" }
```

**4. Update (append turns / rename)** — `PATCH /llm-playground/conversations/:id`
```jsonc
{ "title": "…",                          // optional rename
  "messages": [ … full updated array … ] } // we'll send the full thread after each turn (simplest); say if you prefer append-only
```

**5. Delete** — `DELETE /llm-playground/conversations/:id` → `{ "success": true }`

Questions for you:
- Per-admin or shared history?
- OK with the frontend sending the **full `messages` array** on each PATCH (simplest), or do you want an append endpoint?
- Any conversation count cap / retention you want enforced server-side?

---

## B. Expose the default system prompt

The UI lets the operator override `systemPrompt`; empty = your strong clinical default. The CEO wants to **see** that default. The frontend can't know it (it's server-side and you may tune it). Please expose it read-only, e.g. add to `GET /llm-playground/status`:
```jsonc
{ "aws": {…}, "hf": {…},
  "defaultSystemPrompt": "You are a clinical decision-support assistant for physicians. …" }
```
(or a small `GET /llm-playground/config`). We'll show it as the System-prompt field placeholder / a "View default" preview so they learn what's steering the model.

---

Both are **dev-only** for now (playground backend not on prod). Ping the frontend session once the shapes are firm and I'll wire them in + verify live.
