# Handoff → jiive-backend team — LLM Playground blockers (from frontend live test)

**Date:** 2026-06-22
**From:** jiive-admin (frontend) session
**Tested against:** dev — `https://jiive-dev.isaam.dev/api/v1/admin/llm-playground`
**Contract doc:** `jiive-backend/docs/handoff-llm-playground-api.md` (branch `feat/llm-playground-backend-p1`)

## TL;DR

The frontend LLM Playground page is **built and contract-validated against dev** — the SSE wire format, `meta`/`token`/`done`/`error` events, and pre-SSE 400s all match the contract exactly, and **AWS MedGemma streaming works end-to-end** (real tokens returned). The UI is deployed and degrades gracefully.

**But the team cannot use it for real answers yet because of 3 backend/ops issues below.** None are frontend bugs — the UI already handles every one of these states gracefully; they just need the backend wired up.

---

## What I verified works (no action needed)

- `POST /chat` `model:"aws"` → streams real answers. `done` event returned `{"latencyMs":492,"promptTokens":36,"completionTokens":15}`.
- SSE format is exactly `event: <name>\ndata: <json>\n\n`. Frontend parser matches.
- `meta` omits `ragSources` when RAG off — handled.
- `error` event `hf_not_configured` fires cleanly.
- `POST /chat` validation: empty prompt → 400 `Too small: expected string to have >=1 characters`; >8000 chars → 400 `Too big: expected string to have <=8000 characters`. (Frontend also guards both client-side.)

---

## Blocker 1 — `/status` reports `aws.state:"error"` while `/chat` to AWS works  ⬅ HIGH

**This is the most important one.** The status endpoint disagrees with reality.

**Evidence:**
```
GET /llm-playground/status
→ {"aws":{"running":false,"state":"error","instanceId":"i-077c7a337725ec906"},"hf":{...}}

POST /llm-playground/chat  {"prompt":"hello","model":"aws","useRag":true}
→ event: meta  data: {"model":"aws"}
  event: token data: {"delta":"Hello"}
  event: token data: {"delta":"!"} ...   ← box is clearly UP and serving
```

So the MedGemma box is running and answering, but `GET /status` returns `aws.state:"error"` — meaning the `DescribeInstances` SDK call is failing for some reason (per the contract, `"error"` = "SDK call failed for another reason").

**Impact on the console:** the operator sees a red **"Error"** status pill and a **disabled** Start/Stop box button, even though chat works. Confusing and looks broken.

**Likely cause:** the `ec2:DescribeInstances` IAM permission isn't on the ECS task role yet (the original handoff flagged the IAM policy as "not yet done"), OR a region/credentials issue on the describe call. Note: this is the same IAM policy needed for `/box` start/stop. If it were a pure permission denial the contract says it should surface as `permission_denied`, not `error` — so please check why it's `error` specifically.

**Fix:** apply the `ec2:DescribeInstances/StartInstances/StopInstances` inline policy on `jiive-ecs-task-role` (from the original handoff, instance `i-077c7a337725ec906`), and confirm `/status` then returns `aws.state:"running"`.

---

## Blocker 2 — HuggingFace not configured  ⬅ HIGH (usability)

**Evidence:**
```
GET /llm-playground/status → {"hf":{"configured":false,"endpointUrl":null}}
POST /chat {"model":"hf"} → event: error data: {"error":"hf_not_configured","message":"HuggingFace endpoint URL or token not configured"}
```

**Impact:** the HF model option is disabled in the UI (correct behavior). The team can't compare HF vs AWS until this is set.

**Fix:** set `HUGGINGFACE_ENDPOINT_URL` + `HUGGINGFACE_API_TOKEN` (Secrets Manager). **Also rotate the HF token** — the original handoff noted it leaked into chat (secret `jiive/medgemma-hf-token`).

---

## Blocker 3 — RAG returns zero sources  ⬅ MEDIUM

**Evidence:**
```
POST /chat {"prompt":"What are symptoms of hypothyroidism?","model":"aws","useRag":true}
→ event: meta  data: {"model":"aws"}      ← no ragSources, even with useRag:true on a clear medical query
```

**Impact:** the "Grounded on N sources" panel has no data to display — RAG looks on, but no grounding is shown. The de-identified-data / grounding story (the whole point for Juveira) isn't demonstrable yet.

**Likely cause:** the Qdrant collection is empty / not wired on dev, or retrieval returns nothing.

**Fix:** confirm the RAG/Qdrant store is populated and retrieval returns sources on dev. Once it does, the frontend will render `meta.ragSources` automatically — no frontend change needed.

---

## Summary for the team

| # | Issue | Severity | Owner action |
|---|---|---|---|
| 1 | `/status` says `aws.state:"error"` but `/chat` aws works | HIGH | Fix DescribeInstances/IAM on ECS task role |
| 2 | HF not configured | HIGH | Set `HUGGINGFACE_*` env + rotate leaked token |
| 3 | RAG returns no sources | MEDIUM | Populate / wire Qdrant on dev |

Frontend is ready and waiting — all three states are already handled gracefully in the UI; fixing the backend is all that's needed to light it up. Ping the frontend session if any endpoint shape changes.
