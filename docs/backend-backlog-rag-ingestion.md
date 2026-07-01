# Backend backlog — RAG ingestion quality (batch, then hand off)

Running list of RAG-ingestion improvements to hand to the backend team **as a batch**
(avoid back-and-forth). Report only — no backend changes from us. Add items as we hit them.

---

## 1. PDF ligature / font-encoding normalization (PRIORITY: HIGH — recurring, hurts KB quality)

**Problem:** many medical/journal PDFs are typeset with fonts whose ligatures don't map back to
proper Unicode (broken/missing ToUnicode CMap). Text extraction (Docling or any parser) then
produces garbled glyphs in place of common letter-combos — so the KB would store "arƟcle" instead
of "article." This corrupts retrieval (embeddings of the garbled token ≠ the real word) and makes
the LLM cite garbled text to clinicians.

**Real evidence — `Med_sample.pdf` (7-page Indian dyslipidaemia editorial), 244 bad chars (1.4%):**

| Codepoint | Extracted glyph | Should be | Count | Example |
|---|---|---|---|---|
| U+019F | Ɵ (O w/ middle tilde) | `ti` | 172 | ar**Ɵ**cle → article; Introduc**Ɵ**on |
| U+01A9 | Ʃ (esh) | `tt` | 14 | pa**Ʃ**erns → patterns; a**Ʃ**ributable |
| U+FB01 | fi ligature | `fi` | 23 | |
| U+FB00 | ff ligature | `ff` | 13 | |
| U+FB03 | ffi ligature | `ffi` | 4 | |
| U+FB02 | fl ligature | `fl` | 1 | |
| U+A78F | ꞏ (sinological dot) | `·` / bullet | 3 | Table-1 bullet markers |

**Outcome wanted:** a normalization pass **after parse, before chunk/embed**, that maps these known
mis-mapped glyphs back to their intended letters. The common table above covers the bulk; a
maintainable Unicode-normalization/ligature map handles the rest. (Standard Unicode ligatures
FB00–FB06 are unambiguous; the font-specific ones — U+019F→`ti`, U+01A9→`tt` — are the ones that
matter most here.)
- The **human review gate already catches these** (Juveira sees garbled text and rejects) — but that
  makes every affected doc un-ingestable. Normalizing lets good clinical PDFs through.
- Do NOT rewrite content — this is deterministic glyph→letter substitution, not LLM cleanup.

---

## 2. Text / paste ingestion (PRIORITY: MEDIUM — the cleanest input path)

**Problem:** ingestion is **PDF-only** today (magic-byte check rejects everything else). For a
non-technical owner, the highest-quality, zero-parsing-risk input is to **paste/type clean text**
directly — no font encoding, no tables to mangle, no ligature issues (item 1 disappears entirely
for pasted content).

**Outcome wanted:** accept a **pasted-text / markdown** document as an ingestion source (in addition
to PDF) — e.g. a `POST /documents` variant that takes a `text` body + `title`. Same downstream:
chunk → embed → review → approve. Frontend adds a "paste content" box. Keep source verbatim.
- Rationale from our design research: verbatim text is the safest medical-RAG input; pasting
  focused reference notes avoids the whole PDF-parsing failure surface.

---

*(append new ingestion-quality items below as they surface)*
