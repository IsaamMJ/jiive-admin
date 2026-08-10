/**
 * The chunk-preview contract: the wire guard, the state machine, and every
 * string of copy for the "what will not be stored" warning.
 *
 * Read the ChunkPreview block in types.ts first — it holds the WHY. This file
 * holds the one rule that makes the WHY enforceable:
 *
 *   THE SLOT IS NEVER EMPTY, AND ONLY ONE STATE IS ALLOWED TO REASSURE.
 *
 * `dropped: []` and `chunkPreview: undefined` are both falsy. If the render
 * site is ever allowed to write `preview?.dropped?.length` then those two
 * collapse into the same branch, and "this server never measured it" renders
 * identically to "the chunker measured it and found nothing". That is the
 * governing rule of this repo failing in one character of optional chaining.
 *
 * So the render sites receive a NAMED discriminated union and are given no
 * boolean to shortcut through. There is no `hasDropped` here on purpose.
 *
 * `openReview` does `setReviewDoc(r.data)` with no coercion (page.tsx), so this
 * file is also the wire guard for the field — a malformed `dropped` must
 * degrade to "not measured", never to an empty list.
 */

import type { ChunkPreview, DroppedFragment, ReviewResponse } from "./types";

// ── Wire guard ───────────────────────────────────────────────────────────────

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Coerce one `dropped[]` entry.
 *
 * A fragment with no readable `text` is discarded, because the text IS the
 * warning — a row rendering as blank would understate the loss while looking
 * like it had been shown. `words` is kept as `null` when unusable rather than
 * defaulted to 0: a fabricated 0 would silently drag the "N words" total down,
 * which is a false claim about the size of the loss. The caller suppresses the
 * total entirely if any fragment lacks it.
 */
function coerceFragment(raw: unknown): DroppedFragment | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.text !== "string" || r.text.trim() === "") return null;
  return {
    text: r.text,
    // Kept as null, and it STAYS null all the way to the render site. See the
    // warning on DroppedFragment.words — the previous `?? 0` here undid the
    // whole point of this branch.
    words: isFiniteNumber(r.words) ? r.words : null,
    // The server slices at exactly 200 chars with no marker, so length is the
    // only available signal that the text on screen is not the whole passage.
    truncated: r.text.length >= SERVER_TEXT_CAP,
  };
}

/** `rag-document.service.ts:1419` — `text: d.text.slice(0, 200)`. */
const SERVER_TEXT_CAP = 200;

// ── The tables the operator is never shown ───────────────────────────────────

/**
 * ⚠️ THE ANSWER TO "DOES `dropped` CONTAIN TABLES": NO. NEVER. NOT ONCE.
 *
 * This was an open question in an earlier revision of this file, hedged with an
 * `unconfirmed_clear` state. It is not open — it is answered in the backend
 * source, and the answer inverts what the UI used to say.
 *
 * `chunkMarkdown` (`jiive-backend/src/modules/rag/markdown-chunk.ts:272`) calls
 * `stripTablesAndCode(md)` as its FIRST statement. Table blocks are deleted from
 * the string before sectioning happens, counted into `tablesRemoved`, and
 * returned as `tablesSkipped` (`:325`). The ONLY thing that can ever reach
 * `dropped` is `:297-311` — a prose fragment under `MIN_CHUNK_WORDS` (25) that
 * could not be merged into the previous chunk of the same section. The
 * backend's own publish log calls them "likely stripped-table CAPTIONS"
 * (`rag-document.service.ts:1718`). Captions. Not tables.
 *
 * And `previewChunks` (`:1423-1431`) returns `{chunkCount, dropped, sample,
 * error}` — it computes `tablesSkipped` and THROWS IT AWAY.
 *
 * What that cost, live on PROD on 2026-08-10:
 *
 *   press_note_Nutritional Intake in India — tables: [], dropped: [],
 *   yet 72 pipe-table rows in `parsedText`, including
 *     "| Table 2: Average calorie intake per capita … by fractile classes … |"
 *     "| Calorie (Kcal) | | Protein (gm) | | Fat (gm) |"
 *   The screen said: "Chunker reported nothing dropped — 9 chunks".
 *
 *   IJMR-148-522 (1) — dropped: 1, and the one passage shown to the operator
 *   was a QR-code caption, while the 51 stripped rows included
 *     "| Infants (months) | 0-6 | | 7-12 | | Children (yr) | 1-3 | …"
 *   an age-banded nutrient reference table, in a blood-testing company's KB.
 *
 *   DietaryGuidelinesforNINwebsite — 1,079 stripped rows, tables: [].
 *
 * So the client reproduces the count itself. It CAN do this exactly, not
 * heuristically: the backend hands us the identical input string the stripper
 * ran on (`parsedText`, `:1339` and `:1371`), so running the backend's own
 * matchers over it yields the backend's own number. The regexes below are
 * copied verbatim from `markdown-chunk.ts:48-50` and the `<table` counter from
 * `:82-88`; if they drift, this undercounts, which is why the copy it drives
 * says "at least".
 *
 * `doc.tables` is NOT this number and must never be used as it. That field is
 * the LlamaParse extracted-tables artefact (`row.tablesPath`,
 * `rag-document.service.ts:1343-1360`) — a different object with a different
 * provenance. It was `[]` on 11 of 11 documents across both environments while
 * three of those documents carried 51 / 72 / 1,079 stripped rows. Keying the
 * warning on it meant the warning had never once fired.
 */
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
const FENCE = /^\s*(```|~~~)/;

export function countStrippedTableBlocks(md: string): number {
  if (!md) return 0;
  let removed = 0;
  let inFence = false;
  let inTable = false;
  let htmlDepth = 0;

  for (const line of md.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    // LlamaParse emits real <table> markup, not pipe tables — a pipe-only
    // matcher sees none of it. The backend counts both; so do we.
    const opens = (line.match(/<table[\s>]/gi) ?? []).length;
    const closes = (line.match(/<\/table>/gi) ?? []).length;
    if (htmlDepth === 0 && opens > 0) removed++;
    if (opens > 0 || closes > 0) {
      htmlDepth = Math.max(0, htmlDepth + opens - closes);
      continue;
    }
    if (htmlDepth > 0) continue;

    const isRow = TABLE_ROW.test(line) || TABLE_DIVIDER.test(line.trim());
    if (isRow && line.trim() !== "") {
      if (!inTable) {
        inTable = true;
        removed++;
      }
      continue;
    }
    // Verbatim from markdown-chunk.ts:100-105 — the reset is UNCONDITIONAL on
    // any non-row line, not just a blank one. Resetting only on blanks leaves
    // `inTable` stuck true through the prose after a table, so a second table
    // further down is counted as a continuation of the first. That undercounts,
    // which is the one direction this must not drift in.
    if (inTable && line.trim() === "") {
      inTable = false;
      continue;
    }
    inTable = false;
  }
  return removed;
}

/**
 * Coerce `ReviewResponse.chunkPreview`.
 *
 * Returns `undefined` for "absent", and a `malformed: true` marker for "present
 * but the shape moved". Both mean nobody measured this document — but they are
 * kept distinct up to the point of rendering, so that a contract change can
 * never be mistaken for an old deployment when someone comes to debug it.
 */
export function coerceChunkPreview(
  raw: unknown
): { preview: ChunkPreview; droppedWords: number | null } | { malformed: true } | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") return { malformed: true };
  const r = raw as Record<string, unknown>;

  // `dropped` not being an array is the one shape failure that matters: it is
  // the field the whole warning is built on. Anything else missing degrades a
  // detail; this degrades the verdict, so it is treated as "not measured".
  if (!Array.isArray(r.dropped)) return { malformed: true };

  const fragments = r.dropped.map(coerceFragment).filter((f): f is DroppedFragment => f !== null);

  // Only report a word total when EVERY fragment carried one. A partial sum
  // presented as "483 words" is a number the backend never said.
  const droppedWords = fragments.every((f) => f.words !== null)
    ? fragments.reduce((n, f) => n + (f.words ?? 0), 0)
    : null;

  const preview: ChunkPreview = {
    chunkCount: isFiniteNumber(r.chunkCount) ? r.chunkCount : -1,
    // Passed through UNCHANGED — no `?? 0`. See DroppedFragment.words.
    dropped: fragments,
    sample: Array.isArray(r.sample)
      ? r.sample
          .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
          .map((s) => ({
            source: typeof s.source === "string" ? s.source : "",
            text: typeof s.text === "string" ? s.text : "",
          }))
      : [],
    error: typeof r.error === "string" && r.error.trim() !== "" ? r.error : null,
  };
  return { preview, droppedWords };
}

// ── The state machine ────────────────────────────────────────────────────────

/**
 * What we know about what approving this document will throw away.
 *
 * Five states, not three, because "we found nothing" splits into two facts
 * with very different weight — see `unconfirmed_clear`.
 */
export type DropVerdict =
  /**
   * No preview came back at all (older deployment), or the shape moved.
   * NOT a pass. Renders in the merged "did not run" panel.
   */
  | { kind: "unmeasured"; why: "absent" | "malformed"; strippedTables: number }
  /**
   * The preview ran and errored. The capability EXISTS and broke — an outage
   * the operator can retry, not a deployment that never had the feature. Kept
   * distinct for the same reason `fetchDiscovered` keeps 404 apart from error.
   */
  | { kind: "preview_failed"; message: string; strippedTables: number }
  /**
   * Nothing listed as dropped, BUT this document HAS table blocks that the
   * chunker strips before it starts, and which provably never appear in
   * `dropped` (see the block comment on `countStrippedTableBlocks`). So the
   * empty list is true and irrelevant: the tables are gone either way.
   *
   * This state used to key on `doc.tables.length` and had therefore never
   * fired on any real document. It now keys on `strippedTables`, computed from
   * `parsedText` with the backend's own matchers.
   */
  | { kind: "unconfirmed_clear"; chunkCount: number; strippedTables: number; tableCount: number }
  /**
   * Nothing listed as dropped and no stripped table blocks found.
   *
   * The weakest possible positive, and still not a clean bill of health — see
   * `CLEAR_INFOTIP`. We cannot see which chunker ran (`parser` is not on the
   * review payload), and the legacy word-window path returns a hardcoded
   * `dropped: []` regardless of what it discarded.
   */
  | { kind: "clear"; chunkCount: number }
  /**
   * Positive evidence that content will be (or was) lost.
   * `tense` is "will" for a document still awaiting approval — chunking has not
   * happened yet, so this is preventable. "did" for an already-approved
   * document, where the dialog is a read-only viewer and this is a post-mortem.
   */
  | {
      kind: "loss";
      fragments: DroppedFragment[];
      /** Sum of the backend's own `words`, or null when any fragment lacked one. */
      droppedWords: number | null;
      /** How many fragments contain at least one digit. A property of the string. */
      numericCount: number;
      chunkCount: number;
      /** Table blocks stripped before chunking. Never appear in `fragments`. */
      strippedTables: number;
      tense: LossTense;
      /** The stored count this verdict was reconciled against. Null = unknown. */
      storedChunkCount: number | null;
    };

/**
 * WHICH TENSE THE LOSS MAY BE SPOKEN ABOUT IN.
 *
 * ⚠️ This used to be `status === "pending_review" ? "will" : "did"`, and that
 * "did" was a false statement of fact rendered on live production data.
 *
 * `chunkPreview` is a dry run of the CURRENT chunker over `parsedText`, executed
 * when the review is fetched (`rag-document.service.ts:1363`). It is not a
 * reading of what is stored. On an already-approved document the two only
 * coincide if the same chunker cut the stored chunks.
 *
 * On PROD, `IJMR-148-522 (1)` stores 12 chunks and previews 15. The screen said
 * "1 passage were not stored when this document was approved" and named a QR-code
 * caption — which `POST /rag/search` returns from the live KB, verbatim, at
 * score 0.479, sourced to that same document. The passage the operator was told
 * is missing is present. Worse, the retrieval probe then rendered "the closest
 * thing in the knowledge base is 0.48 similarity" over the passage's OWN stored
 * copy, presenting a self-match as evidence of substitution.
 *
 * So "did" now requires proof, and the proof is arithmetic the client can do:
 * the previewed chunk count must equal the stored chunk count. Anything else —
 * including a stored count we simply do not have — is "conditional", which
 * claims nothing about the knowledge base's actual contents.
 */
export type LossTense =
  /** Still pending. Chunking has not run. Preventable — this is the only blocker. */
  | "will"
  /** Approved, and preview chunkCount === stored chunkCount. Safe to speak in past tense. */
  | "did"
  /** Approved, but the preview does not describe the stored chunking (or we can't tell). */
  | "conditional";

/**
 * THE HOLE THAT USED TO BE HERE IS CLOSED — and it was worse than suspected.
 *
 * The previous revision left an open question for the backend ("does `dropped`
 * include table blocks, or only below-floor fragments?") and hedged with
 * `unconfirmed_clear`. The backend source answers it: only below-floor
 * fragments, never tables (see `countStrippedTableBlocks`). The hedge keyed on
 * `doc.tables`, which is a different field entirely and was `[]` on 11 of 11
 * live documents — so the hedge had never fired, including on the three prod
 * documents that most needed it.
 *
 * `clear` is therefore no longer reachable on a document with stripped tables.
 *
 * ⚠️ THE HOLE THAT REMAINS, and it is a real one: we cannot see WHICH chunker
 * ran. `previewChunks` (`rag-document.service.ts:1417`) only computes `dropped`
 * when `parser ∈ {markdown, llamaparse}`; for anything else it returns a
 * hardcoded `dropped: []` with `error: null`, indistinguishable on the wire
 * from a measurement that found nothing. The legacy `chunkDocument` path does
 * discard content — it silently `continue`s any slice under MIN_CHUNK_WORDS —
 * so "no drop concept" is not "no drops". This is reachable today: the
 * paste-text upload path sets `parser: 'text'` (`:522`) for any non-markdown
 * paste, and both environments carry a `brief_note` matching that shape.
 * `parser` is not on the review payload and there is no `droppedMeasured` flag,
 * so `CLEAR_INFOTIP` states the limit in words instead of pretending to one.
 *
 * @param storedChunkCount The chunk count from the documents LIST row — what is
 *   actually in the KB. Null when unknown, which is treated as "cannot confirm".
 */
export function describeDrop(
  doc: ReviewResponse | null,
  storedChunkCount: number | null = null
): DropVerdict {
  if (!doc) return { kind: "unmeasured", why: "absent", strippedTables: 0 };

  // ⚠️ Computed FIRST, and carried on every variant including the ones that
  // mean "nothing was measured".
  //
  // This number is derived from `parsedText` alone. It does not depend on
  // `chunkPreview` existing, being well-formed, or having succeeded — so a
  // server that sends no preview at all must still show the table warning.
  // Deriving it after the early returns would have made the single most
  // important fact on the screen disappear precisely when the backend is
  // weakest, which is the failure mode this module exists to prevent.
  const strippedTables = countStrippedTableBlocks(doc.parsedText ?? "");
  // The LlamaParse extracted-tables artefact. Kept ONLY for the "check these
  // against the source" cross-reference it was always for. It is NOT a count of
  // what the chunker stripped and must never be used as one.
  const tableCount = (doc.tables ?? []).length;

  const coerced = coerceChunkPreview(doc.chunkPreview);
  if (coerced === undefined) return { kind: "unmeasured", why: "absent", strippedTables };
  if ("malformed" in coerced) return { kind: "unmeasured", why: "malformed", strippedTables };

  const { preview, droppedWords } = coerced;

  // Checked BEFORE the empty-list check. A preview that errored produced no
  // list, so its empty `dropped` is not a finding — reading it as one is the
  // whole bug class.
  if (preview.error !== null) {
    return { kind: "preview_failed", message: preview.error, strippedTables };
  }

  if (preview.dropped.length === 0) {
    return strippedTables > 0
      ? { kind: "unconfirmed_clear", chunkCount: preview.chunkCount, strippedTables, tableCount }
      : { kind: "clear", chunkCount: preview.chunkCount };
  }

  return {
    kind: "loss",
    fragments: preview.dropped,
    droppedWords,
    numericCount: preview.dropped.filter((f) => /\d/.test(f.text)).length,
    chunkCount: preview.chunkCount,
    strippedTables,
    tense: resolveTense(doc.status, preview.chunkCount, storedChunkCount),
    storedChunkCount,
  };
}

/** See the LossTense doc comment for why "did" has to be earned. */
function resolveTense(
  status: string,
  previewChunkCount: number,
  storedChunkCount: number | null
): LossTense {
  // Chunking runs at approve. If the document is still pending, this loss has
  // not happened yet and can still be prevented — the only case allowed to block.
  if (status === "pending_review") return "will";
  // `-1` is the coercer's "not a usable number" marker; it must never be
  // compared against a real count.
  if (storedChunkCount === null || previewChunkCount < 0) return "conditional";
  return storedChunkCount === previewChunkCount ? "did" : "conditional";
}

/**
 * Does this verdict hold the approve button?
 *
 * ONLY known, still-preventable loss. Never `unmeasured`, never
 * `preview_failed`, never either flavour of clear.
 *
 * A capability gap informs; it does not block. That is already this module's
 * settled position for `conflictGate: "inert"`, and it is the honest line:
 * red means we have positive evidence content is being lost, amber means we do
 * not know. Blocking on "we do not know" would make the gate the thing standing
 * between the operator and their job on every document a weaker backend serves,
 * and a gate that fires unconditionally is routed around within a week.
 */
export function blocksApproval(v: DropVerdict): boolean {
  return v.kind === "loss" && v.tense === "will";
}

/** Digits in a passage. A countable property of the string — NOT a classification. */
export function numeralCount(text: string): number {
  return (text.match(/\d/g) ?? []).length;
}

// ── Copy ─────────────────────────────────────────────────────────────────────
//
// Exported so the inline block, the merged panel and the footer line cannot
// drift apart (the DISCOVERED_PARTITION_NOTE pattern). Both review modes render
// the same components, so there is one source for each sentence.

/**
 * The mechanism, stated ONCE at block level and never per fragment.
 *
 * ⚠️ THIS SENTENCE USED TO BE THE MOST DANGEROUS STRING ON THE SCREEN. It read:
 *
 *   "Two things get dropped when a document is chunked: table blocks held out of
 *    the prose, and passages too short to retrieve. The preview doesn't say
 *    which applied to any of these — so read them."
 *
 * Only the second clause can ever describe an entry in this list. The first is a
 * claim about the payload that the payload cannot support, and its effect was
 * the exact inverse of the intent: an operator who read the list, saw no table
 * in it, and read that sentence had been given a basis to conclude no table was
 * lost. It converted a partial list into a complete inventory in their head.
 * That is this repo's governing rule failing in the safety copy itself — an
 * absent signal (no table in the list) rendered as a positive assurance.
 *
 * It now states the boundary instead of hiding it.
 */
export const DROPPED_MECHANISM =
  "This list is only the short prose fragments the chunker discarded. Table blocks are removed before chunking and never appear here — nothing in this list tells you whether a table was lost.";

export const DROPPED_INFOTIP =
  "Chunking runs when you approve, not when the document was uploaded. These passages stay in the PDF and in the text above; what they lose is retrievability. Passages under 25 words are dropped when they can't be merged into the section above them — which is most often a caption left behind after its table was stripped.";

/**
 * Shown whenever `strippedTables > 0`, in BOTH the loss block and the
 * otherwise-empty case. This is the warning the feature was actually built for
 * and, until now, the one it never gave.
 */
export const STRIPPED_TABLES_WARNING =
  "Table blocks are deleted from this document before it is chunked, so nothing in them reaches the knowledge base and none of them appear in the dropped list. If a table holds reference ranges or doses, the assistant will never see those numbers.";

export const STRIPPED_TABLES_INFOTIP =
  "Counted on this page by running the backend's own table matchers over the parsed text above, because the server computes this number and then discards it before sending. Treat it as at least this many: a table the matchers don't recognise is still stripped, it just isn't counted here.";

/**
 * The count IS complete — for what it counts.
 *
 * An earlier version hedged this as "treat it as at least this many", reasoning
 * from `sample` being capped at 3. That reasoning was wrong: `sample` is sliced
 * (`rag-document.service.ts:1425`), `dropped` is not (`:1417`) — the whole array
 * is mapped and sent. Hedging an accurate number teaches the operator to
 * discount accurate numbers. The real incompleteness is elsewhere and is now
 * named where it belongs, so this says what is true instead.
 */
export const DROPPED_COUNT_INFOTIP =
  "This is every short prose fragment the chunker discarded — the list is complete for that. It is not a complete list of what this document loses: table blocks are removed earlier and are counted separately above.";

export const TABLES_CROSSREF_INFOTIP =
  "The Extracted tables section is what the parser found in the source. It does not tell you which of those tables made it into the knowledge base — and none of them reach it as tables, because table blocks are stripped before chunking.";

/**
 * ⚠️ The re-ingest floor. The copy this replaces said copying the passages and
 * pasting them back was "the only way this content reaches the knowledge base",
 * which is an instruction the very next screen refuses to carry out.
 *
 * `MIN_PASTE_CHARS = 200` / `MIN_PASTE_WORDS = 50` (page.tsx), while every
 * dropped fragment is under 25 words BY CONSTRUCTION (`markdown-chunk.ts:297`).
 * Live 2026-08-10, feeding each document's own "Copy all" output back into the
 * paste gate: DEV `Overview | Thyroid disease` (2 fragments, 171 chars / 30
 * words) and PROD `IJMR-148-522` (1 fragment, 101 chars / 20 words) are both
 * REJECTED — "Needs at least 200 characters (currently 101)", a message that
 * never mentions why. Two of the five documents that drop anything.
 *
 * And a paste that does clear the gate is re-chunked by the same chunker, so a
 * body under 25 words with no preceding chunk in its section is dropped again.
 * The floor that caused the loss also blocks the naive cure. Say so.
 */
export const PASTE_BACK_NOTE =
  "Pasting content back is the only route into the knowledge base, but the paste card needs at least 50 words — and anything under 25 words gets dropped again by the same rule. Paste short passages together with the surrounding text from the document above, not on their own.";

/**
 * ⚠️ The previous version of this string called the chunker's zero "the best
 * signal available" and pointed the operator's suspicion at the PDF parse step.
 * Both halves were wrong in the operator's disfavour: a strictly better signal
 * exists (`tablesSkipped`, computed by the backend and thrown away), and the
 * loss it redirected attention AWAY from — the chunker's own table stripping —
 * is where the loss actually was.
 */
export const CLEAR_INFOTIP =
  "This is the chunker's own accounting of itself, and it only covers short prose fragments. It is not a statement that nothing was lost. Two things it cannot tell you: whether this document was ingested through the older chunker, which reports zero no matter what it discarded; and what the PDF parser may have missed before any of this ran.";

/** Row copy for the merged "checks that did not run" panel. */
export const NOT_CHECKED_CONFLICTS =
  "No marker dictionary is loaded, so this document was not compared against values already in the knowledge base. Verify any numbers yourself.";

/**
 * ⚠️ No longer says "including whole tables". Table blocks never appear in the
 * dropped list even when the preview IS present, so promising them here made
 * the preview's return sound like a completeness guarantee it can never give.
 * The table loss has its own block, driven by a count this page computes itself
 * and which survives the preview being absent entirely.
 */
export const NOT_CHECKED_DROPPED_ABSENT =
  "This server doesn't report which short passages the chunker discards, so approving may leave passages out of the knowledge base with nothing shown here. This is separate from the table blocks counted above, which are stripped regardless.";

export const NOT_CHECKED_DROPPED_MALFORMED =
  "The server sent a chunk preview in a shape this page can't read, so nothing was measured. Treat it exactly like 'not measured' — not like 'clean'.";

export const NOT_CHECKED_INTRO =
  "These checks did not run. An empty result from a check that didn't run means “not measured” — never “clean”.";
