# Handoff → jiive-backend — RAG ingestion: make it prod-grade (one pass)

**Date:** 2026-07-01
**From:** jiive-admin (frontend / head) — report only, no backend changes from us.
**Goal:** one consolidated pass so a non-technical owner (Juveira) can upload real medical PDFs and
publish them into the KB reliably. Batched deliberately to avoid back-and-forth. Priority order below.

**Frontend status:** the `app/rag` UI (upload / review / forced side-by-side / gates / bulk / versioning)
is built, adversarially reviewed, and prod-grade. It surfaces backend errors faithfully. The items
below are all **backend-side**.

---

## 🔴 P0 — BLOCKER: "Publish failed: Bad Request" on approve

**Nothing can be published until this is fixed.** Approving a valid, cleanly-parsed doc (6-page
dyslipidaemia editorial, gates passed) fails on **dev** with `Publish failed: Bad Request`.

- **Where:** publish step only (parse + gates succeed). `rag-document.service.approveV2` →
  `rag.upsertDocumentVersion` → `embedBatch()` (OpenAI embeddings) → `qdrant.upsert()`. One threw
  "Bad Request"; caught + re-thrown as `ConflictException("Publish failed: <reason>")`; doc rolled
  back to `pending_review` (no corruption).
- **You have the exact cause in logs:** `RAG approve(v2): document <id> publish error — <reason>`.
  `<reason>` tells you OpenAI vs Qdrant + the message.
- **Prime suspects (dev-specific — is prod's publish actually exercised end-to-end yet?):**
  - **Qdrant collection dimension/config mismatch** — ties to the wrong `EMBEDDING_MODEL` env
    (`env.ts:90` still `BAAI/bge-large-en-v1.5`; real model is `text-embedding-3-small` @ 1536-dim,
    `embedding.service.ts:14`). If the dev collection was created for a different dim → upsert 400.
  - **Empty/whitespace chunk** reaching the embeddings API → OpenAI 400 "input must not be empty".
- **Definition of done:** a valid PDF approves → `ready`, chunks land in Qdrant, and it's retrievable
  in the playground. Confirm this works on **both dev and prod** (nobody has published end-to-end on
  prod yet — please verify, don't assume).

---

## 🟠 P1 — PDF ligature / font-encoding normalization (quality)

Many medical/journal PDFs have broken font→Unicode maps, so extraction yields garbled glyphs for
common letter-combos → the KB would store "arƟcle" for "article", corrupting retrieval and citations.
The human review gate catches these (owner rejects), but that makes every affected PDF un-ingestable.

**Real evidence — `Med_sample.pdf` (7-page editorial), 244 bad chars (1.4%):**

| Codepoint | Glyph | Should be | Count |
|---|---|---|---|
| U+019F | Ɵ | `ti` | 172 |
| U+01A9 | Ʃ | `tt` | 14 |
| U+FB01 | fi-lig | `fi` | 23 |
| U+FB00 | ff-lig | `ff` | 13 |
| U+FB03 | ffi-lig | `ffi` | 4 |
| U+FB02 | fl-lig | `fl` | 1 |
| U+A78F | ꞏ | `·` | 3 |

**Outcome:** a deterministic **glyph→letter normalization pass after parse, before chunk/embed**
(Unicode ligatures FB00–FB06 are unambiguous; add the font-specific ones above). Not LLM cleanup —
pure substitution, keeps content verbatim.
**Definition of done:** re-ingesting `Med_sample.pdf` produces clean words (no Ɵ/Ʃ/ligatures) in
`parsedText` and chunks.

---

## 🟡 P2 — Text / paste ingestion (the cleanest input path)

Ingestion is **PDF-only** today. For a non-technical owner, pasting clean text is the
highest-quality, zero-parse-risk input — and it makes P1 irrelevant for typed content.

**Outcome:** accept a **pasted text / markdown** source (e.g. `POST /documents` variant taking
`{ text, title }`) → same downstream (chunk → embed → review → approve). Frontend adds a "paste
content" box once the endpoint exists. Keep source verbatim.

---

## 🟠 P1b — Single upload should be ASYNC (large PDFs time out at the gateway)

**Symptom:** uploading a large PDF (e.g. RSSDI, 236 pages / 2.3 MB) via **single upload** spins
forever, then fails. `POST /documents` is **synchronous through parse** — it doesn't respond until
Docling finishes the whole document (minutes for a big file), so the request **times out at the
gateway (~30–60s)** → the operator sees "Upload failed" with no useful reason.

- **Bulk upload already works** (it returns a `batchId` immediately and parses in the background) —
  so the async pattern already exists; single upload just doesn't use it.
- **Outcome:** make `POST /documents` return **immediately** with `{ documentId, status: 'processing' }`
  and parse in the background (same as bulk), so the row appears right away and the client polls it to
  `pending_review`/`failed`. This eliminates the gateway-timeout entirely for any file size.
- Frontend has been hardened (3-min client timeout + "large PDFs take a while" messaging + a nudge to
  use Bulk upload for big files), but the durable fix is async single-upload.

## ✅ Already done (confirm, don't rebuild)
- **Gate enforcement** (`tables_not_reviewed` / `conflicts_not_acknowledged`, 409) — implemented
  server-side; frontend sends `tablesReviewed` + `conflictsAcknowledged`. Just confirm it still holds
  after the P0 fix.
- **Docling parser + clinical-safety review** — live. One thing to **validate on real samples**:
  run the team's actual table-heavy medical PDFs (e.g. DGI_2024, RSSDI) through Docling and eyeball
  that reference-range **tables** come out faithful — this is the whole point of the layout parser.

---

## Suggested order
1. **P0 publish blocker** (check the dev log line — likely the Qdrant dim / EMBEDDING_MODEL env) —
   confirm publish works on dev AND prod.
2. **P1 ligature normalization** — cheap, high-value, recurs on every journal PDF.
3. **Validate Docling table fidelity** on real samples.
4. **P2 paste-text** — when you want the cleanest owner input path.
