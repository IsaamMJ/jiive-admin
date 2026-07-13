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
  digitalNative: boolean;
  sourceDate: string | null;
  tables: ReviewTable[];
  numericConflicts: NumericConflict[];
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

// ── Paste text ───────────────────────────────────────────────────────────────

export interface PasteTextResponse {
  documentId: string;
  title: string;
  status: "pending_review";
}
