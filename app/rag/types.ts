export type DocStatus = "queued" | "processing" | "pending_review" | "ready" | "failed";

export type BatchDocStatus = "uploaded" | "parsing" | "parsed" | "ready" | "failed";

/**
 * One row of `GET /rag/documents` (a bare array, capped at 500 — see
 * DOCS_LIST_CAP in page.tsx).
 *
 * ── PROVENANCE FIELDS (added by backend c795d8a) ────────────────────────────
 * `sourceUrl` / `discoveredVia` / `discoveryQuery` say whether a MACHINE found
 * this document on the internet rather than a human uploading it. That is the
 * difference between "someone chose this" and "nobody has ever read this", so
 * it must travel with the row.
 *
 * They are typed OPTIONAL because a deployment that predates c795d8a omits the
 * keys entirely, and the absence of a key is NOT the same fact as a null value:
 *
 *   key absent  → this server cannot tell us where documents came from.
 *   key present, value null → this server checked, and a human uploaded it.
 *
 * Collapsing those two into `sourceUrl == null` is exactly the bug this module
 * exists to avoid, so `readProvenance()` in discovery.ts distinguishes them and
 * every consumer goes through it. Do not test `doc.sourceUrl` directly.
 *
 * Verified live 2026-08-10 — BOTH environments now send all three keys, with
 * explicit nulls on hand-uploaded rows:
 *   DEV  7 rows: 3 carry sourceUrl + discoveredVia:"exa" + discoveryQuery:"tsh";
 *        the other 4 carry all three keys as null.
 *   PROD 4 rows: all four carry the keys, all null (no discovery has run there).
 * So the "keys absent" branch is currently unreachable in both environments —
 * it is kept for rollback and for older deployments, and is documented as
 * unverified rather than quietly assumed to work.
 */
export interface RagDocument {
  documentId: string;
  title: string;
  chunkCount: number;
  status: DocStatus;
  failureReason?: string;
  updatedAt: string;
  /**
   * Where a machine fetched this from, or null when a human uploaded it.
   * Remote input — never becomes an `href` without `safeSourceUrl`'s protocol
   * check (discovery.ts), because a `javascript:` URL in an href is script
   * execution, not a link.
   */
  sourceUrl?: string | null;
  /** The discovery channel, e.g. `"exa"`. Null on hand-uploaded rows. */
  discoveredVia?: string | null;
  /** The customer question the KB could not answer. Null on hand-uploaded rows. */
  discoveryQuery?: string | null;
}

export interface RagDocumentDetail extends RagDocument {
  parsedText: string;
  pageCount: number;
  createdAt: string;
}

export interface RagOverview {
  collection: string;
  totalChunks: number;
  vectorDim: number;
  embeddingModel: string;
  sources: string[];
  qdrantStatus: string;
  documents: RagDocument[];
}

export interface ApproveResponse {
  documentId: string;
  status: "ready";
  chunkCount: number;
  versionId: string;
}

export interface UploadResponse {
  documentId: string;
  title: string;
  status: DocStatus;
}

// ── v2 types ─────────────────────────────────────────────────────────────────

export interface ReviewTable {
  page: number;
  markdown: string;
  confidence: "ok" | "low";
}

export interface NumericConflict {
  marker: string;
  newValue: string;
  existingValue: string;
  existingSource: string;
  existingDocumentId: string;
}

export interface ReviewResponse {
  documentId: string;
  title: string;
  status: DocStatus;
  reviewMode: "standard" | "forced_side_by_side";
  pageCount: number | null;
  parsedText: string;
  /**
   * Whether the PDF had a real text layer. `null` means NEVER MEASURED — not
   * "scanned". Rendering null as either verdict invents a parse-quality claim the
   * backend never made, which is exactly the class of bug this KB has to avoid.
   */
  digitalNative: boolean | null;
  sourceDate: string | null;
  tables: ReviewTable[];
  numericConflicts: NumericConflict[];
  /**
   * Whether numeric-conflict checking actually ran. `inert` = the marker
   * dictionary isn't loaded, so `numericConflicts: []` means "not checked", NOT
   * "checked and clean". Absent on older payloads — treat missing as unknown.
   */
  conflictGate?: "inert" | "active";
  sourcePdfUrl: string;
  /**
   * A DRY RUN of the chunker. See ChunkPreview below — this is the only warning
   * an operator will ever get that approving this document will silently drop
   * part of it. Optional: a deployment predating c795d8a omits it entirely, and
   * absent must render as "not measured", never as "nothing was dropped".
   */
  chunkPreview?: ChunkPreview;
}

// ── Chunk preview (ReviewResponse.chunkPreview) ──────────────────────────────
//
// WHY THIS IS A WARNING AND NOT A STAT.
//
// Chunking happens at APPROVE time, not at upload. The operator reads
// `parsedText`, approves, and only THEN is the document cut into chunks and
// embedded. The chunker is not lossless: it holds table blocks out of prose and
// discards fragments below the retrieval floor. Until c795d8a both were visible
// only in a server log line.
//
// So an operator can approve a clinical guideline and silently lose the table
// that holds its numbers. The document reads as approved. The reference ranges
// are simply not in the knowledge base, and nothing anywhere says so.
//
// The loss does not degrade to "I don't know" — it degrades to a confident
// wrong answer. Verified live on dev 2026-08-10 by feeding a dropped fragment
// back through POST /rag/search: the dropped passage was
//   "Offer tests for thyroid dysfunction to adults, children and young people
//    with: type 1 diabetes or other autoimmune diseases…"
// and with it missing the KB's top hit at 0.742 is its inverse —
//   "DO NOT offer testing for thyroid dysfunction solely because an adult,
//    child or young person has type 2 diabetes."
// A missing chunk is not an absence. It is a substitution.
//
// Live base rate 2026-08-10 — dropping is COMMON, not exceptional:
//   DEV  3 of 7 documents dropped something (30, 5 and 2 passages).
//   PROD 2 of 4 documents dropped something (4 and 1 passages).
// Which is why the gate is sized to the loss instead of firing a fixed
// ceremony every time (see DroppedContent.tsx).

/**
 * One passage the chunker will not store.
 *
 * ⚠️ `{text, words}` — THAT IS THE WHOLE PAYLOAD. There is no page, no offset,
 * no reason, no type. Two different causes (table block held out of prose;
 * fragment below the retrieval floor) produce byte-identical shapes, so the UI
 * must never label a fragment with a reason or call one a table. Verified on
 * every dropped row across both environments 2026-08-10: keys are exactly
 * `["text", "words"]`.
 */
export interface DroppedFragment {
  text: string;
  /**
   * The backend's own word count, or `null` when it did not send a usable one.
   *
   * ⚠️ NULL IS LOAD-BEARING — do not default it to 0. `coerceFragment` refuses
   * to fabricate this precisely because a 0 would drag the "N words" total down
   * and understate the size of the loss. An earlier revision then wrote
   * `words: f.words ?? 0` one line later and threw that away, which rendered
   * "Passage 3 · 0 words" and silently hid the retrieval probe (the probe is
   * gated on length). Unreachable today — the backend always sends `words` —
   * but the coercer exists for the day it doesn't.
   */
  words: number | null;
  /**
   * The server cut this text off at 200 characters.
   *
   * `rag-document.service.ts:1419` does `text: d.text.slice(0, 200)` with no
   * ellipsis and no flag, so a truncated passage is indistinguishable from a
   * complete one on the wire. Inferred client-side from the length. It matters
   * because this component claims to render the passages VERBATIM and offers
   * them for copy-paste re-ingestion — a silent truncation would make both
   * claims false. Not observed live (longest fragment 2026-08-10 was 168 chars
   * at 24 words), but the drop floor is 25 words and clinical vocabulary runs
   * well over 8 chars/word, so it is reachable.
   */
  truncated: boolean;
}

/** One chunk that WILL be stored. Context only — `dropped` is the warning. */
export interface ChunkSample {
  source: string;
  text: string;
}

/**
 * `ReviewResponse.chunkPreview` — the chunker's own dry run of this document.
 *
 * ⚠️ THIS IS A DRY RUN OF THE CURRENT CHUNKER — NOT A READING OF WHAT IS STORED.
 *
 * The backend re-runs `chunkForPublish` over `parsedText` at READ time
 * (`rag-document.service.ts:1363`). For an already-approved document that means
 * the preview describes what approving it TODAY would produce, which is not
 * necessarily what was produced when it actually was approved.
 *
 * An earlier revision of this comment claimed the arithmetic always agreed
 * ("77/77, 28/28, 4/4, 66/66, 15/15, 9/9, 5/5"). That was wrong — the 15 was
 * read from the preview, not from the stored row. Re-checked against
 * `GET /rag/documents` on 2026-08-10:
 *
 *   PROD `IJMR-148-522 (1)` — stored chunkCount 12, preview chunkCount 15.
 *
 * Cause is in the backend's own comment at `rag-document.service.ts:1692` —
 * every LlamaParse PDF used to fall through to the blind 500-word chunker
 * ("Found in PRODUCTION"). That document's 12 stored chunks were cut by a
 * chunker with no concept of dropping, while `dropped` describes a markdown
 * chunking that has never run on it. Its one "dropped" passage is in fact
 * retrievable from the live KB — `POST /rag/search` returns it verbatim at
 * score 0.479, sourced to that same document.
 *
 * So the preview may only be spoken about in the PAST TENSE when
 * `chunkPreview.chunkCount` equals the stored `chunkCount`. `describeDrop`
 * takes the stored count for exactly this reason and degrades to a conditional
 * when they diverge or when the stored count is unknown.
 *
 * ⚠️ `sample` is TRUNCATED — 3 entries returned for a 77-chunk document. The
 * same object demonstrably caps its arrays, and there is no `droppedCount` to
 * check `dropped` against. So the UI says "N passages listed", never
 * "N passages were dropped", and never "these are all of them".
 */
export interface ChunkPreview {
  /** Chunks this document WILL produce. Meaningless when `error` is set. */
  chunkCount: number;
  /** ⚠️ The warning. Passages that will be in the document and NOT in the KB. */
  dropped: DroppedFragment[];
  /** Examples of what WILL be stored. Context, not a warning. */
  sample: ChunkSample[];
  /**
   * Set when the preview itself failed to run. `null` on the happy path —
   * which means the field being PRESENT AND NULL is a successful check, and is
   * a completely different fact from the whole `chunkPreview` object being
   * absent. `error != null` means nothing was measured: it must read like "not
   * measured", never like "clean".
   */
  error: string | null;
}

export interface BulkUploadAccepted {
  documentId: string;
  title: string;
  status: "uploaded";
}

export interface BulkUploadRejected {
  filename: string;
  reason: string;
}

export interface BulkUploadResponse {
  batchId: string;
  accepted: BulkUploadAccepted[];
  rejected: BulkUploadRejected[];
}

export interface BatchDocument {
  documentId: string;
  title: string;
  status: BatchDocStatus;
  reviewMode: "standard" | "forced_side_by_side";
  failureReason?: string;
}

export interface BatchResponse {
  batchId: string;
  createdAt: string;
  documents: BatchDocument[];
}

export interface VersionInfo {
  activeVersionId: string;
  createdAt: string;
  documentCount: number;
  totalChunks: number;
}

// ── Markdown conversion (POST /rag/convert) ──────────────────────────────────
//
// Previews only — persists NOTHING. Paste raw web content, get back reviewable
// Markdown plus a verification report. The operator then posts the (optionally
// edited) markdown to POST /rag/documents/text to enter the normal review flow.
//
// ⚠️ `verify.ok === false` is a SAFETY GATE, not a hint: ingestion must be
// impossible while it is false. A silently altered clinical value (19 mg/day →
// 18 mg/day) is indistinguishable from a correct one once embedded and cited
// back to a patient as guideline-backed fact.

export interface ConvertVerifyStats {
  numbersInSource: number;
  numbersInOutput: number;
  /** Numbers present in the output but ABSENT from the source — the fail condition. */
  fabricatedNumbers: string[];
  /**
   * Numbers in the source that didn't make it into the output. ADVISORY, not a
   * failure — dropping superseded values (e.g. the 2010 figures) is usually
   * correct. Surfaced so silent loss of a value is still visible.
   */
  missingNumbers?: string[];
  sourceWords: number;
  outputWords: number;
  sections: number;
}

export interface ConvertVerify {
  ok: boolean;
  errors: string[];
  warnings: string[];
  stats: ConvertVerifyStats;
}

export interface ConvertChunk {
  text: string;
  /** Real heading path — "Title › Section › Sub-section", not a fabricated page. */
  source: string;
  headingPath: string[];
  chunkIndex: number;
}

/** Content the converter discarded. Surfaced so truncation is never silent. */
export interface ConvertDropped {
  source: string;
  words: number;
  text: string;
}

export interface ConvertCleanup {
  preRemovedLines: number;
  preRemovedSections: string[];
  postRemovedLines: number;
  postRemovedSections: string[];
}

export interface ConvertResponse {
  markdown: string;
  verify: ConvertVerify;
  chunks: ConvertChunk[];
  tablesSkipped: number;
  sectionsFound: number;
  dropped: ConvertDropped[];
  cleanup: ConvertCleanup;
}

// ── Paste text ───────────────────────────────────────────────────────────────

export interface PasteTextResponse {
  documentId: string;
  title: string;
  status: "pending_review";
}

// ── Discovered queue (GET /rag/discovered) ───────────────────────────────────
//
// The backend replayed 1,248 real production messages against this knowledge
// base on 2026-08-09: 15 of 22 health questions and 7 of 7 biomarker questions
// (hs-CRP, creatinine, TSH, HbA1c, vitamin D, haemoglobin) retrieved NOTHING.
// The KB held 4 documents, all about diet, for a product whose entire value is
// a blood test. So the backend now records every retrieval miss and goes and
// fetches candidate documents for the gaps.
//
// ⚠️ A discovered document is clinical content that NO HUMAN HAS READ — a
// machine fetched it off the internet. It lands at `pending_review` and reaches
// customers only through the same one-at-a-time approve button an uploaded
// document uses. There is deliberately no bulk path, and this module must not
// grow one.
//
// Verified live against dev 2026-08-09 (3 rows, all `discoveryQuery: "tsh"`)
// and prod (`[]`, HTTP 200 — the prod miss log only started filling today).

/**
 * One row of `GET /rag/discovered`. The array is newest-first.
 *
 * These same documents ALSO appear in `GET /rag/documents` — they are ordinary
 * `pending_review` rows there, with no marker distinguishing them (see
 * DISCOVERED_PARTITION_NOTE in discovery.ts).
 */
export interface DiscoveredDocument {
  documentId: string;
  title: string;
  status: DocStatus;
  /**
   * Where the machine got it. Remote input, re-checked server-side against a
   * 16-publisher allowlist — but still never rendered as an href without a
   * protocol check here (see `safeSourceUrl` in discovery.ts).
   */
  sourceUrl: string;
  /**
   * Publication date **or the literal string `"unknown"`** — the backend never
   * invents one. Every dev row is currently `"unknown"`, so that is the common
   * path, not an edge case.
   *
   * NEVER pass this to `new Date()`: it is free-form (`"unknown"`, `"Jan 2024"`,
   * `"2024-05-07"` have all been observed across this module's endpoints), and
   * formatting it would turn "we don't know" into a confident-looking date.
   */
  sourceDate: string | null;
  /**
   * The customer question the KB could not answer — the reason this document
   * was fetched at all. Frame it as the gap, not as a search term.
   */
  discoveryQuery: string | null;
  /** Always 0 before approval — chunks are created by the approve step. */
  chunkCount: number;
  updatedAt: string;
}

/**
 * `POST /rag/discover` — runs a discovery pass now instead of waiting for the
 * weekly job. Bounded to 5 documents per run; a gap must recur twice in 7 days
 * before it is chased. Takes ~30s and costs a real search-API call.
 *
 * `note` is present when nothing was found or no key is set. A 409 means
 * discovery is not wired in this deployment — that is a capability answer, not
 * an outage (see `runDiscovery`).
 */
export interface DiscoverRunResponse {
  gaps: string[];
  fetched: number;
  queued: number;
  skippedDuplicate: number;
  note?: string;
}
