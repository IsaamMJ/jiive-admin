# Handoff → jiive-backend — server-enforce the RAG approval gates (+ minor data note)

**Date:** 2026-06-30
**From:** jiive-admin (frontend / head) — report only, no backend changes made.
**Context:** RAG-KB v2 review UI is live. The clinical-safety gates are currently enforced
**client-side only**. A direct API caller (or a future UI refactor) can bypass them. For a KB
the LLM cites to clinicians, these gates should also hold server-side (defense-in-depth).

## 1. Enforce the review gates on `POST /documents/:id/approve` (PRIORITY: clinical safety)

Outcome: a document must not be approved into the live KB unless a human has consciously
reviewed (a) table-extraction risk on table/low-confidence docs, and (b) any numeric conflicts.

- **Table gate (field already exists):** if the document's `reviewMode === 'forced_side_by_side'`
  (i.e. it's table-flagged / low-confidence), **reject the approval unless `tablesReviewed === true`**
  in the body. Today the endpoint accepts the approval regardless.
- **Conflict gate (needs a field):** the backend already computes `numericConflicts` for the review.
  So when a document has ≥1 numeric conflict, **require an explicit acknowledgment** before approval
  — e.g. accept a new `conflictsAcknowledged: boolean` in the approve body and **reject if conflicts
  exist and it's not `true`**. (Tell us the field name you want; the frontend will send it. Right now
  the conflict acknowledgment is UI-only — there's no field on the request for you to check.)

Rejections should return a clean error code/message (e.g. `tables_not_reviewed` /
`conflicts_not_acknowledged`) so the UI can surface it.

## 2. Minor data note — blank "Converted" column (PRIORITY: LOW, cosmetic)

`biomarkerValues.convertedValue` / `convertedUnit` are nullable in the schema and **never populated**
(not set in `results-pipeline.service.ts` or the admin result creation). The admin result-detail page
has a "Converted" column that is therefore always blank. Either populate them during biomarker creation
if conversion is intended, or confirm it's deliberate and we'll drop the column.

## Not an issue (closing the loop)
- The earlier "biomarker shows None = wrong field (value vs rawValue)" theory: the admin result page
  already reads `rawValue` correctly. The "None" badge is Thyrocare's `<INDICATOR>None</INDICATOR>`
  rendered verbatim — correct data. The actual frontend bug (a null indicator crashing the table) is
  fixed on our side.
