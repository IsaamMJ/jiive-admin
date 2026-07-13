# Handoff → jiive-backend — RAG ingestion

**Date:** 2026-07-13 (supersedes the 2026-07-01 handoff)
**From:** jiive-admin (frontend / head) — report only, no backend changes from us.
**Goal:** a non-technical owner (Juveira) can put real medical content into the KB and publish it,
without silently getting a worse result depending on which button she picked.

---

## ✅ Closed since the last handoff — thank you, don't rebuild

All three items from 2026-07-01 shipped and are **live on prod** (ECS rev 25, no migration):

| Item | Fix | Commit |
|---|---|---|
| **P0** — "Publish failed: Bad Request" on approve | Self-heal Qdrant payload indexes so publish stops 400ing | `cce5f34` |
| **P1** — PDF ligature / font-encoding garbling (`arƟcle` → `article`) | Deterministic normalization before chunk/embed | `e29ca30` |
| **P2** — text / paste ingestion | `POST /documents/text` (+ too-few-words rejected up front) | `db678e7`, `46a6acc` |

**Frontend caught up:** the admin KB UI now has a **paste-text** box wired to `POST /documents/text`,
mirroring your validation (≥200 chars, ≥50 words, ≤500k chars, title required) client-side and
surfacing your 400 messages verbatim.

---

## 🔴 P1b (revised) — Single upload must go through Docling, and be async

**This is now the only open ingestion item, and it's more serious than we originally filed it.**

We filed this on 2026-07-01 as a timeout bug. It is really a **silent quality trap**:

| Endpoint | Parser | Table fidelity |
|---|---|---|
| `POST /documents` (single upload) | `pdf-parse` (in-process JS text extractor) — `rag-document.service.ts:234` | ✗ poor — this is the parser Docling was adopted to replace |
| `POST /documents/bulk` | **Docling** (`runParseQueue`, `rag-document.service.ts:708`) | ✓ layout-aware, faithful tables |

So the most obvious action for a non-technical owner — drag **one** PDF into Single upload — quietly
gives her the **worse** parser: the one that mangles the reference-range tables Docling exists to get
right. "Bulk" reads like the advanced/power option, but it's the only one that parses properly. The
quality difference is invisible in the UI and in the API response.

The timeout bug is the same bug's other face: `POST /documents` is synchronous through parse
(`await pdfParse(file.buffer)` inline, `rag-document.service.ts:234`), so a large PDF (RSSDI, 236pp)
dies at the gateway (~30–60s) with no useful reason.

**Outcome:** route `POST /documents` through the **same Docling + background-queue path bulk already
uses** — return immediately with `{ documentId, status: 'processing' }` and parse in the background;
the client already polls to `pending_review`/`failed`. One change removes both the quality trap and
the gateway timeout, and the async machinery already exists — bulk proves it.

**Definition of done:**
- The same PDF uploaded via single vs bulk produces the **same** parsed text and the same tables.
- RSSDI (236pp / 2.3MB) via single upload returns immediately and reaches `pending_review`.

**Frontend follow-on (ours, once this lands):** we delete the "use Bulk upload for big files" nudge and
the 3-min client timeout — both are workarounds for this bug, and we'd rather shrink the UI than keep them.

---

## 🟡 Small — expose `parser` on the API

The DB has a `parser` column (`schema.prisma:681`; values `'text' | 'pdf-parse' | 'docling'`), but it's
**not in the `select`** for either `list()` or `getDetail()` (`rag-document.service.ts:420`, `:440`), so
it never reaches the wire.

**Outcome:** include `parser` in both responses. It's a one-line addition and it lets the admin UI show
how a document was ingested — which is exactly the signal a reviewer needs while the parser split above
still exists. Low priority once P1b lands, but useful regardless for traceability.

---

## Still unvalidated (not a code item)

- **Docling table fidelity on real samples** — nobody has run the team's actual table-heavy medical PDFs
  (DGI_2024, RSSDI) through Docling and eyeballed whether reference-range tables come out faithful.
  This is the whole point of the layout parser and it's still assumed, not verified. jiive-admin is
  running this now against dev.
- **First real publish on prod** — prod Qdrant is intentionally empty (decision: Juveira populates it
  fresh via the tool, no seeding of the old diabetes-only chunks). So the publish path, though fixed,
  has not yet been exercised by a human on prod with real content.
