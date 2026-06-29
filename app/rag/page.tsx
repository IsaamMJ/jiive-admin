"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2, Eye, CheckCircle, Upload } from "lucide-react";
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
import type {
  RagDocument,
  RagDocumentDetail,
  RagOverview,
  DocStatus,
} from "./types";

// Poll every 3s while any doc is queued/processing (safety net — uploads are mostly synchronous).
const POLL_MS = 3_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

function isInProgress(status: DocStatus): boolean {
  return status === "queued" || status === "processing";
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

export default function KnowledgeBasePage() {
  const [docs, setDocs] = useState<RagDocument[]>([]);
  const [overview, setOverview] = useState<RagOverview | null>(null);
  const [docsLoading, setDocsLoading] = useState(true);
  const [overviewLoading, setOverviewLoading] = useState(true);

  // Upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploading, setUploading] = useState(false);

  // Drag-and-drop
  const [dragOver, setDragOver] = useState(false);

  // Review drawer
  const [reviewDoc, setReviewDoc] = useState<RagDocumentDetail | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  // Token to detect stale review fetches (Bug A).
  const reviewReqRef = useRef(0);

  // Delete confirm dialog
  const [deleteTarget, setDeleteTarget] = useState<RagDocument | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Double-submit guards (Bug C).
  const uploadingRef = useRef(false);
  const approvingRef = useRef(false);
  const deletingRef = useRef(false);

  // Polling ref
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch docs list ──────────────────────────────────────────────────────

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

  // ── Polling: active when any doc is queued/processing ────────────────────

  const pollRef = useRef<() => void>(() => { /* set below */ });

  useEffect(() => {
    pollRef.current = () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollTimerRef.current = setTimeout(() => {
        if (document.hidden) { pollRef.current(); return; }
        fetchDocs().then((list) => {
          if (list.some((d) => isInProgress(d.status))) {
            pollRef.current();
          }
        });
      }, POLL_MS);
    };
  });

  const maybePoll = useCallback((list: RagDocument[]) => {
    if (list.some((d) => isInProgress(d.status))) {
      pollRef.current();
    }
  }, []);

  useEffect(() => {
    fetchDocs().then(maybePoll);
    fetchOverview();
    return () => { if (pollTimerRef.current) clearTimeout(pollTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Upload ───────────────────────────────────────────────────────────────

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
    if (!uploadTitle) setUploadTitle(file.name.replace(/\.pdf$/i, ""));
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
      await api.post("/rag/documents", form);
      toast.success("Document uploaded — awaiting review.");
      setUploadFile(null);
      setUploadTitle("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      const list = await fetchDocs();
      fetchOverview();
      maybePoll(list);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string; error?: string } } })
          ?.response?.data?.message ??
        (err as { response?: { data?: { error?: string } } })
          ?.response?.data?.error ??
        "Upload failed.";
      toast.error(msg);
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }

  // ── Drag-and-drop ────────────────────────────────────────────────────────

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

  // ── Review + Approve ─────────────────────────────────────────────────────

  async function openReview(doc: RagDocument) {
    const token = ++reviewReqRef.current;
    setReviewLoading(true);
    setReviewDoc(null);
    try {
      const r = await api.get<RagDocumentDetail>(`/rag/documents/${doc.documentId}`);
      if (reviewReqRef.current !== token) return; // dialog closed while in flight
      setReviewDoc(r.data);
    } catch {
      if (reviewReqRef.current === token) toast.error("Failed to load document detail.");
    } finally {
      if (reviewReqRef.current === token) setReviewLoading(false);
    }
  }

  async function handleApprove() {
    if (!reviewDoc) return;
    if (approvingRef.current) return;
    approvingRef.current = true;
    setApproving(true);
    try {
      await api.post(`/rag/documents/${reviewDoc.documentId}/approve`);
      toast.success("Document approved — now live in the knowledge base.");
      setReviewDoc(null);
      const list = await fetchDocs();
      fetchOverview();
      maybePoll(list);
    } catch {
      toast.error("Approval failed.");
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
      const list = await fetchDocs();
      fetchOverview();
      maybePoll(list);
    } catch {
      toast.error("Delete failed.");
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AdminLayout title="Knowledge Base">
      <div className="flex flex-col gap-6">

        {/* Coverage strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {overviewLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)
          ) : overview ? (
            <>
              <Card size="sm">
                <CardHeader><CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Total chunks</CardTitle></CardHeader>
                <CardContent><span className="text-2xl font-semibold">{overview.totalChunks.toLocaleString()}</span></CardContent>
              </Card>
              <Card size="sm">
                <CardHeader><CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Documents</CardTitle></CardHeader>
                <CardContent><span className="text-2xl font-semibold">{overview.documents.length}</span></CardContent>
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

        {/* Upload control */}
        <Card>
          <CardHeader><CardTitle>Upload document</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              {/* Drop zone */}
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

              {/* Title + upload button */}
              {uploadFile && (
                <div className="flex items-center gap-3">
                  <Input
                    placeholder="Document title (optional)"
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    className="flex-1"
                    disabled={uploading}
                  />
                  <Button onClick={handleUpload} disabled={uploading}>
                    {uploading ? <><Loader2 size={14} className="animate-spin mr-2" />Uploading…</> : "Upload"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={uploading}
                    onClick={() => {
                      setUploadFile(null);
                      setUploadTitle("");
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

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
                              onClick={() => openReview(doc)}
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

      {/* Review sheet (right-side drawer via Dialog with large width override) */}
      <Dialog open={reviewDoc !== null || reviewLoading} onOpenChange={(open) => { if (!open) { reviewReqRef.current++; setReviewLoading(false); setReviewDoc(null); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{reviewDoc?.title ?? "Loading…"}</DialogTitle>
            {reviewDoc && (
              <p className="text-xs text-muted-foreground">
                {reviewDoc.pageCount} page{reviewDoc.pageCount !== 1 ? "s" : ""} ·{" "}
                {reviewDoc.chunkCount} chunks · created{" "}
                {new Date(reviewDoc.createdAt).toLocaleString()}
              </p>
            )}
          </DialogHeader>

          {reviewLoading ? (
            <div className="flex flex-col gap-2 py-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-4" />)}
            </div>
          ) : reviewDoc ? (
            <div className="flex-1 overflow-auto rounded-md border bg-muted/30 p-4">
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">
                {reviewDoc.parsedText}
              </pre>
            </div>
          ) : null}

          <DialogFooter showCloseButton>
            {reviewDoc && reviewDoc.status === "pending_review" && (
              <Button onClick={handleApprove} disabled={approving}>
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
