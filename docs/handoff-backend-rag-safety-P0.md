# Handoff → jiive-backend — RAG clinical safety: P0

**Date:** 2026-07-29
**From:** jiive-admin (frontend / head)
**Method:** architecture reviewed against backend source (read-only, no changes made), plus a live
reproduction on the production WhatsApp bot.
**Severity:** P0. Ungrounded health advice is reaching patients while being labelled as guideline-backed.

---

## The one-sentence finding

Across ingestion, review, and answering, **an absent signal is rendered as a positive assurance** —
so the system reports "safe / clean / grounded" precisely when it knows least.

| Layer | Signal that is absent | What the system reports |
|---|---|---|
| Ingestion | `digitalNative` never measured (null) | UI prints "Digital native ✓" |
| Ingestion | `reviewMode`/`hasTables` never written | "standard" review, "no tables" |
| Review | marker dictionary not loaded | `numericConflicts: []` — reads as "checked, clean" |
| **Answer** | **`sourcesUsed: 0`** | **"grounded in Indian medical guidelines"** |

This is one design default, not four bugs. Fixing them individually will not stop the next one.

---

## P0-1 — Ungrounded answers are labelled as guideline-grounded (patient-facing, live)

`rag.service.ts:272 answer()` falls back to an ungrounded LLM in two places:

```js
if (!exists) {            // Qdrant collection missing
  return { reply: await this.plainLlm(...), sourcesUsed: 0, ragAvailable: false };
}
if (searchResult.length === 0) {   // nothing cleared SIMILARITY_THRESHOLD (0.35)
  this.logger.log('No relevant chunks found — falling back to plain LLM');
  return { reply: await this.plainLlm(...), sourcesUsed: 0, ragAvailable: true };
}
```

`tool-executor.service.ts:9036` then **ignores `sourcesUsed`** and returns, unconditionally:

```js
note: 'This answer is grounded in Indian medical guidelines. Present it naturally,
       do not add your own medical advice on top.'
```

So an answer generated purely from GPT-4o's parametric memory is handed to the conversational LLM
with an explicit assurance that it came from Indian medical guidelines — and an instruction to
present it confidently.

**Reproduced on production WhatsApp, 2026-07-29:**

> **User:** How much Iron do i need per day?
> **Lumi:** ✅ Include iron-rich foods like spinach, lentils, and chickpeas. ✅ Pair iron sources with
> vitamin C-rich foods like lemon or amla… ✅ Cook in iron utensils…

None of *spinach, lentils, chickpeas, lemon, amla, coffee, utensils, recipes* appears anywhere in the
knowledge base. Meanwhile the authoritative answer **was in the KB and went unused**: ICMR-NIN 2020
iron RDA = **19 mg/day (men)**, **29 mg/day (women)**.

It also never asked the one clinically necessary question — male or female — despite a 10 mg/day
difference, and never said "I don't know".

**Required outcome:** a health answer is either grounded in the KB, or the bot says it doesn't know and
offers a human. Never a silent fallback to parametric knowledge.

- When `sourcesUsed === 0`, do **not** return an answer to present. Return an explicit
  `grounded: false` and let the caller emit the refusal + human-handoff copy that already exists.
- **Never** attach the "grounded in Indian medical guidelines" note unless `sourcesUsed > 0`.
- Keep `plainLlm` for non-clinical smalltalk if you like — but it must not serve
  `ask_health_question` / `searchHealthKnowledge`.
- This also satisfies your own module rule 8 ("Do not call LLM directly for health suggestions —
  always go through RagService"), which the current fallback effectively bypasses.

---

## P0-2 — The strict review gate is unreachable from the default upload path

- Single upload parses with `pdf-parse` (`rag-document.service.ts:230`); only bulk uses Docling (`:748`).
- The forced-review classifier — `forced = hasTables || !digitalNative || hasLowConfTable` — exists
  **only in the Docling path** (`:783`).
- The single-upload persist block (`:249-257`) never writes `reviewMode`, `hasTables`, or
  `digitalNative`, so they fall to schema defaults `"standard"` / `false`
  (`prisma/schema.prisma:1378,1381`).

Net effect: a table-heavy clinical PDF uploaded via the obvious button **can never reach
`forced_side_by_side`**. The gate does not fail open on detection — it is never evaluated.

Your server-side gates (`:904` `tables_not_reviewed`, `:924` `conflicts_not_acknowledged`) are correct
and *are* enforced — they simply guard a condition this path prevents from ever becoming true.
(The June handoff claiming client-side-only enforcement is stale; that work landed.)

**Required:**
1. Route `POST /documents` through the same Docling + background queue as bulk.
2. Until then, set `reviewMode = 'forced_side_by_side'` unconditionally on the single-upload path —
   an unclassified document must fail *toward* human review.
3. **Always show the source PDF in review**, not only in forced mode (`app/rag/page.tsx:452` fetches it
   only when forced) — the weak path is exactly where a reviewer needs to compare against source.

---

## P0-3 — Stop fabricating safety signals

- `getReview():1070` coerces `digitalNative ?? true`. v1 rows never measured it, so the reviewer is
  shown an affirmative parse-quality claim the system never made. Return `null`; render "unknown —
  not analysed".
- `rag-numeric-conflict.service.ts:169-177`: with `RAG_MARKER_DICT_PATH` unset, `loadDict()` returns
  null and conflicts are always `[]` — indistinguishable on the wire from "checked, clean". Expose
  `conflictGate: "inert" | "active"` in the review payload and **block approval while inert**.
  (We could not verify from outside whether the dict is set in production — please confirm.)

---

## P1 — Provenance and chunking (these make the numbers usable)

- **Fabricated page numbers.** `chunkDocument():1293` computes
  `page = Math.floor(chunkIndex * CHUNK_SIZE_WORDS / 500) + 1`, i.e. the chunk ordinal. This is shown
  to users as a citation ("brief_note — page 4"). Carry Docling's real page number instead.
- **Citations don't contain the answer.** Live query "iron for an Indian woman" returned a snippet
  about *"B vitamins… balance studies, fecal loss…"* — a clinician checking the citation finds text
  that doesn't contain the number they were given.
- **Table-unaware chunking.** `:1282-98` is a pure 500-word window with 50-word overlap. In the live
  document the male nutrient table (Table 3) and the female table (Table 4) sit **516 characters
  apart** and land in the same chunk, repeating identical nutrient names with different values
  (male Iron `17|19|11|8`, female Iron `21|29|15|18`), flattened to bare positional numbers by
  `cleanText():1272` (`.replace(/\s{2,}/g,' ')` — 0 pipes, 6 newlines in 13,787 chars).
  Never split a table from its header; never merge two tables into one chunk.
- **Numbers should leave prose.** RDA/EAR values belong in a structured table the model queries
  exactly, with prose citing it — semantic similarity should never be the mechanism that picks
  between 19 mg and 29 mg.

---

## P2

- No rollback: `/rag/versions`, `/documents/:id/versions`, `/unpublish` all 404 in production. A
  corrected re-upload becomes a **new** document (dedup is on `fileHash`, `:186-196`) while the old
  wrong one stays `ready` and retrievable until manually deleted.
- A `ready` document can be re-approved but never re-inspected (`:897`, `:946` accept `status:'ready'`
  though the error text says only `pending_review`).
- **Golden-set regression** (~40 questions) asserting: exact numeric match, citation present and
  containing the cited number, and abstention when the KB lacks the answer. Gate every future
  ingestion on it.

---

## The rule we'd like adopted

> **Assert risk from the source; never infer safety from the success of extraction. An absent signal
> is never a positive assurance — unknown must read as "unknown", and must fail toward review or
> refusal.**

Applied here that means: unclassified document ⇒ forced review; unmeasured `digitalNative` ⇒ "unknown";
no dictionary ⇒ gate blocked; **`sourcesUsed: 0` ⇒ "I don't know", never "grounded in Indian medical
guidelines".**

---

## Current state, for scale

The entire production KB is **one document, 5 chunks** (`jiive_medical_knowledge`,
`text-embedding-3-small`, 1536-dim, Qdrant healthy). Blast radius is small and the fix is cheap today —
which is exactly why it is worth doing now, before the KB grows.

Also noted: both playground model backends are down in production (`hf_not_configured`,
`aws_offline` — "MedGemma box is offline"). The patient path is unaffected (OpenAI, configured), but
the internal review tool cannot currently answer at all.

## What we are not asking for

No frontend changes are blocked on this. We are not asking you to remove `plainLlm` — only to stop it
serving clinical questions and to stop labelling its output as guideline-grounded.
