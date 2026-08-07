# LLM Playground — Backend Fixes Needed

Found via stress testing (2026-06-23). Frontend already handles these gracefully, but fixing backend would improve the experience.

> **STATUS (2026-06-27):** BUG1 (useRag default), BUG2 (31s hang), ISSUE3 (KB-grounding leak)
> reported shipped by backend. **Q6 (exact age in LLM context) ✅ DONE** — model gets exact age,
> UI shows band. **BUG7 (junk picker `summary`) ✅ DONE** — shipped to prod. Remaining/unconfirmed:
> NOTE4 (RAG completion cap) and NOTE5 (patient biomarker data-quality, upstream).

---

## BUG 1 — `useRag` has no default in the Zod schema (PRIORITY: HIGH)

**What happens:** Any request that omits `useRag` gets a spurious second validation error appended to every other error message.

- Omit `useRag` + invalid model → `"Invalid option: expected one of 'aws'|'hf'; Invalid input: expected boolean, received undefined"`
- Include `useRag:false` + invalid model → `"Invalid option: expected one of 'aws'|'hf'"` (clean)

**Fix:** Add `.default(false)` to the `useRag` field in the Zod schema for `/llm-playground/chat`. Frontend always sends it so this is masked there, but any future caller or test gets misleading compound errors.

---

## BUG 2 — AWS stopped box: 31s wait before timeout error (PRIORITY: HIGH)

**What happens:** When the EC2 box is stopped, the backend still forwards the request to AWS and waits ~31 seconds before returning `{"error":"provider_error","message":"Request timed out."}`.

**Impact:** Users sending a message on the AWS model with a stopped box wait 31 seconds for an unhelpful error. Frontend now fast-fails on `state === "stopped"`, but only if the status poll is fresh. If status is stale, the 31s wait still hits.

**Fix:** In the `/chat` handler, before forwarding to EC2, check the current AWS instance state. If `state !== "running"`, immediately return SSE error event:
```
event: error
data: {"error":"aws_offline","message":"MedGemma box is offline — start it first."}
```
This eliminates the 31s timeout and gives an actionable error code.

---

## ISSUE 3 — Default system prompt leaks KB-grounding language when RAG is off (PRIORITY: MEDIUM)

**What happens:** The `defaultSystemPrompt` ends with:
> "When knowledge-base context is provided below, ground your answer in it."

When `useRag: false`, no KB context is injected — but the model still opens answers with "Based on the provided knowledge base..." because the instruction is still in the prompt.

**Impact:** Users see "Based on the provided knowledge base" even when RAG is off. Misleading.

**Fix:** Make the KB-grounding sentence conditional — only append it to the system prompt when `useRag: true`.

---

## NOTE 4 — RAG completion tokens capped at 500 (PRIORITY: LOW)

**What happens:** With `useRag: true`, `done.completionTokens` is exactly 500 — the hard cap. Longer answers (like "explain biological age in detail") are truncated mid-thought.

**Fix:** Consider raising `max_new_tokens` for RAG queries, or at minimum confirm this is intentional and the UI should show a "response may be truncated" indicator.

---

## NOTE 5 — Patient biomarker data quality issues (PRIORITY: LOW, upstream)

Found in the de-identified patient data returned by `/llm-playground/patients/:id`:
- `glucose: "6.0 mmol/L"` with `referenceRange: "70-100"` — that reference range is in mg/dL, not mmol/L. Unit mismatch.
- `crp: "-1.0 ln(mg/dL)"` — negative CRP is unusual; the `ln()` transformation should probably be unwrapped for display.
- One patient: `female 20–29, bio-age 12.9` — bio-age of 12.9 years for an adult female looks implausible (likely a data pipeline issue).

The LLM reproduces these values verbatim to clinicians. Worth cleaning before the medical team uses it.

---

## QUESTION 6 — Does the LLM context get exact chronological age, or only the band? (PRIORITY: MEDIUM)

The team noticed the picker shows chronological age as a **band** (`male · 50–59`)
while bio-age is **exact** (`44.8`). The contract (`/patients/:id`) only ever returns
banded chronological age (`ageBand`, `chronologicalAgeBand`) — no exact value anywhere.

**Question:** when a patient is injected into the chat context server-side via
`patientId`, does the model receive the **exact chronological age** or only the band?
It matters clinically — a 50yo and a 59yo reason very differently, and the model
can't tell them apart if it only has `50–59`.

**Decision needed:** is it acceptable (privacy-wise) to inject exact chronological
age into the *server-side* model context (never shown in the frontend UI, which stays
banded)? If yes, please inject it. If no, confirm the model is reasoning on the band
so we set expectations with the medical team.

---

## BUG 7 — Picker `summary` field is junk (PRIORITY: MEDIUM)

`GET /llm-playground/patients` returns a `summary` per patient that is currently
echoing raw field names, e.g. `"bio_age, bio-age 44.8"`. It renders as a useless
grey line under each entry in the picker and confuses operators.

**Fix:** make `summary` a real one-line human description (e.g. `"T2DM, cardiac risk"`
/ `"elevated bio-age, 2 bookings"`), or return it empty and we'll drop the line.
Right now it's noise.
