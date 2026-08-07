# Handoff → jiive-backend — Playground: AWS context overflow hard-400s instead of fitting

> **STATUS: ✅ DONE (2026-06-27).** Backend shipped the AWS 8k context-overflow clamp to prod
> (verified + logged) — output is clamped to fit instead of hard-400ing. Frontend guard deemed
> unnecessary as a result. Kept for reference.

**Date:** 2026-06-26
**From:** jiive-admin (frontend / head)
**Env:** dev + prod — `/llm-playground/chat`, AWS MedGemma
**Priority:** MEDIUM-HIGH (operators hit this on loaded-patient chats — a dead-end error)

## What happens

On AWS MedGemma, when a chat has a patient loaded (the de-identified patient is
~5.9k tokens by itself for a 5-booking patient) plus a few turns of history, the
request gets a raw provider **400**:

> `400 This model's maximum context length is 8192 tokens. However, you requested
> 1536 output tokens and your prompt contains at least 6657 input tokens, for a
> total of at least 8193 tokens. Please reduce the length of the input prompt or
> the number of requested output tokens. (parameter=input_tokens, value=6657)`

i.e. input (6657) + requested output (1536 default) = 8193 → **1 token over** the
8192 ceiling → the whole turn fails. The operator gets a red error and no answer,
even though ~1535 output tokens would have fit fine.

## Outcomes we want (you choose the how)

1. **Don't hard-fail when only the output budget overflows.** If `input + requested_output
   > context_window` but `input < context_window`, **clamp the output to what fits**
   (`context_window − input − small_safety_margin`) and still return an answer. A slightly
   shorter answer beats a dead-end error.
2. **Only error when the input ALONE doesn't fit** (`input ≥ context_window`). In that case
   return a **clean, actionable error** — not the raw provider 400 — e.g. a code like
   `context_exceeded` with a message such as *"This chat is too long for MedGemma's 8k
   window — start a new chat or switch to HuggingFace."* so the frontend can render it nicely
   and point the operator to the 128k HuggingFace model.
3. **(Optional, related)** This is the long-discussed case for **summarization-based
   compaction** of older turns so loaded-patient chats survive longer on the 8k model. Not
   required for this fix, but this is the trigger.

## Notes
- HuggingFace (128k) doesn't hit this; it's specific to MedGemma's 8k window. The clamp +
  clean error is what makes AWS usable for loaded-patient chats.
- Frontend will also add a guard (cap requested output to the remaining window + a near-limit
  nudge), but the server-side clamp is the durable fix — any direct API consumer hits the
  same wall otherwise.
