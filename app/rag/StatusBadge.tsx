"use client";

import { Loader2 } from "lucide-react";
import type { DocStatus } from "./types";

/**
 * Document status pill. Extracted from page.tsx so the Discovered queue renders
 * status identically to the main Documents list — a discovered document IS an
 * ordinary `pending_review` document, and two different-looking badges for the
 * same state would imply a distinction the backend does not make.
 *
 * The `?? { label: status }` fallback is load-bearing: an unrecognised status
 * shows its raw value in a neutral pill rather than being coerced into one of
 * the known states.
 *
 * ⚠️ `ready` IS LABELLED "Live", NOT "Ready".
 *
 * `ready` is the state a document reaches AFTER a human approves it — chunks are
 * created by the approve step, so the pill means "chunked, embedded and being
 * served to customers". On a screen whose other pill says "Pending review", the
 * word "Ready" reads as *ready for you to review*, which is the exact opposite.
 * That misreading was doing real damage in the Discovered queue: ten approved,
 * live documents sat under a green pill that an operator scanned as a to-do
 * list. "Live" cannot be read as an invitation to act.
 */
export function StatusBadge({
  status,
  failureReason,
}: {
  status: DocStatus;
  failureReason?: string;
}) {
  const variants: Record<DocStatus, { label: string; title?: string; className: string }> = {
    ready: {
      label: "Live",
      title: "Approved — chunked, embedded, and searchable by customers.",
      className: "border-green-200 bg-green-50 text-green-700",
    },
    pending_review: {
      label: "Pending review",
      title: "Nobody has approved this yet. It is not in the knowledge base and customers cannot see it.",
      className: "border-amber-200 bg-amber-50 text-amber-700",
    },
    failed: { label: "Failed", className: "border-red-200 bg-red-50 text-red-700" },
    queued: { label: "Queued", className: "border-border bg-muted text-muted-foreground" },
    processing: { label: "Processing", className: "border-border bg-muted text-muted-foreground" },
  };
  const { label, title, className } = variants[status] ?? {
    label: status,
    className: "border-border bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}
      title={status === "failed" && failureReason ? failureReason : title}
    >
      {status === "processing" && <Loader2 size={10} className="animate-spin" />}
      {label}
      {status === "failed" && failureReason && (
        <span className="ml-1 text-[10px] opacity-80">— {failureReason}</span>
      )}
    </span>
  );
}
