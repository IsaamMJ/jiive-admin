"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2, Eye, CheckCircle, Upload, AlertTriangle, Files } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import api from "@/lib/api";
import { InfoTip } from "@/components/InfoTip";
import type {
  RagDocument,
  RagOverview,
  DocStatus,
  BatchDocStatus,
  ReviewResponse,
  BulkUploadResponse,
  BatchResponse,
  VersionInfo,
  ApproveResponse,
  PasteTextResponse,
} from "./types";

// Poll every 3s while any doc is queued/processing (safety net — uploads are mostly synchronous).
const POLL_MS = 3_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_BULK_FILES = 50;

// Client-side approximations of the server's paste-text gates (server validates
// against its own cleaned text — these just stop obvious mistakes early).
const MAX_PASTE_CHARS = 500_000;
const MIN_PASTE_CHARS = 200;
const MIN_PASTE_WORDS = 50;

function isInProgress(status: DocStatus): boolean {
  return status === "queued" || status === "processing";
}

function isBatchInProgress(status: BatchDocStatus): boolean {
  return status === "uploaded" || status === "parsing";
}

function StatusBadge({ status, failureReason }: { status: DocStatus; failureReason?: string }) {
  const variants: Record<DocStatus, { label: string; className: string }> = {
    ready: { label: "Ready", className: "border-green-200 bg-green-50 text-green-700" },
    pending_review: { label: "Pending review", className: "border-amber-200 bg-amber-50 text-amber-700" },
    failed: { label: "Failed", className: "border-red-200 bg-red-50 text-red-700" },
    queued: { label: "Queued", className: "border-border bg-muted text-muted-foreground" },
    processing: { label: "Processing", className: "border-border bg-muted text-muted-foreground" },
  };
  const { label, className } = variants[status] ?? { label: status, className: "border-border bg-muted text-muted-foreground" };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}
      title={status === "failed" && failureReason ? failureReason : undefined}
    >
      {status === "processing" && <Loader2 size={10} className="animate-spin" />}
      {label}
      {status === "failed" && failureReason && (
        <span className="ml-1 text-[10px] opacity-80">— {failureReason}</span>
      )}
    </span>
  );
}

function BatchStatusBadge({ status, failureReason }: { status: BatchDocStatus; failureReason?: string }) {
  const variants: Record<BatchDocStatus, { label: string; className: string }> = {
    uploaded: { label: "Uploaded", className: "border-border bg-muted text-muted-foreground" },
    parsing: { label: "Parsing", className: "border-border bg-muted text-muted-foreground" },
    parsed: { label: "Ready for review", className: "border-amber-200 bg-amber-50 text-amber-700" },
    ready: { label: "Ready", className: "border-green-200 bg-green-50 text-green-700" },
    failed: { label: "Failed", className: "border-red-200 bg-red-50 text-red-700" },
  };
  const { label, className } = variants[status] ?? { label: status, className: "border-border bg-muted text-muted-foreground" };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>
      {(status === "parsing" || status === "uploaded") && <Loader2 size={10} className="animate-spin" />}
      {label}
      {status === "failed" && failureReason && (
        <span className="ml-1 text-[10px] opacity-80">— {failureReason}</span>
      )}
    </span>
  );
}

export default function KnowledgeBasePage() {
  const [docs, setDocs] = useState<RagDocument[]>([]);
  const [overview, setOverview] = useState<RagOverview | null>(null);
  const [docsLoading, setDocsLoading] = useState(true);
  const [overviewLoading, setOverviewLoading] = useState(true);

  // Version info (v2)
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);

  // Single upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  // Did the operator type the title themselves? If not, it's an auto-fill derived
  // from the filename and must re-sync when they pick a different file. The old
  // `if (!uploadTitle)` guard couldn't tell the two apart, so switching files kept
  // the previous file's name and uploaded a new PDF under the wrong title.
  const [uploadTitleEdited, setUploadTitleEdited] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Drag-and-drop (single upload drop zone)
  const [dragOver, setDragOver] = useState(false);

  // Paste-text upload state
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pasting, setPasting] = useState(false);
  const pastingRef = useRef(false);

  // Bulk upload state (v2)
  const bulkInputRef = useRef<HTMLInputElement>(null);
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [bulkUploading, setBulkUploading] = useState(false);
  const bulkUploadingRef = useRef(false);
  const [bulkResult, setBulkResult] = useState<BulkUploadResponse | null>(null);

  // Batch polling state (v2)
  const [batchData, setBatchData] = useState<BatchResponse | null>(null);
  const batchPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // F3: token to invalidate stale batch poll callbacks on new upload or dismiss
  const batchPollTokenRef = useRef(0);

  // Review drawer — now uses ReviewResponse (v2)
  const [reviewDoc, setReviewDoc] = useState<ReviewResponse | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  // Per-review state (v2)
  const [tablesReviewed, setTablesReviewed] = useState(false);
  // F5: conflict acknowledgment gate
  const [conflictsAck, setConflictsAck] = useState(false);
  const [sourceDate, setSourceDate] = useState("");
  // PDF blob URL for forced_side_by_side — use ref for cleanup, state for render
  const pdfObjectUrlRef = useRef<string | null>(null);
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  // Token to detect stale review fetches (Bug A).
  const reviewReqRef = useRef(0);

  // Delete confirm dialog
  const [deleteTarget, setDeleteTarget] = useState<RagDocument | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Double-submit guards (Bug C).
  const uploadingRef = useRef(false);
  const approvingRef = useRef(false);
  const deletingRef = useRef(false);

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Revoke a PDF blob URL and update both ref + state.
  function revokePdf() {
    if (pdfObjectUrlRef.current) {
      URL.revokeObjectURL(pdfObjectUrlRef.current);
      pdfObjectUrlRef.current = null;
    }
    setPdfObjectUrl(null);
  }

  function setPdf(url: string) {
    revokePdf();
    pdfObjectUrlRef.current = url;
    setPdfObjectUrl(url);
  }

  // Close review drawer and clean up all associated state.
  function closeReview() {
    reviewReqRef.current++;
    setReviewLoading(false);
    setReviewDoc(null);
    setTablesReviewed(false);
    setConflictsAck(false);
    setSourceDate("");
    setPdfLoading(false);
    revokePdf();
  }

  // ── Fetch functions ───────────────────────────────────────────────────────

  const fetchDocs = useCallback(() => {
    return api
      .get<RagDocument[]>("/rag/documents")
      .then((r) => {
        setDocs(r.data);
        setDocsLoading(false);
        return r.data;
      })
      .catch(() => {
        setDocsLoading(false);
        return [] as RagDocument[];
      });
  }, []);

  const fetchOverview = useCallback(() => {
    api
      .get<RagOverview>("/rag/overview")
      .then((r) => {
        setOverview(r.data);
        setOverviewLoading(false);
      })
      .catch(() => { setOverviewLoading(false); });
  }, []);

  const fetchVersion = useCallback(() => {
    api
      .get<VersionInfo>("/rag/version")
      .then((r) => setVersionInfo(r.data))
      .catch(() => {});
  }, []);

  // ── Polling: main docs list ───────────────────────────────────────────────
  // Arms one timer whenever any doc is in-progress. React re-runs the effect
  // each time fetchDocs() updates `docs`, so exactly one timer is live at a
  // time. Cleanup cancels the pending tick on every re-run and on unmount.

  useEffect(() => {
    if (!docs.some((d) => isInProgress(d.status))) return;
    const t = setTimeout(() => { if (!document.hidden) fetchDocs(); }, POLL_MS);
    return () => clearTimeout(t);
  }, [docs, fetchDocs]);

  // ── Batch polling (v2) ────────────────────────────────────────────────────

  function pollBatch(batchId: string) {
    const token = ++batchPollTokenRef.current;
    if (batchPollTimerRef.current) clearTimeout(batchPollTimerRef.current);
    batchPollTimerRef.current = setTimeout(async () => {
      try {
        const r = await api.get<BatchResponse>(`/rag/batches/${batchId}`);
        if (batchPollTokenRef.current !== token) return;
        setBatchData(r.data);
        const stillPending = r.data.documents.some((d) => isBatchInProgress(d.status));
        if (stillPending) pollBatch(batchId);
        else {
          // When batch settles, refresh the main docs list too.
          fetchDocs();
          fetchOverview();
          fetchVersion();
        }
      } catch {
        // Silent — stop polling on error.
      }
    }, POLL_MS);
  }

  useEffect(() => {
    fetchDocs();
    fetchOverview();
    fetchVersion();
    return () => {
      if (batchPollTimerRef.current) clearTimeout(batchPollTimerRef.current);
      if (pdfObjectUrlRef.current) URL.revokeObjectURL(pdfObjectUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Single upload ─────────────────────────────────────────────────────────

  function handleFileSelect(file: File | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Only PDF files are accepted.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error("File exceeds the 25 MB limit.");
      return;
    }
    setUploadFile(file);
    // Auto-fill the title from the filename unless the operator has typed their
    // own. Always re-sync on a new file so a switched file can't inherit a stale
    // title from a previous selection.
    if (!uploadTitleEdited) setUploadTitle(file.name.replace(/\.pdf$/i, ""));
    if (file.size > 5 * 1024 * 1024) {
      toast.info("Large file — consider Bulk upload for background processing (avoids upload timeouts).");
    }
  }

  async function handleUpload() {
    if (!uploadFile) return;
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", uploadFile);
      if (uploadTitle.trim()) form.append("title", uploadTitle.trim());
      // Do NOT set Content-Type manually — axios sets the multipart boundary.
      // Large PDFs parse synchronously on the backend (Docling) and can take
      // minutes — give this request room before axios gives up.
      await api.post("/rag/documents", form, { timeout: 180_000 });
      toast.success("Document uploaded — awaiting review.");
      setUploadFile(null);
      setUploadTitle("");
      setUploadTitleEdited(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      fetchDocs();
      fetchOverview();
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if ((err as { code?: string })?.code === "ECONNABORTED" || status === 504 || status === 502 || status === 408) {
        // Client/gateway timed out, but the backend may still be parsing —
        // the doc could already exist in a processing/pending_review state.
        toast.error(
          "This PDF is large and the upload timed out. It may still be processing — check the documents list in a minute, or use Bulk upload (it processes in the background)."
        );
        fetchDocs();
      } else {
        const data = (err as { response?: { data?: { message?: string; error?: string } } })?.response?.data;
        toast.error(data?.message ?? data?.error ?? "Upload failed.");
      }
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }

  // ── Drag-and-drop (single upload) ─────────────────────────────────────────

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }
  function handleDragLeave() { setDragOver(false); }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0] ?? null;
    handleFileSelect(file);
  }

  // ── Paste text ─────────────────────────────────────────────────────────────

  async function handlePasteText() {
    if (pasteDisabledReason) return;
    if (pastingRef.current) return;
    pastingRef.current = true;
    setPasting(true);
    try {
      const r = await api.post<PasteTextResponse>("/rag/documents/text", {
        text: pasteText,
        title: pasteTitle.trim(),
      });
      toast.success(`"${r.data.title}" saved — pending review.`);
      setPasteTitle("");
      setPasteText("");
      // Synchronous — the doc is already pending_review, no queued/processing
      // state to poll for.
      fetchDocs();
      fetchOverview();
      fetchVersion();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { message?: string } } })?.response?.data;
      toast.error(data?.message ?? "Could not save the pasted text — check your connection and try again.");
    } finally {
      pastingRef.current = false;
      setPasting(false);
    }
  }

  // ── Bulk upload (v2) ──────────────────────────────────────────────────────

  function handleBulkFileSelect(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (files.length > MAX_BULK_FILES) {
      toast.error(`Maximum ${MAX_BULK_FILES} files per bulk upload.`);
      return;
    }
    const selected = Array.from(files).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (selected.length < files.length) {
      toast.error("Non-PDF files were ignored.");
    }
    setBulkFiles(selected);
  }

  async function handleBulkUpload() {
    if (!bulkFiles.length) return;
    if (bulkUploadingRef.current) return;
    bulkUploadingRef.current = true;
    setBulkUploading(true);
    try {
      const form = new FormData();
      bulkFiles.forEach((f) => form.append("files", f));
      const r = await api.post<BulkUploadResponse>("/rag/documents/bulk", form);
      setBulkResult(r.data);
      setBulkFiles([]);
      if (bulkInputRef.current) bulkInputRef.current.value = "";
      toast.success(
        `${r.data.accepted.length} accepted` +
        (r.data.rejected.length > 0 ? `, ${r.data.rejected.length} rejected` : "") +
        "."
      );
      // Start polling the batch immediately.
      if (r.data.batchId) {
        pollBatch(r.data.batchId);
      }
      fetchDocs();
      fetchOverview();
      fetchVersion();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        "Bulk upload failed.";
      toast.error(msg);
    } finally {
      bulkUploadingRef.current = false;
      setBulkUploading(false);
    }
  }

  // ── Review (v2) ───────────────────────────────────────────────────────────

  async function openReview(documentId: string) {
    const token = ++reviewReqRef.current;
    setReviewLoading(true);
    setReviewDoc(null);
    setTablesReviewed(false);
    setConflictsAck(false);
    setSourceDate("");
    setPdfLoading(false);
    revokePdf();
    try {
      const r = await api.get<ReviewResponse>(`/rag/documents/${documentId}/review`);
      if (reviewReqRef.current !== token) return; // dialog closed while in flight
      setReviewDoc(r.data);
      setSourceDate(r.data.sourceDate ?? "");
      // For forced_side_by_side, fetch the source PDF as an authenticated blob.
      if (r.data.reviewMode === "forced_side_by_side") {
        setPdfLoading(true);
        try {
          const pdfResp = await api.get<Blob>(`/rag/documents/${documentId}/source.pdf`, {
            responseType: "blob",
          });
          if (reviewReqRef.current !== token) {
            // Dialog closed — discard the blob without setting state.
            URL.revokeObjectURL(URL.createObjectURL(pdfResp.data));
            return;
          }
          setPdf(URL.createObjectURL(pdfResp.data));
        } catch {
          if (reviewReqRef.current === token) {
            toast.error("Could not load source PDF — verify tables manually.");
          }
        } finally {
          if (reviewReqRef.current === token) setPdfLoading(false);
        }
      }
    } catch {
      if (reviewReqRef.current === token) toast.error("Failed to load document detail.");
    } finally {
      if (reviewReqRef.current === token) setReviewLoading(false);
    }
  }

  // ── Approve (v2) ──────────────────────────────────────────────────────────

  async function handleApprove() {
    if (!reviewDoc) return;
    // F4: defense-in-depth on clinical gate
    if (reviewDoc.reviewMode === "forced_side_by_side" && !tablesReviewed) return;
    // F5: conflict acknowledgment gate
    if ((conflicts ?? []).length > 0 && !conflictsAck) return;
    if (approvingRef.current) return;
    approvingRef.current = true;
    setApproving(true);
    try {
      const body: { tablesReviewed?: boolean; sourceDate?: string; conflictsAcknowledged?: boolean } = {};
      if (reviewDoc.reviewMode === "forced_side_by_side") body.tablesReviewed = tablesReviewed;
      if ((conflicts ?? []).length > 0) body.conflictsAcknowledged = conflictsAck;
      if (sourceDate.trim()) body.sourceDate = sourceDate.trim();
      const r = await api.post<ApproveResponse>(`/rag/documents/${reviewDoc.documentId}/approve`, body);
      const vid = r.data.versionId ? r.data.versionId.slice(0, 8) : "updated";
      toast.success(`Document approved — now live (KB version ${vid}).`);
      // Refresh batch data if we're in a batch session.
      if (batchData?.batchId) {
        api.get<BatchResponse>(`/rag/batches/${batchData.batchId}`)
          .then((br) => setBatchData(br.data))
          .catch(() => {});
      }
      closeReview();
      fetchDocs();
      fetchOverview();
      fetchVersion();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { code?: string; message?: string } } })?.response?.data;
      if (data?.code === "tables_not_reviewed") {
        toast.error("Confirm you've reviewed the tables before approving.");
      } else if (data?.code === "conflicts_not_acknowledged") {
        toast.error("Acknowledge the numeric conflicts before approving.");
      } else {
        toast.error(data?.message || "Approval failed.");
      }
    } finally {
      approvingRef.current = false;
      setApproving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!deleteTarget) return;
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    try {
      // axios delete with body: pass as `data` in config.
      await api.delete(`/rag/documents/${deleteTarget.documentId}`, { data: { confirm: true } });
      toast.success("Document deleted.");
      setDeleteTarget(null);
      fetchDocs();
      fetchOverview();
      fetchVersion();
    } catch {
      toast.error("Delete failed.");
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const isForcedSBS = reviewDoc?.reviewMode === "forced_side_by_side";
  // F1: defensive derived vars — null API fields must not white-screen the dialog
  const conflicts = reviewDoc?.numericConflicts ?? [];
  const tables = reviewDoc?.tables ?? [];
  // An empty conflict list is only reassuring if the check actually RAN. When the
  // gate is inert (no marker dictionary) `numericConflicts: []` means "not
  // checked" — showing nothing would read as "checked, clean".
  const conflictGateInert = reviewDoc?.conflictGate === "inert";

  // Paste-text local validation (approximation of server gates — see MAX/MIN_PASTE_* above).
  const pasteTextTrimmed = pasteText.trim();
  const pasteCharCount = pasteTextTrimmed.length;
  const pasteWordCount = pasteTextTrimmed === "" ? 0 : pasteTextTrimmed.split(/\s+/).filter(Boolean).length;
  const pasteDisabledReason: string | null =
    pasteTitle.trim() === ""
      ? "Add a title first."
      : pasteCharCount === 0
      ? "Paste some text first."
      : pasteCharCount > MAX_PASTE_CHARS
      ? `Too long — trim to under ${MAX_PASTE_CHARS.toLocaleString()} characters (currently ${pasteCharCount.toLocaleString()}).`
      : pasteCharCount < MIN_PASTE_CHARS
      ? `Needs at least ${MIN_PASTE_CHARS} characters (currently ${pasteCharCount}).`
      : pasteWordCount < MIN_PASTE_WORDS
      ? `Needs at least ${MIN_PASTE_WORDS} words — about a full paragraph (currently ${pasteWordCount}).`
      : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AdminLayout title="Knowledge Base">
      <div className="flex flex-col gap-6">

        {/* Coverage strip */}
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {overviewLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)
            ) : overview ? (
              <>
                <Card size="sm">
                  <CardHeader><CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Total chunks</CardTitle></CardHeader>
                  <CardContent><span className="text-2xl font-semibold">{overview.totalChunks?.toLocaleString() ?? "—"}</span></CardContent>
                </Card>
                <Card size="sm">
                  <CardHeader><CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Documents</CardTitle></CardHeader>
                  <CardContent><span className="text-2xl font-semibold">{overview.documents?.length ?? 0}</span></CardContent>
                </Card>
                <Card size="sm">
                  <CardHeader><CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Embedding model</CardTitle></CardHeader>
                  <CardContent><span className="text-sm font-mono">{overview.embeddingModel}</span></CardContent>
                </Card>
                <Card size="sm">
                  <CardHeader><CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Qdrant</CardTitle></CardHeader>
                  <CardContent>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                        overview.qdrantStatus === "ok"
                          ? "border-green-200 bg-green-50 text-green-700"
                          : "border-red-200 bg-red-50 text-red-700"
                      }`}
                    >
                      {overview.qdrantStatus}
                    </span>
                  </CardContent>
                </Card>
              </>
            ) : (
              <p className="col-span-4 text-sm text-muted-foreground">Coverage data unavailable.</p>
            )}
          </div>

          {/* KB version line (v2) */}
          {versionInfo && (
            <p className="text-xs text-muted-foreground">
              KB version{" "}
              <span className="font-mono">{versionInfo.activeVersionId?.slice(0, 8) ?? "—"}</span>
              {" · "}{versionInfo.documentCount ?? "—"} docs
              {" · "}{versionInfo.totalChunks?.toLocaleString() ?? "—"} chunks
              {" · "}{versionInfo.createdAt ? new Date(versionInfo.createdAt).toLocaleDateString() : "—"}
            </p>
          )}
        </div>

        {/* Single upload */}
        <Card>
          <CardHeader><CardTitle>Upload document</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-sm transition-colors ${
                  dragOver
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:bg-accent"
                }`}
              >
                <Upload size={20} />
                {uploadFile ? (
                  <span className="font-medium text-foreground">{uploadFile.name}</span>
                ) : (
                  <span>Drop a PDF here or click to browse</span>
                )}
                <span className="text-xs opacity-70">PDF only · max 25 MB</span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
              />

              {uploadFile && (
                <div className="flex items-center gap-3">
                  <Input
                    placeholder="Document title (optional)"
                    value={uploadTitle}
                    onChange={(e) => {
                      setUploadTitle(e.target.value);
                      // Any keystroke means the operator owns the title now —
                      // stop auto-syncing it from the filename. An empty box means
                      // they cleared it: fall back to auto-fill for the next file.
                      setUploadTitleEdited(e.target.value.trim() !== "");
                    }}
                    className="flex-1"
                    disabled={uploading}
                  />
                  <Button onClick={handleUpload} disabled={uploading}>
                    {uploading ? <><Loader2 size={14} className="animate-spin mr-2" />Processing…</> : "Upload"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={uploading}
                    onClick={() => {
                      setUploadFile(null);
                      setUploadTitle("");
                      setUploadTitleEdited(false);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
              {uploading && (
                <p className="text-xs text-muted-foreground">
                  Large PDFs can take a minute or two to parse — please wait.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Bulk upload (v2) */}
        <Card>
          <CardHeader><CardTitle>Bulk upload</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={() => bulkInputRef.current?.click()}
                  disabled={bulkUploading}
                >
                  <Files size={14} className="mr-2" />
                  Select PDFs
                </Button>
                {bulkFiles.length > 0 && (
                  <span className="text-sm text-muted-foreground">
                    {bulkFiles.length} file{bulkFiles.length !== 1 ? "s" : ""} selected
                  </span>
                )}
                <input
                  ref={bulkInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => handleBulkFileSelect(e.target.files)}
                />
              </div>

              {bulkFiles.length > 0 && (
                <div className="flex items-center gap-3">
                  <div className="flex-1 text-xs text-muted-foreground">
                    {bulkFiles.map((f) => f.name).join(", ")}
                  </div>
                  <Button onClick={handleBulkUpload} disabled={bulkUploading}>
                    {bulkUploading
                      ? <><Loader2 size={14} className="animate-spin mr-2" />Uploading…</>
                      : `Upload ${bulkFiles.length} file${bulkFiles.length !== 1 ? "s" : ""}`
                    }
                  </Button>
                  <Button
                    variant="outline"
                    disabled={bulkUploading}
                    onClick={() => {
                      setBulkFiles([]);
                      if (bulkInputRef.current) bulkInputRef.current.value = "";
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}

              <p className="text-xs text-muted-foreground">PDF only · up to {MAX_BULK_FILES} files per batch</p>
            </div>
          </CardContent>
        </Card>

        {/* Paste text */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              Paste text
              <InfoTip label="Best option for typed or copied text — there's no PDF parsing step, so nothing can get garbled. The text goes into the knowledge base exactly as written." />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <Input
                aria-label="Document title"
                placeholder="Document title"
                value={pasteTitle}
                onChange={(e) => setPasteTitle(e.target.value)}
                disabled={pasting}
              />
              <textarea
                aria-label="Document content"
                placeholder="Paste or type the content here…"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                disabled={pasting}
                rows={10}
                className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm leading-relaxed transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 dark:bg-input/30 dark:disabled:bg-input/80"
              />
              <div className="flex items-center justify-between gap-3">
                <span
                  className={`text-xs ${
                    pasteCharCount > 0 && (pasteCharCount < MIN_PASTE_CHARS || pasteWordCount < MIN_PASTE_WORDS || pasteCharCount > MAX_PASTE_CHARS)
                      ? "text-amber-700"
                      : "text-muted-foreground"
                  }`}
                >
                  {pasteWordCount.toLocaleString()} words · {pasteCharCount.toLocaleString()} characters
                  {" "}
                  <span className="opacity-70">(need ≥{MIN_PASTE_WORDS} words / ≥{MIN_PASTE_CHARS} chars · max {MAX_PASTE_CHARS.toLocaleString()} chars)</span>
                </span>
                <InfoTip
                  side="left"
                  label="Saving is instant — unlike PDFs, pasted text doesn't need background processing. It shows up below as “Pending review” right away."
                />
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={handlePasteText} disabled={pasting || pasteDisabledReason !== null} title={pasteDisabledReason ?? undefined}>
                  {pasting ? <><Loader2 size={14} className="animate-spin mr-2" />Saving…</> : "Save text"}
                </Button>
                {(pasteTitle !== "" || pasteText !== "") && (
                  <Button
                    variant="outline"
                    disabled={pasting}
                    onClick={() => { setPasteTitle(""); setPasteText(""); }}
                  >
                    Clear
                  </Button>
                )}
                {pasteDisabledReason && (pasteTitle !== "" || pasteText !== "") && (
                  <span className="text-xs text-muted-foreground">{pasteDisabledReason}</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Bulk result + batch status (v2) */}
        {bulkResult && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Batch {bulkResult.batchId.slice(0, 8)}</span>
                <Button variant="ghost" size="sm" onClick={() => { if (batchPollTimerRef.current) clearTimeout(batchPollTimerRef.current); batchPollTokenRef.current++; setBulkResult(null); setBatchData(null); }}>
                  Dismiss
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/* Accepted / rejected summary */}
              <div className="flex gap-4 text-sm">
                <span className="text-green-700">{bulkResult.accepted.length} accepted</span>
                {bulkResult.rejected.length > 0 && (
                  <span className="text-destructive">{bulkResult.rejected.length} rejected</span>
                )}
              </div>

              {bulkResult.rejected.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 flex flex-col gap-1">
                  <p className="text-xs font-medium text-red-700">Rejected files:</p>
                  {bulkResult.rejected.map((r, i) => (
                    <p key={i} className="text-xs text-red-800">
                      <span className="font-medium">{r.filename}</span> — {r.reason}
                    </p>
                  ))}
                </div>
              )}

              {/* Per-doc batch status (polling) */}
              {batchData && (
                <div className="rounded-lg border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Mode</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {batchData.documents.map((d) => (
                        <TableRow key={d.documentId}>
                          <TableCell className="font-medium max-w-xs truncate">{d.title}</TableCell>
                          <TableCell>
                            <BatchStatusBadge status={d.status} failureReason={d.failureReason} />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {d.reviewMode === "forced_side_by_side" ? "Side-by-side" : "Standard"}
                          </TableCell>
                          <TableCell>
                            {d.status === "parsed" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openReview(d.documentId)}
                              >
                                <Eye size={14} className="mr-1" />
                                Review
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Documents table */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Documents</h2>
            <span className="text-xs text-muted-foreground">{docs.length} total</span>
          </div>

          {docsLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead className="text-right">Chunks</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {docs.map((doc) => (
                    <TableRow key={doc.documentId}>
                      <TableCell className="font-medium max-w-xs truncate">{doc.title}</TableCell>
                      <TableCell className="text-right tabular-nums">{doc.chunkCount}</TableCell>
                      <TableCell>
                        <StatusBadge status={doc.status} failureReason={doc.failureReason} />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {new Date(doc.updatedAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          {doc.status === "pending_review" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openReview(doc.documentId)}
                            >
                              <Eye size={14} className="mr-1" />
                              Review
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setDeleteTarget(doc)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {docs.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        No documents yet — upload a PDF to get started.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      {/* Review drawer (v2) — wide to accommodate forced_side_by_side two-pane layout */}
      <Dialog
        open={reviewDoc !== null || reviewLoading}
        onOpenChange={(open) => { if (!open) closeReview(); }}
      >
        <DialogContent className="sm:max-w-[92vw] max-h-[90vh] flex flex-col" showCloseButton>
          <DialogHeader>
            <DialogTitle>{reviewDoc?.title ?? "Loading…"}</DialogTitle>
            {reviewDoc && (
              <p className="text-xs text-muted-foreground">
                {reviewDoc.pageCount != null
                  ? `${reviewDoc.pageCount} page${reviewDoc.pageCount !== 1 ? "s" : ""}`
                  : "Page count unknown"}
                {" · "}
                {/* null = never measured. Saying "Scanned" would assert a finding
                    the backend never made — unknown must read as unknown. */}
                {reviewDoc.digitalNative === null ? (
                  <span className="text-amber-600 dark:text-amber-400">
                    Parse quality unknown — not analysed
                  </span>
                ) : reviewDoc.digitalNative ? (
                  "Digital native"
                ) : (
                  "Scanned"
                )}
                {isForcedSBS && " · Side-by-side review required"}
              </p>
            )}
          </DialogHeader>

          {reviewLoading ? (
            <div className="flex flex-col gap-2 py-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-4" />)}
            </div>
          ) : reviewDoc ? (
            isForcedSBS ? (
              /* ── Forced side-by-side: two-pane ─────────────────────────── */
              <div className="flex flex-1 gap-4 overflow-hidden min-h-0">
                {/* Left pane: source PDF (authenticated blob) */}
                <div className="flex-1 min-w-0 flex flex-col gap-1 overflow-hidden">
                  <p className="text-xs font-medium text-muted-foreground shrink-0">Source PDF</p>
                  {pdfLoading ? (
                    <Skeleton className="flex-1" />
                  ) : pdfObjectUrl ? (
                    <iframe
                      src={pdfObjectUrl}
                      title="Source PDF"
                      className="flex-1 w-full h-full rounded border"
                    />
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground rounded border border-dashed">
                      PDF could not be loaded
                    </div>
                  )}
                </div>

                {/* Right pane: checkbox + conflicts + tables + text + source date */}
                <div className="flex-1 min-w-0 flex flex-col gap-4 overflow-auto">
                  {/* Required checkbox gate */}
                  <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-amber-300 bg-amber-50 p-3">
                    <input
                      type="checkbox"
                      checked={tablesReviewed}
                      onChange={(e) => setTablesReviewed(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-amber-600"
                      disabled={approving}
                    />
                    <span className="text-sm font-medium text-amber-900">
                      I{"'"}ve checked the tables against the source
                    </span>
                  </label>

                  {/* Conflict check didn't run — silence here is not a pass */}
                  {conflictGateInert && (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                      <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                        Numeric conflict check did not run
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        No marker dictionary is loaded, so this document was <strong>not</strong> checked
                        against existing values. An empty conflict list here means &ldquo;not
                        checked&rdquo;, not &ldquo;clean&rdquo; — verify any numbers yourself.
                      </p>
                    </div>
                  )}

                  {/* Numeric conflicts (prominent) */}
                  {conflicts.length > 0 && (
                    <div className="rounded-lg border border-red-300 bg-red-50 p-4 flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-red-800 font-medium text-sm">
                        <AlertTriangle size={16} />
                        {conflicts.length} numeric conflict{conflicts.length !== 1 ? "s" : ""} — review before approving
                      </div>
                      <ul className="flex flex-col gap-1.5">
                        {conflicts.map((c, i) => (
                          <li key={i} className="text-xs text-red-900">
                            <span className="font-mono font-medium">{c.marker}</span>: this document says{" "}
                            <strong>{c.newValue}</strong>, but the KB already has{" "}
                            <strong>{c.existingValue}</strong>{" "}
                            <span className="text-red-700">(from {c.existingSource})</span>
                          </li>
                        ))}
                      </ul>
                      <label className="flex items-start gap-2 cursor-pointer pt-1">
                        <input
                          type="checkbox"
                          checked={conflictsAck}
                          onChange={(e) => setConflictsAck(e.target.checked)}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-red-700"
                          disabled={approving}
                        />
                        <span className="text-xs font-medium text-red-900">
                          I{"'"}ve reviewed the {conflicts.length} conflict{conflicts.length !== 1 ? "s" : ""}
                        </span>
                      </label>
                    </div>
                  )}

                  {/* Extracted tables */}
                  {tables.length > 0 && (
                    <div className="flex flex-col gap-3">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Extracted tables ({tables.length})
                      </p>
                      {tables.map((t, i) => (
                        <div key={i} className="border rounded-lg p-3 flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Page {t.page}</span>
                            {t.confidence === "low" ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                                <AlertTriangle size={10} />
                                Low-confidence extraction — verify carefully
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                                OK
                              </span>
                            )}
                          </div>
                          <pre className="text-xs font-mono overflow-auto bg-muted/40 rounded p-2 whitespace-pre-wrap">
                            {t.markdown}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Parsed text */}
                  <div className="rounded-md border bg-muted/30 p-4">
                    <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">
                      {reviewDoc.parsedText}
                    </pre>
                  </div>

                  {/* Source date input */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-muted-foreground">Source date</label>
                    <Input
                      placeholder="e.g. Jan 2024 (leave blank if unknown)"
                      value={sourceDate}
                      onChange={(e) => setSourceDate(e.target.value)}
                      disabled={approving}
                    />
                  </div>
                </div>
              </div>
            ) : (
              /* ── Standard mode: single pane ─────────────────────────────── */
              <div className="flex-1 overflow-auto flex flex-col gap-4 min-h-0">
                {/* Conflict check didn't run — silence here is not a pass */}
                {conflictGateInert && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                    <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                      Numeric conflict check did not run
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      No marker dictionary is loaded, so this document was <strong>not</strong> checked
                      against existing values. An empty conflict list here means &ldquo;not
                      checked&rdquo;, not &ldquo;clean&rdquo; — verify any numbers yourself.
                    </p>
                  </div>
                )}

                {/* Numeric conflicts (prominent) */}
                {conflicts.length > 0 && (
                  <div className="rounded-lg border border-red-300 bg-red-50 p-4 flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-red-800 font-medium text-sm">
                      <AlertTriangle size={16} />
                      {conflicts.length} numeric conflict{conflicts.length !== 1 ? "s" : ""} — review before approving
                    </div>
                    <ul className="flex flex-col gap-1.5">
                      {conflicts.map((c, i) => (
                        <li key={i} className="text-xs text-red-900">
                          <span className="font-mono font-medium">{c.marker}</span>: this document says{" "}
                          <strong>{c.newValue}</strong>, but the KB already has{" "}
                          <strong>{c.existingValue}</strong>{" "}
                          <span className="text-red-700">(from {c.existingSource})</span>
                        </li>
                      ))}
                    </ul>
                    <label className="flex items-start gap-2 cursor-pointer pt-1">
                      <input
                        type="checkbox"
                        checked={conflictsAck}
                        onChange={(e) => setConflictsAck(e.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-red-700"
                        disabled={approving}
                      />
                      <span className="text-xs font-medium text-red-900">
                        I{"'"}ve reviewed the {conflicts.length} conflict{conflicts.length !== 1 ? "s" : ""}
                      </span>
                    </label>
                  </div>
                )}

                {/* Parsed text */}
                <div className="rounded-md border bg-muted/30 p-4">
                  <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">
                    {reviewDoc.parsedText}
                  </pre>
                </div>

                {/* Extracted tables */}
                {tables.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Extracted tables ({tables.length})
                    </p>
                    {tables.map((t, i) => (
                      <div key={i} className="border rounded-lg p-3 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Page {t.page}</span>
                          {t.confidence === "low" ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                              <AlertTriangle size={10} />
                              Low-confidence extraction — verify carefully
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                              OK
                            </span>
                          )}
                        </div>
                        <pre className="text-xs font-mono overflow-auto bg-muted/40 rounded p-2 whitespace-pre-wrap">
                          {t.markdown}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}

                {/* Source date input */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-muted-foreground">Source date</label>
                  <Input
                    placeholder="e.g. Jan 2024 (leave blank if unknown)"
                    value={sourceDate}
                    onChange={(e) => setSourceDate(e.target.value)}
                    disabled={approving}
                  />
                </div>
              </div>
            )
          ) : null}

          <DialogFooter showCloseButton>
            {reviewDoc && reviewDoc.status === "pending_review" && (
              <Button
                onClick={handleApprove}
                disabled={approving || (isForcedSBS && !tablesReviewed) || (conflicts.length > 0 && !conflictsAck)}
                title={
                  (isForcedSBS && !tablesReviewed)
                    ? "Check the box above to confirm you reviewed the tables"
                    : (conflicts.length > 0 && !conflictsAck)
                    ? "Acknowledge the numeric conflicts above before approving"
                    : undefined
                }
              >
                {approving ? (
                  <><Loader2 size={14} className="animate-spin mr-2" />Approving…</>
                ) : (
                  <><CheckCircle size={14} className="mr-2" />Approve</>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete document?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently remove{" "}
            <span className="font-medium text-foreground">{deleteTarget?.title}</span>{" "}
            from the knowledge base. This cannot be undone.
          </p>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? <><Loader2 size={14} className="animate-spin mr-2" />Deleting…</> : "Delete"}
            </Button>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
