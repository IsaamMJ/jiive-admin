# Handoff → jiive-backend — RAG/KB: make it Juveira-owned and self-serve

> **STATUS: 🔶 OPEN / ACTIVE (as of 2026-06-27).** Spec finalized, phasing agreed with backend.
> Backend to build the management endpoints; frontend management UI (`app/rag/`) starts once
> endpoint shapes are confirmed. This is the main remaining work item.

**Date:** 2026-06-25
**From:** jiive-admin (frontend / head)
**Env:** dev — `/api/v1/admin/rag`
**Goal:** Juveira owns the medical knowledge base end-to-end. She adds/updates/removes
content herself from the admin UI — no engineer, no manual script, no VPC access.
This is an **ownership handoff**, so the management capability is the point.

> Philosophy: these are **outcomes**, not implementation. You own the how — endpoint
> shapes, identity scheme, ingest mechanism. Where we state a default below, it's the
> desired *behaviour*; pick whatever mechanism delivers it.

## Outcomes (what the system must let her do)

1. **Add a document to the KB herself** from the admin UI — no CLI, no VPC, no engineer.
   Works even when the collection is currently **empty** (first-ever upload is in scope).
2. **Adding or updating one document must not destroy the rest of the KB.**
   (Today's `ingest-documents.js` wipes + rebuilds the whole collection every run — that's
   the core thing to move away from.)
3. **Each document is individually addressable.** List/update/delete all operate on a
   **single document by a stable identifier** that survives re-ingest. We don't care whether
   that identifier is the filename, an operator-given name, or a backend-issued id — only
   that the *list* endpoint returns it and the UI can hand it back to update/delete. Two docs
   must never be ambiguous to address (e.g. two files both named `guide.pdf`).
4. **Re-uploading a document that already exists REPLACES it** — it does not create a
   duplicate and does not silently append a second copy. (This is the intuitive behaviour for
   a non-technical owner. If you'd rather error-on-duplicate, tell us and we'll add an
   overwrite confirm — but default to replace.)
5. **Remove a document on its own**, by that same identifier, without touching the rest.
6. **See what's currently in the KB** — per-document: identifier, how much of it is indexed
   (chunks), and its status. `/rag/overview` is the read side today but has **no per-document
   status field** — so extending it (or a sibling endpoint) is **required**, not optional.
7. **Per-document status the UI can poll** — at minimum `processing → ready → failed`.
   Embedding takes time; after upload Juveira should see **processing**, then **ready** or
   **failed**. The UI must not freeze or imply a slow ingest is broken.
8. **Failures are explicit, with a reason.** A failed/partial ingest must surface a
   **human-readable reason** (e.g. "couldn't read PDF", "embedding timed out"), not a silent
   miss and not a doc that shows `ready` with fewer chunks than it should. A partial ingest
   counts as `failed`, not `ready`.
9. **Ingestion must preserve tables and document structure.** This is a hard outcome, not a
   nice-to-have. The content is **medical** — lab reference ranges, dosing, thresholds live in
   **tables**. The current `pdf-parse` path flattens tables, breaks multi-column layout, and
   returns **empty text on scanned/image-based PDFs** — silently producing confident wrong
   answers. The pipeline must: (a) preserve table/structure on ingest, and (b) **detect a PDF
   that yields little/no extractable text (e.g. a scan) and fail it loudly** rather than
   ingesting an empty doc. (Research strongly favours a layout-aware parser — e.g. PDF→Markdown
   via Docling/Marker — over naive text extraction. Tool choice is yours; the outcome isn't.)
10. **Keep the original uploaded file.** Store the raw PDF (and ideally the parsed text)
    alongside the vectors for traceability / audit / reproducible re-ingest. Proportionate
    implementation (object storage / a folder) — not a data lake.
11. **Answers cite their source** and **clearly flag when nothing was retrieved.**
    (Half-there already via `ragSources`.)

## Resolved decisions (head + research-backed — build to these)

1. **Upload format = PDF.** Juveira's content is delivered as PDFs; PDF is also the
   lowest-friction format for a non-technical owner (no export step). So the upload endpoint
   accepts **PDF**. The quality burden moves to the *parser* (outcome 9), not to her.
2. **Who may manage = all 3 admins.** All admins can view, add, and delete KB documents.
   Still **enforce on the server** (don't trust the UI) and keep a **confirm step on delete** —
   the shared token means a UI-only guard is theatre. No per-role split needed at this scale.
3. **Quality gate = lightweight, no workflow.** Research is clear an approval/review workflow
   is over-engineering for a 3-user KB. Build only:
   - reject at upload: non-PDF, corrupt, empty, or below a small min-length;
   - reject a re-upload that's byte-identical to an existing doc (dedup);
   - surface the **parsed result** so Juveira can eyeball it before/after it goes live.
   **No** toxicity classifier, **no** multi-stage approval (both explicitly refuted in research).
4. **Upload size ceiling.** A typical medical PDF (target: up to ~25 MB) must succeed; bigger
   fails with a clear message rather than hanging. Confirm the real ceiling so the UI matches.
5. **No version history.** Static small corpus — stable doc IDs + delete-by-source upsert is
   enough. Temporal versioning (valid_from/valid_to) is not warranted.

## What we need from you to put a UI on it

The management capabilities as admin API endpoints (name/structure them however fits):
- **Add/ingest a document** — accepts the format we confirm above; returns the doc's stable
  identifier + initial status.
- **List documents** — returns each doc's identifier, chunk count, and status (for the
  management view + status polling).
- **Remove a document** by identifier.
- **Status/coverage** — extend `/rag/overview` (or a sibling) with the per-document status.

Frontend handles **no embeddings/vectors** — we only call your management endpoints and
render status/coverage. (Same posture as the patient picker: we never touch the data plane.)

Tell us the firm endpoint shapes + accepted format, and the teammate wires the management
UI (`app/rag/` or `app/knowledge/`) on top; head verifies live.

## Build phasing — AGREED with backend (2026-06-26)

Backend reviewed and flagged where the cost lives. Agreed scope:

1. **Parser (outcome 9) is PHASED.**
   - **v1:** keep `pdf-parse` + the **"scanned/empty PDF → fail loudly"** guard (the dangerous
     silent-empty case). The **human spot-check is the v1 safety net for mangled tables** —
     Juveira must see the parsed text prominently and explicitly confirm "this looks right"
     before it publishes (not a tucked-away preview).
   - **Phase 2:** layout-aware parser (Python service or managed API — real infra, hence
     deferred). Pull forward if Juveira's docs turn out to be table-heavy.
   - Rationale: this is an *internal clinician-assist* tool, not patient-facing; the spot-check
     + loud-fail guard make pdf-parse acceptable for v1.
2. **Async status (outcome 7):** DB-backed status + cluster-safe background processing — **no
   new queue infra.**
3. **Raw-file storage (outcome 10):** **reuse EFS** (Qdrant already uses it) — no new S3 bucket.
4. **Existing content:** Juveira **re-uploads via the new flow** (no migration of the ~132
   diabetes chunks) — *provided she still has the source PDFs*. If the originals are lost, keep
   the existing chunks instead.

Straightforward / no-doubt items: fix the wrong `EMBEDDING_MODEL` env, byte-identical dedup,
~25 MB ceiling, min-length reject, no version history.

## Heads-up / open items
- KB re-ingest into the new Mumbai Qdrant is marked **pending** — collection may be empty.
  Confirm it's populated (or repopulate) so the dashboard/UI isn't showing zeros.
- `EMBEDDING_MODEL` env var shows `bge-large` but the **real** embedding is OpenAI
  `text-embedding-3-small` (1536-dim). The env value is not just display-only — it's
  **wrong**; please correct it so nothing downstream trusts it. We won't surface it in any UI.
