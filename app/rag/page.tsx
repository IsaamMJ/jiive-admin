"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2, Eye, CheckCircle, Upload, AlertTriangle, Files, Bot } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { ConvertPanel } from "./ConvertPanel";
import { DiscoveredPanel } from "./DiscoveredPanel";
import { StatusBadge } from "./StatusBadge";
import {
  PARTITION_NOTE,
  PARTITION_UNAVAILABLE_NOTE,
  countDiscovered,
  fetchDiscovered,
  isSourceDateUnknown,
  partitionDocs,
  publisherDomain,
  readProvenance,
} from "./discovery";
import { DropStatusLine, DroppedContent } from "./DroppedContent";
import { NotCheckedPanel, type NotCheckedItem } from "./NotCheckedPanel";
import {
  NOT_CHECKED_CONFLICTS,
  NOT_CHECKED_DROPPED_ABSENT,
  NOT_CHECKED_DROPPED_MALFORMED,
  blocksApproval,
  describeDrop,
} from "./chunkPreview";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  DiscoveredDocument,
} from "./types";

// Poll every 3s while any doc is queued/processing. Uploads are ASYNC — the
// server returns `queued` and parses in the background (~60s for a PDF via
// LlamaParse), so this poll is how a row reaches pending_review, not a safety net.
const POLL_MS = 3_000;

/**
 * `GET /rag/documents` is a BARE ARRAY with a hard `take: LIST_CAP` of 500
 * (jiive-backend rag-document.service.ts:52 and :546). No total, no paging, no
 * signal that anything was dropped.
 *
 * So the old `{docs.length} total` was true right up until it mattered: at 500
 * documents it silently starts meaning "the 500 newest", and the one number on
 * the screen that describes the size of the knowledge base becomes wrong with
 * nothing to indicate it. The count is now labelled "loaded" — which is always
 * true — and the cap is called out when we are sitting on it.
 */
const DOCS_LIST_CAP = 500;

const DOCS_CAP_EXPLAINER =
  "The server returns at most 500 documents and doesn't say how many exist in total, so at exactly 500 we can't tell a full knowledge base from a truncated view of a bigger one. The number above is what loaded, never a total.";
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_BULK_FILES = 50;

// Client-side approximations of the server's paste-text gates (server validates
// against its own cleaned text — these just stop obvious mistakes early).
const MAX_PASTE_CHARS = 500_000;
const MIN_PASTE_CHARS = 200;
const MIN_PASTE_WORDS = 50;

/**
 * What upload() accepts. Markdown/text route through the markdown pipeline
 * (heading-aware chunking, real section citations) rather than the PDF text
 * extractor. Extension check only — the server still sniffs content, so a PDF
 * renamed .md is rejected there.
 */
const ACCEPTED_UPLOAD_EXTENSIONS = [".pdf", ".md", ".markdown", ".txt"] as const;
const UPLOAD_ACCEPT_ATTR = ACCEPTED_UPLOAD_EXTENSIONS.join(",");

function isAcceptedUpload(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ACCEPTED_UPLOAD_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isInProgress(status: DocStatus): boolean {
  return status === "queued" || status === "processing";
}

function isBatchInProgress(status: BatchDocStatus): boolean {
  return status === "uploaded" || status === "parsing";
}

// StatusBadge now lives in ./StatusBadge so the Discovered queue can render the
// same pill — a discovered document IS an ordinary pending_review document.

/**
 * The source-date box in the review drawer, shared by both review modes.
 *
 * Auto-discovered documents arrive with `sourceDate: "unknown"` — the backend
 * says so explicitly rather than inventing a date. The box is left BLANK in that
 * case (the word "unknown" sitting in a date field reads as a value), and the
 * fact is stated above it instead. Blank also means approve omits the field, so
 * the server's recorded "unknown" survives untouched.
 */
function SourceDateField({
  value,
  onChange,
  disabled,
  unknown,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  unknown: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        Source date
        <InfoTip label="When this guidance was published. Clinical advice goes out of date, so an undated document needs more scrutiny — not less." />
      </label>
      {unknown && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
          {/* Explicit {" "} — the compiler strips the literal space between an
              element and the text node that follows it. */}
          <strong>No publication date.</strong>{" "}
          The publisher didn&apos;t state one and the backend never guesses. Leave this blank unless
          you find a date inside the document — it stays recorded as unknown either way.
        </p>
      )}
      <Input
        placeholder="e.g. Jan 2024 (leave blank if unknown)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  );
}

/**
 * Where one document came from, in the main list.
 *
 * A document's provenance now travels with the row, so an operator scanning the
 * list can tell at a glance which rows a MACHINE found off the internet and
 * which a human chose to upload. That distinction is the difference between
 * "someone vetted this" and "nobody has ever read this", and it stops being
 * visible the moment a discovered row shares a table with an uploaded one —
 * which is exactly what happens on a server that doesn't stamp provenance.
 *
 * Three renders for three facts, and "unknown" is NOT folded into "uploaded":
 *   discovered → publisher domain (the real trust signal — `nice.org.uk` says
 *                more than 60 characters of URL) + the customer question.
 *   uploaded   → a quiet dash. The server checked and a human put it here.
 *   unknown    → an explicit "not recorded", never a dash. A blank cell would
 *                read as "a human uploaded it", which is the reassuring reading
 *                of a fact we do not have.
 *
 * Kept to one line — the Discovered tab remains the review surface.
 */
function ProvenanceCell({ doc }: { doc: RagDocument }) {
  const p = readProvenance(doc);

  if (p.kind === "unknown") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
        Not recorded
        <InfoTip label="This server doesn't say where the document came from, so we can't tell you whether a person chose it or a machine fetched it off the internet. Blank would have implied a person did." />
      </span>
    );
  }

  if (p.kind === "uploaded") {
    return <span className="text-[11px] text-muted-foreground">Uploaded</span>;
  }

  const domain = publisherDomain(p.sourceUrl);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-700 dark:text-amber-400">
        <Bot size={10} />
        Auto-found
      </span>
      {domain ? (
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-foreground">
          {domain}
        </span>
      ) : (
        // Unparseable or non-http(s). We will not name a publisher we can't read.
        <span className="text-amber-700 dark:text-amber-400">Publisher unreadable</span>
      )}
      <InfoTip
        label={
          p.query
            ? `A machine fetched this${p.via ? ` via ${p.via}` : ""} because customers asked about "${p.query}" and the knowledge base had no answer. Nobody chose it.`
            : `A machine fetched this${p.via ? ` via ${p.via}` : ""} off the internet. There is no record of which customer question triggered it. Nobody chose it.`
        }
      />
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

  // ── Discovered queue ──────────────────────────────────────────────────────
  // Documents the backend fetched by itself for questions customers asked that
  // the KB couldn't answer. Fetched here rather than inside DiscoveredPanel
  // because the main Documents list needs the id set to partition on, and one
  // request should serve both.
  const [discovered, setDiscovered] = useState<DiscoveredDocument[]>([]);
  const [discoveredLoading, setDiscoveredLoading] = useState(true);
  const [discoveredError, setDiscoveredError] = useState<string | null>(null);
  const [discoveredUnavailable, setDiscoveredUnavailable] = useState(false);
  const [listView, setListView] = useState<"documents" | "discovered">("documents");
  // Scroll target for the top-of-page "documents waiting" banner.
  const listSectionRef = useRef<HTMLDivElement>(null);

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
  // Dropped-content gate. `droppedExpanded` is lifted rather than kept inside
  // DroppedContent because the acknowledgement can't arm until the whole list
  // has been shown, so the approve button has to be able to see it.
  // ⚠️ Both MUST be reset in closeReview() and openReview() — a stale `true`
  // would silently unlock Approve on the next document.
  const [droppedAck, setDroppedAck] = useState(false);
  const [droppedExpanded, setDroppedExpanded] = useState(false);
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
    setDroppedAck(false);
    setDroppedExpanded(false);
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

  // Deliberately does NOT flip `discoveredLoading` on: the mount effect calls
  // this, and setting state synchronously in an effect body is a lint error here
  // (react-hooks/set-state-in-effect). The initial state is already `true`; the
  // manual Refresh path goes through `refreshDiscovered` below, which does show
  // the spinner.
  // Promise-chain style rather than async/await to match fetchDocs/fetchOverview
  // above — the effect-safety lint treats an awaited continuation as potentially
  // synchronous and flags the mount call otherwise.
  const loadDiscovered = useCallback(() => {
    return fetchDiscovered().then((outcome) => {
      // fetchDiscovered never throws — it returns the failure as a variant.
      if (outcome.kind === "ok") {
        setDiscovered(outcome.docs);
        setDiscoveredError(null);
        setDiscoveredUnavailable(false);
      } else if (outcome.kind === "unavailable") {
        // 404 — this backend predates the feature. An empty list PLUS the
        // "unavailable" flag is the truthful state; the panel renders it as a
        // capability gap rather than as an empty queue.
        setDiscovered([]);
        setDiscoveredError(null);
        setDiscoveredUnavailable(true);
      } else {
        setDiscovered([]);
        setDiscoveredError(outcome.message);
        setDiscoveredUnavailable(false);
      }
      setDiscoveredLoading(false);
    });
  }, []);

  /** Operator-triggered re-read — shows the spinner, unlike the mount load. */
  const refreshDiscovered = useCallback(() => {
    setDiscoveredLoading(true);
    loadDiscovered();
  }, [loadDiscovered]);

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
    loadDiscovered();
    return () => {
      if (batchPollTimerRef.current) clearTimeout(batchPollTimerRef.current);
      if (pdfObjectUrlRef.current) URL.revokeObjectURL(pdfObjectUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Single upload ─────────────────────────────────────────────────────────

  function handleFileSelect(file: File | null) {
    if (!file) return;
    if (!isAcceptedUpload(file.name)) {
      toast.error("Accepted: PDF, Markdown (.md/.markdown) or plain text (.txt).");
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
    // Strip any accepted extension, not just .pdf — otherwise a .md upload would
    // be titled "guidelines.md".
    if (!uploadTitleEdited) setUploadTitle(file.name.replace(/\.(pdf|md|markdown|txt)$/i, ""));
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
      // Upload is async now: the server returns `queued` immediately and parses
      // in the background (PDFs go through LlamaParse, ~60s). The generous
      // timeout is just headroom for the file transfer itself.
      await api.post("/rag/documents", form, { timeout: 180_000 });
      // Don't say "awaiting review" — it isn't ready to review yet. The list
      // polls every 3s and the row moves queued → processing → pending review.
      toast.success("Uploaded — parsing now. This takes about a minute; the row updates itself.");
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
    const selected = Array.from(files).filter((f) => isAcceptedUpload(f.name));
    if (selected.length < files.length) {
      toast.error(`${files.length - selected.length} unsupported file(s) ignored — PDF, .md, .markdown and .txt only.`);
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
    setDroppedAck(false);
    setDroppedExpanded(false);
    setSourceDate("");
    setPdfLoading(false);
    revokePdf();
    try {
      const r = await api.get<ReviewResponse>(`/rag/documents/${documentId}/review`);
      if (reviewReqRef.current !== token) return; // dialog closed while in flight
      setReviewDoc(r.data);
      // Auto-discovered documents come back with the LITERAL string "unknown"
      // here (verified on dev — every discovered row does). Prefilling a date
      // field with the word "unknown" reads as a value; leaving it blank reads as
      // what it is. Blank also means handleApprove omits `sourceDate` entirely,
      // so the server's own "unknown" is left untouched rather than overwritten.
      setSourceDate(isSourceDateUnknown(r.data.sourceDate) ? "" : r.data.sourceDate ?? "");
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
    // Dropped-content gate. Defence in depth on the same footing as the two
    // above — but note this one is CLIENT-ONLY: there is no
    // `dropped_not_acknowledged` server error code to mirror
    // `tables_not_reviewed` / `conflicts_not_acknowledged`, so this guards
    // against a stale render, not against a determined caller.
    if (droppedBlocking && !droppedAck) return;
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
      // Reconcile the preview against reality. `chunkPreview.chunkCount` was a
      // PREDICTION made before the chunks existed; `ApproveResponse.chunkCount`
      // is what was actually stored.
      //
      // ⚠️ An earlier comment here claimed these two always agreed in the wild
      // ("77/77 … 15/15 …"). That was read from previews, not from stored rows.
      // Re-checked against `GET /rag/documents` on 2026-08-10: PROD
      // `IJMR-148-522 (1)` stores 12 chunks and previews 15. So divergence is
      // not hypothetical, it is the live state of a production document — which
      // is exactly why this toast has to fire and why `describeDrop` now takes
      // the stored count before it will speak about the loss in the past tense.
      if (
        previewChunkCount !== null &&
        typeof r.data.chunkCount === "number" &&
        r.data.chunkCount !== previewChunkCount
      ) {
        toast.warning(
          `Approved, but ${r.data.chunkCount} chunks were stored where the preview said ${previewChunkCount}. What you reviewed is not exactly what was stored.`,
          { duration: 12_000 }
        );
      }
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
      // An approved discovered document leaves the queue — re-read it so the tab
      // count can't keep claiming something is still waiting for review.
      loadDiscovered();
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
      loadDiscovered();
    } catch {
      toast.error("Delete failed.");
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  /**
   * Partition the main list so uploaded and auto-discovered documents aren't
   * silently mixed.
   *
   * Read straight off the row now (`sourceUrl` / `discoveredVia`) — the old
   * id-Set-against-/rag/discovered workaround is deleted. See the provenance
   * block in discovery.ts for the dev/prod verification and for why the
   * "server doesn't mark provenance" case is a NAMED variant rather than a
   * silent fall-through to an unfiltered list.
   *
   * This no longer depends on the discovered fetch succeeding, and it no longer
   * misses a discovered document that sits outside the 500-row window.
   */
  const partition = partitionDocs(docs);
  const partitionAvailable = partition.available;
  const uploadedDocs = partition.uploaded;
  // How many rows the split moved out of the visible list. Counted from the same
  // array that is being rendered, so it can never describe rows we can't see —
  // `discovered.length` (the separate queue endpoint) is a different population.
  const hiddenDiscoveredCount = partition.discovered.length;

  /**
   * The rows the split moved out, shaped for the Discovered panel, used only if
   * `/rag/discovered` itself is down. Without this a discovered document would
   * be partitioned out of Documents and have nowhere to appear — see the
   * `fallbackDocs` comment in DiscoveredPanel.
   *
   * `sourceDate: null` is the truth here: `/rag/documents` doesn't carry one, so
   * the row renders "Publication date unknown", which describes what we know
   * rather than what the publisher said.
   */
  const discoveredFallback: DiscoveredDocument[] = partition.discovered.map((d) => {
    const p = readProvenance(d);
    return {
      documentId: d.documentId,
      title: d.title,
      status: d.status,
      sourceUrl: p.kind === "discovered" ? p.sourceUrl : "",
      sourceDate: null,
      discoveryQuery: p.kind === "discovered" ? p.query : null,
      chunkCount: d.chunkCount,
      updatedAt: d.updatedAt,
    };
  });

  /**
   * Awaiting / approved / not-ready across the discovered queue.
   *
   * Every aggregate about this queue reads from here. `discovered.length` is
   * the number of rows the endpoint returned, which includes documents approved
   * months ago — see countDiscovered for what that cost live on dev.
   *
   * Falls back to the partition when the queue endpoint is down, so the counts
   * describe the rows actually on screen rather than going silent.
   */
  const discoveredCounts = countDiscovered(
    discovered.length > 0 || !discoveredFallback.length ? discovered : discoveredFallback
  );

  const isForcedSBS = reviewDoc?.reviewMode === "forced_side_by_side";
  // The server told us it has no publication date for this document (literally
  // `"unknown"`, or absent). Surfaced in the drawer rather than swallowed.
  const reviewSourceDateUnknown = isSourceDateUnknown(reviewDoc?.sourceDate);
  // F1: defensive derived vars — null API fields must not white-screen the dialog
  const conflicts = reviewDoc?.numericConflicts ?? [];
  const tables = reviewDoc?.tables ?? [];
  // An empty conflict list is only reassuring if the check actually RAN. When the
  // gate is inert (no marker dictionary) `numericConflicts: []` means "not
  // checked" — showing nothing would read as "checked, clean".
  const conflictGateInert = reviewDoc?.conflictGate === "inert";

  /**
   * What approving this document will throw away. A NAMED verdict, never a
   * `?.length` at the render site — see chunkPreview.ts for why `dropped: []`
   * and `chunkPreview: undefined` must not be allowed to share a branch.
   */
  /**
   * What is ACTUALLY stored for this document, from the list row.
   *
   * `chunkPreview` is a dry run of the current chunker, re-executed when the
   * review is fetched — it is not a reading of the KB. Without this number the
   * dialog cannot tell "the preview describes the stored chunking" from "the
   * preview describes a chunking that never ran on this document", and it used
   * to assert the former unconditionally. On PROD `IJMR-148-522 (1)` that is 12
   * stored against 15 previewed, and the passage it named as missing is
   * retrievable from the live KB.
   *
   * Null when the row isn't in the current page of `docs` (batch review, or a
   * filtered list) — which `describeDrop` treats as "cannot confirm", not as a
   * match. Never fall back to `chunkPreview.chunkCount` here: that would
   * compare the preview against itself and always agree.
   */
  const storedChunkCount =
    docs.find((d) => d.documentId === reviewDoc?.documentId)?.chunkCount ?? null;

  const dropVerdict = describeDrop(reviewDoc, storedChunkCount);
  const droppedBlocking = blocksApproval(dropVerdict);
  /**
   * The chunk count the preview PREDICTED, or null when nothing was measured.
   * `-1` is the coercer's marker for "the field wasn't a usable number" and is
   * mapped back to null here so it can never be compared against a real count.
   */
  const previewChunkCount =
    dropVerdict.kind === "clear" || dropVerdict.kind === "unconfirmed_clear" || dropVerdict.kind === "loss"
      ? dropVerdict.chunkCount >= 0
        ? dropVerdict.chunkCount
        : null
      : null;

  /**
   * Checks that did not run, merged into ONE amber panel.
   *
   * `conflictGateInert` used to be its own card, duplicated in both review
   * modes. Adding chunk-preview-absent as a second card would put two amber
   * panels on every document a weaker backend serves — the fatigue trap. One
   * panel, one heading, one list.
   */
  const notCheckedItems: NotCheckedItem[] = [];
  if (conflictGateInert) {
    notCheckedItems.push({ name: "Numeric conflicts", meaning: NOT_CHECKED_CONFLICTS });
  }
  if (dropVerdict.kind === "unmeasured") {
    notCheckedItems.push({
      name: "Dropped content",
      meaning:
        dropVerdict.why === "absent" ? NOT_CHECKED_DROPPED_ABSENT : NOT_CHECKED_DROPPED_MALFORMED,
    });
  } else if (dropVerdict.kind === "preview_failed") {
    notCheckedItems.push({
      name: "Dropped content",
      // Server message verbatim — never a paraphrase (BUILD-CHECKLIST #5).
      meaning: `The server tried to preview chunking and it failed, so nothing was measured. Server said: ${dropVerdict.message}`,
    });
  }

  /**
   * Every unmet approve gate, not just the first.
   *
   * The old single `title` ternary named only the first blocker, which with
   * three possible gates reads as a moving target. These are rendered as
   * VISIBLE text under the button as well as in `title` — `title` does not
   * exist on touch, and BUILD-CHECKLIST #4 requires a disabled submit to show
   * why it is disabled.
   */
  const approveBlockers: string[] = [];
  if (isForcedSBS && !tablesReviewed) approveBlockers.push("confirm you checked the tables against the source");
  if (conflicts.length > 0 && !conflictsAck)
    approveBlockers.push(`acknowledge the ${conflicts.length} numeric conflict${conflicts.length !== 1 ? "s" : ""}`);
  if (droppedBlocking && !droppedAck) {
    const n = dropVerdict.kind === "loss" ? dropVerdict.fragments.length : 0;
    approveBlockers.push(`read the ${n} passage${n !== 1 ? "s" : ""} that won't be stored`);
  }

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

        {/* The Discovered queue sits below four upload cards — roughly 1,500px
            down on desktop and far further on a phone. A review queue nobody
            scrolls to is the same failure this feature exists to fix, so when
            something is actually waiting, say so at the top and jump to it.
            Rendered only when the count is KNOWN and non-zero: no banner is not
            a claim that the queue is empty. */}
        {/* Gated on `awaiting`, NOT on `discovered.length` — see countDiscovered.
            The endpoint keeps approved rows forever, so the old test made this
            banner permanent on dev and its "Nobody has read them yet" a standing
            falsehood about three documents that are live in the KB. */}
        {!discoveredLoading && !discoveredError && !discoveredUnavailable && discoveredCounts.awaiting > 0 && (
          <button
            type="button"
            onClick={() => {
              setListView("discovered");
              listSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="flex w-full items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
          >
            <AlertTriangle size={13} className="shrink-0" />
            <span>
              <strong>
                {discoveredCounts.awaiting} auto-discovered document
                {discoveredCounts.awaiting !== 1 ? "s" : ""} waiting for review
              </strong>{" "}
              — fetched from the internet for questions customers asked. Nobody has read{" "}
              {discoveredCounts.awaiting !== 1 ? "them" : "it"} yet.
            </span>
            <span className="ml-auto shrink-0 font-medium underline underline-offset-2">Review</span>
          </button>
        )}

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
              {/* PDF text is NOT junk-stripped — measured on a real journal PDF, the
                  running header reached 6 of 13 chunks, plus DOI, copyright, an email
                  and the whole reference list. Only paste → Convert is cleaned, so
                  say so here rather than let the quality gap stay invisible. */}
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                <strong>PDFs only:</strong> PDF text isn&apos;t cleaned — running headers, DOIs,
                copyright lines and the reference list end up in the chunks. Prefer{" "}
                <strong>Convert web content</strong> below (strips that furniture and checks every
                number against your source), or upload a <strong>.md</strong> file — Markdown and text
                go through the clean pipeline with real section citations.
              </p>

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
                <span className="text-xs opacity-70">PDF, Markdown or text · max 25 MB</span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={UPLOAD_ACCEPT_ATTR}
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
                  accept={UPLOAD_ACCEPT_ATTR}
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

              <p className="text-xs text-muted-foreground">PDF, .md, .markdown or .txt · up to {MAX_BULK_FILES} files per batch</p>
            </div>
          </CardContent>
        </Card>

        {/* Convert web content → verified Markdown → the normal review flow */}
        <ConvertPanel onIngested={() => { fetchDocs(); fetchOverview(); fetchVersion(); }} />

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

        {/* ── Lists: uploaded documents vs the discovered queue ──────────────
            Used as a segmented switch (the house pattern — see app/bookings),
            not as base-ui TabsContent panels: the upload cards above stay
            mounted, and a half-typed paste can't be discarded by a tab click. */}
        <div ref={listSectionRef} className="flex flex-col gap-3 scroll-mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tabs value={listView} onValueChange={(v) => setListView(v as "documents" | "discovered")}>
              <TabsList>
                <TabsTrigger value="documents">Documents</TabsTrigger>
                <TabsTrigger value="discovered">
                  Discovered
                  {/* The count is only rendered when it's known. A silent "0"
                      while loading — or after the fetch failed — would read as
                      "nothing is waiting", which is a claim we can't make. */}
                  {!discoveredLoading && !discoveredError && !discoveredUnavailable && (
                    /* Badges the AWAITING count, not the row count. An amber
                       badge is a call to action; on dev it read "3" for three
                       already-approved documents, permanently. Neutral grey
                       still shows the total so the tab isn't silent about
                       having contents. */
                    <span
                      className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                        discoveredCounts.awaiting > 0
                          ? "bg-amber-500/20 text-amber-700 dark:text-amber-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                      title={
                        discoveredCounts.awaiting > 0
                          ? `${discoveredCounts.awaiting} waiting for review`
                          : `${discovered.length} auto-discovered, none waiting for review`
                      }
                    >
                      {discoveredCounts.awaiting > 0 ? discoveredCounts.awaiting : discovered.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {listView === "documents" && (
              /* "loaded", not "total" — see DOCS_LIST_CAP. */
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                {uploadedDocs.length} loaded
                {docs.length >= DOCS_LIST_CAP && (
                  <>
                    <AlertTriangle size={12} className="text-amber-400" />
                    <InfoTip label={DOCS_CAP_EXPLAINER} />
                  </>
                )}
              </span>
            )}
          </div>

          {listView === "discovered" ? (
            <DiscoveredPanel
              docs={discovered}
              loading={discoveredLoading}
              error={discoveredError}
              unavailable={discoveredUnavailable}
              onReview={openReview}
              onRefresh={() => { refreshDiscovered(); fetchDocs(); }}
              fallbackDocs={discoveredFallback}
            />
          ) : (
          <>
          {/* The split is never silent: say what was moved out, or say plainly
              that the split could not be made. See the provenance block in
              discovery.ts. */}
          {!docsLoading && partitionAvailable && hiddenDiscoveredCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {hiddenDiscoveredCount} auto-discovered document
              {hiddenDiscoveredCount !== 1 ? "s are" : " is"} listed under{" "}
              <button
                type="button"
                onClick={() => setListView("discovered")}
                className="font-medium text-primary underline underline-offset-2 hover:no-underline"
              >
                Discovered
              </button>
              , not here. <InfoTip label={PARTITION_NOTE} />
            </p>
          )}
          {/* This server doesn't stamp provenance, so the list below is
              UNFILTERED and we say so rather than let it look filtered. */}
          {!docsLoading && !partitionAvailable && (
            <p className="inline-flex flex-wrap items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle size={12} className="shrink-0" />
              Uploaded and auto-discovered documents can&apos;t be told apart here.
              <InfoTip label={PARTITION_UNAVAILABLE_NOTE} />
            </p>
          )}

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
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Chunks</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uploadedDocs.map((doc) => (
                    <TableRow key={doc.documentId}>
                      <TableCell className="font-medium max-w-xs truncate">{doc.title}</TableCell>
                      <TableCell><ProvenanceCell doc={doc} /></TableCell>
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
                  {uploadedDocs.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        {/* "You haven't uploaded anything" ≠ "the knowledge base is
                            empty" once discovered documents have been split out. */}
                        {hiddenDiscoveredCount > 0
                          ? "Nothing uploaded by hand — every document here was auto-discovered. See the Discovered tab."
                          : "No documents yet — upload a PDF to get started."}
                      </TableCell>
                      {/* colSpan tracks the header — Source added a sixth column. */}
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          </>
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
              /* `flex-col md:flex-row` — a 50/50 split of a 375px viewport gave
                  neither the PDF nor the review pane a usable width. Below md the
                  panes stack, PDF first, each with its own height. */
              <div className="flex flex-1 flex-col gap-4 overflow-hidden min-h-0 md:flex-row">
                {/* Left pane: source PDF (authenticated blob) */}
                <div className="flex min-w-0 shrink-0 flex-col gap-1 overflow-hidden md:flex-1 md:shrink">
                  <p className="text-xs font-medium text-muted-foreground shrink-0">Source PDF</p>
                  {pdfLoading ? (
                    <Skeleton className="h-[45vh] md:h-auto md:flex-1" />
                  ) : pdfObjectUrl ? (
                    <iframe
                      src={pdfObjectUrl}
                      title="Source PDF"
                      className="h-[45vh] w-full rounded border md:h-auto md:flex-1"
                    />
                  ) : (
                    <div className="flex h-[45vh] items-center justify-center rounded border border-dashed text-sm text-muted-foreground md:h-auto md:flex-1">
                      PDF could not be loaded
                    </div>
                  )}
                </div>

                {/* Right pane: gates + conflicts + tables + text + source date.
                    ORDER IS DELIBERATE and identical in both review modes:
                      1. checks that did not run   (what we don't know)
                      2. dropped content           (what will be GONE)
                      3. numeric conflicts         (what may be WRONG)
                      4. tables-reviewed checkbox
                      5. tables · parsedText · source date
                    Dropped sits above conflicts because a wrong number is
                    visible in the text below and a missing one is not — gone is
                    the only failure the operator cannot detect by reading. */}
                <div className="flex flex-1 min-w-0 flex-col gap-4 overflow-auto">
                  {/* One panel for every check that didn't run — see NotCheckedPanel. */}
                  <NotCheckedPanel items={notCheckedItems} />

                  {/* ⚠️ What approving this will throw away. */}
                  <DroppedContent
                    // Fresh internal state (per-passage expansion, probe results)
                    // for every document — a probe result must never be shown
                    // against a different document's passage.
                    key={reviewDoc.documentId}
                    verdict={dropVerdict}
                    tableCount={tables.length}
                    ack={droppedAck}
                    onAck={setDroppedAck}
                    expanded={droppedExpanded}
                    onExpand={() => setDroppedExpanded(true)}
                    disabled={approving}
                  />

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

                  <SourceDateField
                    value={sourceDate}
                    onChange={setSourceDate}
                    disabled={approving}
                    unknown={reviewSourceDateUnknown}
                  />
                </div>
              </div>
            ) : (
              /* ── Standard mode: single pane ─────────────────────────────── */
              <div className="flex-1 overflow-auto flex flex-col gap-4 min-h-0">
                {/* Same order as the side-by-side pane above — see the comment
                    there. Both modes render the SAME two components, so the copy
                    cannot drift between them the way every other block in this
                    dialog has. */}
                <NotCheckedPanel items={notCheckedItems} />

                {/* ⚠️ What approving this will throw away. */}
                <DroppedContent
                  key={reviewDoc.documentId}
                  verdict={dropVerdict}
                  tableCount={tables.length}
                  ack={droppedAck}
                  onAck={setDroppedAck}
                  expanded={droppedExpanded}
                  onExpand={() => setDroppedExpanded(true)}
                  disabled={approving}
                />

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

                <SourceDateField
                  value={sourceDate}
                  onChange={setSourceDate}
                  disabled={approving}
                  unknown={reviewSourceDateUnknown}
                />
              </div>
            )
          ) : null}

          <DialogFooter showCloseButton>
            {reviewDoc && (
              /* ── The footer restatement ──────────────────────────────────
                  This line renders in EVERY drop state, including the ones the
                  inline block stays silent for. It is not dismissible, it
                  interrupts nothing, and it is on screen at the exact moment of
                  the decision no matter how far the operator has scrolled — the
                  answer to "the block was above the fold and they scrolled
                  past it". The inline content carries comprehension; this
                  guarantees the fact is present at the point of commit. */
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <DropStatusLine verdict={dropVerdict} />
                {reviewDoc.status === "pending_review" && (
                  <div className="flex flex-col items-stretch gap-1 sm:items-end">
                    <Button
                      onClick={handleApprove}
                      disabled={approving || approveBlockers.length > 0}
                      title={
                        approveBlockers.length > 0
                          ? `Before approving: ${approveBlockers.join("; ")}`
                          : undefined
                      }
                    >
                      {approving ? (
                        <><Loader2 size={14} className="animate-spin mr-2" />Approving…</>
                      ) : (
                        <><CheckCircle size={14} className="mr-2" />Approve</>
                      )}
                    </Button>
                    {/* Visible, not only in `title` — `title` doesn't exist on
                        touch, and a dead button with no stated reason is the
                        thing BUILD-CHECKLIST #4 forbids. Every unmet gate is
                        listed, not just the first. */}
                    {approveBlockers.length > 0 && (
                      <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground sm:text-right">
                        Before approving: {approveBlockers.join("; ")}.
                      </p>
                    )}
                  </div>
                )}
              </div>
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
