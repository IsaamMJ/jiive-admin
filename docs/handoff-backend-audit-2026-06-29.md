# Backend audit — prioritized report for the jiive-backend team

**Date:** 2026-06-29
**From:** jiive-admin (frontend / head) — **report only, no backend changes were made.**
**Method:** automated stability/security/scale audit of `jiive-backend` + this week's evidence,
with the highest-stakes claims **spot-verified at file:line by head** before inclusion.

> **Note:** `jiive-backend` already has a `.lattice/` with **61 open findings (11 HIGH / 24 MEDIUM / 26 LOW).**
> This report is a **prioritized lens on top of that** — it surfaces the items worth doing first and
> flags two your own Lattice rates lower than the compliance risk suggests. Reconcile with your existing
> findings rather than treating these as net-new.

## How to read confidence
- ✅ **Confirmed** — verified at file:line (by head spot-check or this week's work).
- ⚠️ **Flagged, unverified** — auditor-reported; **backend should confirm at file:line before acting.**
- ❌ **Refuted** — checked and found NOT to be a problem; do not chase.

---

## ❌ Refuted — do NOT spend time on these
- **Thyrocare webhook signature validation is PRESENT.** Constant-time `timingSafeEqual` with a length
  pre-check at `thyrocare-webhook.controller.ts:105` (import line 23). The audit's "no HMAC validation"
  was a false alarm. ✅ verified.
- **CORS is safe-by-default.** Only emits headers when `CORS_ALLOWED_ORIGINS` is set (`main.ts:62-72`).
  The earlier stress-test CORS finding was a dev misconfig, not a code bug. ✅ verified.

---

## 🔴 CRITICAL — compliance / revenue (verify, then fix first)
1. **Raw lab XML stored unencrypted** — `results/report-parser.service.ts:300` (`results.rawxml`). Contains
   patient identifiers + test data in plaintext. ⚠️ *Your Lattice rates this MEDIUM
   (`MEDIUM-rawxml-column-unencrypted.yml`); the compliance argument (GDPR/DPDP, breach exposes PII) says
   re-triage to CRITICAL.* Fix: encrypt-at-rest (KMS) + lazy decrypt in service layer (~15 LoC). **Backend to confirm the column/usage.**
2. **Patient data possibly forwarded to external vendors without redaction** — `rag/rag.service.ts:82`
   (HF embeddings) and `lumi/agent/llm-judge.service.ts:47` (Nvidia NIM). ⚠️ **UNCONFIRMED** — head checked
   and found **no redaction in the `rag` module**, but de-identification may happen upstream (playground
   resolves `patientId`→de-id context server-side). **Backend must confirm whether the data crossing these
   calls is raw PII or already de-identified.** If raw: tokenize before the call (~20 LoC). (Ties to the
   known HF-token-rotation / HF-retirement work.)
3. **Payment-link failure → orphaned booking (revenue loss)** — `lumi/agent/tool-executor.service.ts`
   (`HIGH-payment-link-failure-deadend-orphaned-booking.yml`, already in your Lattice). Booking created with
   null payment, customer sees no error/retry. ⚠️ backend to confirm flow. Fix: transaction rollback OR a
   `payment-pending` state + auto-cleanup/alert (~30 LoC).

---

## 🟠 HIGH — next sprint (all ⚠️ unless noted; verify at file:line)
4. **Valkey per-user lock has no unlock guard** — `lumi/agent/lumi-agent.service.ts:230`. Agent crash → user
   locked out 1 hr. Fix: `del` lock in a `finally`, drop TTL to ~300s (~5 LoC). (`HIGH-lumi-per-user-lock-unfenced-unlock.yml`)
5. **RAG ingest is destructive / non-idempotent / single-node** — ✅ confirmed `scripts/ingest-documents.js:86-89`
   deletes the whole collection each run. KB offline during rebuild; concurrent ingests clobber. Fix: versioned
   collections (`kb_v1`→`kb_v2`) + atomic swap. **This is exactly what the RAG v2 auto-ingestion handoff
   replaces** (`docs/handoff-rag-kb-auto-ingestion.md`) — fold them together.
6. **No rate limit on destructive admin endpoints** — `admin.controller.ts:152` (cleanupTestUsers), `263`
   (resetUserData). Add `@Throttle` (~2 LoC each). ⚠️
7. **Unbounded list endpoints (no pagination defaults)** — `admin.controller.ts:475` (listAdmins), `623`
   (getMemories), `credit.service.ts:377`. Add `take` defaults (~3 LoC each). ⚠️
8. **Inconsistent error response shape** — ✅ confirmed ~15 `return { error: '...' }` in `admin.controller.ts`
   mixed with NestJS exceptions. Standardize on thrown exceptions so clients handle one shape.

---

## 🟡 MEDIUM — 2–4 weeks
9. **`EMBEDDING_MODEL` env default is WRONG** — ✅ confirmed `config/env.ts:90` defaults to
   `BAAI/bge-large-en-v1.5` while the real model is `text-embedding-3-small` (`rag/embedding.service.ts:14`).
   Code uses the right one; the env value just misleads operators. Fix the default + boot-log the real model (~2 LoC).
10. **Data-quality validation gaps** (surface wrong values verbatim to clinicians) — ⚠️ in
    `results/biomarker-validator.service.ts`: **glucose unit mismatch** (mmol/L value vs mg/dL range),
    **negative CRP** (biochemically impossible), **implausible bio-age** (PhenoAge western-calibration unvalidated
    for Indians — `MEDIUM-phenoage-western-calibration-unvalidated-for-indians.yml`). Add bounds + unit + sanity
    checks, flag outliers (~45 LoC total).
11. **Date params not validated** — `admin.controller.ts:556` + others; helpers exist but unused. Apply Zod (~20 LoC). ⚠️
12. **Zod errors leak schema** (all issues joined) — `admin.controller.ts:2848,2892`. Cap at first 3 + summary (~6 LoC). ⚠️
13. **Swallowed cache-op rejections** — `admin.controller.ts:711-735` silent `catch`. Log at WARN (~2 LoC). ⚠️
14. **Audit logs use offset pagination** — `admin.controller.ts:1720-1737`; can skip/dupe under concurrency.
    Cursor-based instead (~10 LoC). ⚠️

## 🟢 LOW
- `console.log` in `results/phenoage.spec.ts` test output; add a CORS boot-log for visibility.

---

## ✅ What's already solid (don't "fix")
Auth rate-limited (login 5/min, setup 3/hr) · webhook per-IP limit (240/min) · external calls have timeouts
(Thyrocare 10–15s, Graph 10s, OpenAI 30s) · unhandled-rejection/uncaught handlers log+alert · CORS fail-closed ·
admin token constant-time compare · Thyrocare webhook signature constant-time validated.

## 🚫 Gold-plating NOT recommended at 3-user scale
API versioning · full request-logging middleware · API gateway / circuit breaker · field-level encryption beyond
PII · audit-log retention policies · rate-limiting all non-destructive endpoints · app-level E2E encryption ·
load-balancing / multi-region.

---

## Suggested sequence
1. **Verify the 3 CRITICALs at file:line** (esp. #2 PII-to-vendors — confirm raw vs de-identified) → fix the real ones.
2. HIGH: fold the **ingest rework (#5) into the RAG v2 handoff**; the rest (#4,6,7,8) are small.
3. MEDIUM: batch the data-quality trio (#10) + the cheap hygiene fixes.
4. **Reconcile against your existing 61 Lattice findings** — several above already have IDs there; re-triage
   `rawxml` (MEDIUM→CRITICAL on compliance) and confirm the PII-flow items.
