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
