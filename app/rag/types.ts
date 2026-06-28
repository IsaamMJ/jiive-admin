export type DocStatus = "queued" | "processing" | "pending_review" | "ready" | "failed";

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
}

export interface UploadResponse {
  documentId: string;
  title: string;
  status: DocStatus;
}
