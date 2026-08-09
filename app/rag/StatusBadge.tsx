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
 */
export function StatusBadge({
  status,
  failureReason,
}: {
  status: DocStatus;
  failureReason?: string;
}) {
  const variants: Record<DocStatus, { label: string; className: string }> = {
    ready: { label: "Ready", className: "border-green-200 bg-green-50 text-green-700" },
    pending_review: { label: "Pending review", className: "border-amber-200 bg-amber-50 text-amber-700" },
    failed: { label: "Failed", className: "border-red-200 bg-red-50 text-red-700" },
    queued: { label: "Queued", className: "border-border bg-muted text-muted-foreground" },
    processing: { label: "Processing", className: "border-border bg-muted text-muted-foreground" },
  };
  const { label, className } = variants[status] ?? {
    label: status,
    className: "border-border bg-muted text-muted-foreground",
  };
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
