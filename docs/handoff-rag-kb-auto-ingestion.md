# Handoff → jiive-backend — RAG/KB v2: automated, self-serve, clinical-safe ingestion

**Date:** 2026-06-28
**From:** jiive-admin (frontend / head)
**Status:** 🔶 OPEN — design converged after 4 adversarial review rounds + 2 cited deep-research passes.
**Builds on:** the existing `/api/v1/admin/rag` endpoints (upload/list/approve/delete/overview already live).
This is the next phase: a **fully automated pipeline + bulk import + versioning + clinical-safety controls**
so the non-technical owner (Juveira) self-serves with **zero founder dependency**, at production quality.

> Philosophy: outcomes + non-negotiable constraints below; you own the implementation. Where a mechanism is
> named, it's the *behaviour* we need — pick whatever delivers it. The "must-haves" are non-negotiable because
> each one closes a silent-corruption or data-loss path we found in review.

## Goal
Juveira provides content; the system does ALL the technical work automatically; she only **reviews + approves**.
The founder is out of the loop entirely. Content is **medical reference** for an internal clinician-assist tool
(not patient-facing) — so silent wrong facts are the thing we must prevent.

## Non-negotiable clinical-safety constraints
1. **Verbatim source.** The LLM/pipeline may clean, chunk, and embed — it must **never rewrite, reframe, or
   invent clinical facts.** (Research: rewriting source facts is unsafe for medical; verbatim copying reduces
   hallucination. No proposition/Dense-X rewriting.)
2. **Human review gate is non-optional** — every doc is human-approved before it serves. **No bulk auto-approve.**
3. **A doc is `ready` only when ALL its chunks are indexed.** Any unrecoverable chunk failure → `failed`,
   never a partial-ready doc. (Prevents silent incomplete retrieval.)
4. **Fail toward MORE review, never less** (see review model).

## Automated pipeline (hands-off)
`PDF or pasted-text → parse → mechanical clean → chunk → embed → store`.
- **Plain embeddings** (`text-embedding-3-small`). **Contextual Retrieval is deferred** — do NOT add per-chunk LLM
  augmentation in v1 (it's the dominant cost + failure surface and wasn't needed). Revisit only if retrieval
  measurably underperforms.
- **Scanned / empty / unreadable PDFs auto-FAIL loudly** with a clear reason (distinguish "scanned/no text" vs
  "encrypted/locked") — never silently ingest an empty doc.

## Parser — ONE engine only
- Use a **single layout-aware parser** (Docling/Marker-class — preserves tables). **A second/weaker parser path
  is forbidden** (a weaker "trickle" parser would silently reintroduce table-mangling forever).
- **Bulk import** = run it as a **one-shot batch job** (spin up, parse, tear down) — not standing infra.
- **Trickle** (ongoing new docs) = **same engine, invoked per-doc** (cold-start is fine at a few docs/week).
- Parser must emit per-doc **table-presence flag + extraction-confidence** (drives the review split below).
- **Decide managed-API vs self-host explicitly on the data-handling axis** — this is medical content; don't send
  the corpus to a third party without that call being made.

## Review model — split, biased toward safety
Tables are where parsers fail and where wrong values are most dangerous (reference ranges, dosing). So:
- **Forced side-by-side review** (rendered source page vs parsed text, no fast-approve) for any doc that is
  **table-flagged OR low extraction-confidence OR multi-column/numeric-dense.** The detector is **biased to
  over-flag** — a false positive costs seconds; a false negative leaks a mangled table.
- **Fast keyboard approve** only for clearly text-dominant, high-confidence docs — **with a one-key "this has a
  table / looks wrong → send to forced review" escape.**
- **Audit log records who approved + whether it was fast vs forced-diff.**
- ⚠️ **Expectation to set:** on a table-heavy bulk library, most docs will route to forced review — so the
  one-time bulk is a **planned, batched multi-session review effort**, not instant. That's intended (safety),
  but flag it so it's not a surprise.

## Versioning / replace / retract — atomic on single-node Qdrant
- Re-uploading a doc processes in the background; the **old approved version keeps serving until the new one is
  approved**, then cut over.
- **The cutover must be atomic: a reader always sees exactly ONE complete version — never zero, never two.**
  Suggested mechanism: per-doc **`active_version_id` pointer** (doc record holds it; chunks carry
  `(doc_id, version_id)`; retrieval filters `version_id == active_version_id`; cutover = single-field update).
  **Never delete old chunks before the new version is live** (insert → flip pointer → then delete old).
- **Unpublish** = clear the pointer (pull from retrieval) without deleting the raw file (soft-delete).
- Sweep orphaned non-active-version chunks on restart/periodically (storage hygiene; they're filtered from
  retrieval so it's not a correctness issue).

## IDs, idempotency, resumable bulk
- **Two distinct keys:** content **hash** = dedupe / restart-idempotency; **doc record** (title+source) = human
  identity that replace targets. Don't overload one key for both.
- **Skip-on-restart checks INDEX STATE** (is this version actually live/`ready`), **not just "hash seen"** — so a
  soft-deleted or never-completed doc correctly reprocesses instead of being skipped forever.
- Bulk = **bounded-concurrency sequential**, **429 → retry/backoff, never fail-on-rate-limit**.
- Identical content uploaded as a *new* doc record → **warn "identical content already exists as <title>"** at
  upload, don't silently skip.

## Traceability, freshness, conflict surfacing
- **Keep the raw source file**; answers **cite all retrieved sources** (existing `ragSources`).
- **Source date is human-entered/confirmed at review** (explicit **"unknown"** allowed and rendered literally as
  "date: unknown" in citations — never coerced to upload date). Auto-extraction picks the wrong date confidently,
  so don't.
- **Conflict surfacing:** a **deterministic numeric-conflict check is the PRIMARY control** — in code, flag when
  the same retrieved quantity has divergent numeric values across sources, shown in the UI independent of the LLM
  (so two different reference ranges aren't laundered into one confident answer). The system-prompt
  "present side-by-side, don't reconcile" instruction is **secondary**. Treat it as best-effort surfacing, not a
  guarantee (it can't catch same-fact/different-wording); the cite-all-verbatim backstop is what makes a miss safe.
  Keep a small **regression test set, re-run on any model/prompt change.**

## Cost / size signal
- **No dollar estimate** (embedding is near-free without Contextual Retrieval). Show a **"~N chunks will be
  created"** size signal at upload to catch an accidental giant dump. Optional simple monthly-actual number.

## Permissions
- All 3 admins upload/approve/delete, **server-enforced**, audit-logged. Delete = confirm + **soft-delete**
  (raw file retained).

## Explicitly DO NOT build (gold-plating refuted in research/review for this 3-user scale)
- Contextual Retrieval in v1 · multi-stage/role-based approval · per-upload dollar cost tracking · toxicity
  classifier · valid_from/valid_to temporal versioning · GRADE/provenance metadata grading · critic-agent
  post-hoc verifier · AV scanning · HA/multi-node Qdrant · dashboards/metrics stores.

## Frontend status
The `app/rag/` page already implements list/upload/status/review-drawer/approve/delete. The deltas above
(forced-vs-fast review split, table-flag surfacing, size signal, conflict flag, version/replace UX) will be wired
on top once you confirm the endpoint shapes. Send the firm contract and the teammate builds it; head verifies live.
