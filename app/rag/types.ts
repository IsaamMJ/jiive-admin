export type DocStatus = "queued" | "processing" | "pending_review" | "ready" | "failed";

export type BatchDocStatus = "uploaded" | "parsing" | "parsed" | "ready" | "failed";

export interface RagDocument {
  documentId: string;
  title: string;
  chunkCount: number;
  status: DocStatus;
  failureReason?: string;
  updatedAt: string;
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
