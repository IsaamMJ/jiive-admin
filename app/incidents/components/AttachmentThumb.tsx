"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchAttachmentBlob, incidentErrorMessage } from "../api";
import type { TimelineAttachment } from "../types";
import { formatDateTime } from "../lib/datetime";

/**
 * Attachment bytes come from an ADMIN-AUTHENTICATED endpoint (Round 2 R1), so an
 * <img src="…/incidents/attachments/:id"> cannot work: the browser will not put
 * the Authorization header on an image request and every thumbnail would 401 into
 * a broken-image icon.
 *
 * So: fetch the bytes through the axios client (which carries the bearer token),
 * wrap them in an object URL, and — critically — REVOKE that URL when the
 * component unmounts. Without the revoke, every render of a timeline with
 * screenshots on it leaks the full decoded image into the tab's memory for the
 * lifetime of the session.
 */
/**
 * The settled result is tagged with the id it belongs to, rather than being reset
 * to null at the top of the effect. Clearing it synchronously in the effect body
 * would cascade an extra render (and the React Compiler lint rejects it); tagging
 * lets "still loading" be *derived* — if the settled id isn't the one we're being
 * asked for, we haven't got it yet. That also makes a stale response from a
 * previous id impossible to render.
 */
type Settled = { id: string; url: string | null; error: string | null };

function useAttachmentUrl(attachmentId: string) {
  const [settled, setSettled] = useState<Settled>({ id: "", url: null, error: null });

  useEffect(() => {
    let cancelled = false;
    // Held in a local, not in state: the cleanup must be able to revoke the URL
    // even when the fetch resolves after unmount, and state would be gone by then.
    let objectUrl: string | null = null;

    fetchAttachmentBlob(attachmentId)
      .then((blob) => {
        if (cancelled) return; // Unmounted mid-flight: never create the URL at all.
        objectUrl = URL.createObjectURL(blob);
        setSettled({ id: attachmentId, url: objectUrl, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) setSettled({ id: attachmentId, url: null, error: incidentErrorMessage(err) });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachmentId]);

  const ready = settled.id === attachmentId;
  return {
    url: ready ? settled.url : null,
    error: ready ? settled.error : null,
    loading: !ready,
  };
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentThumb({ attachment }: { attachment: TimelineAttachment }) {
  const { url, error, loading } = useAttachmentUrl(attachment.id);
  const [open, setOpen] = useState(false);

  // A failed fetch must NOT look like a missing attachment. The evidence exists;
  // we just couldn't render it — and in a vendor dispute that difference matters.
  if (error) {
    return (
      <span
        title={error}
        className="inline-flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-red-500/40 bg-red-500/5 px-1 text-center"
      >
        <AlertTriangle size={14} className="text-red-400" />
        <span className="text-[9px] leading-tight text-red-400">Couldn&apos;t load</span>
      </span>
    );
  }

  if (loading) {
    return (
      <span className="inline-flex h-20 w-20 items-center justify-center rounded-lg border border-border bg-card/60">
        <Loader2 size={14} className="animate-spin text-muted-foreground" />
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={attachment.filename}
        className="group relative h-20 w-20 overflow-hidden rounded-lg border border-border transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a blob: object URL,
            not a remote asset; next/image cannot optimise or even accept it. */}
        <img
          src={url ?? ""}
          alt={attachment.filename}
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
        />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[92dvh] w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b border-border px-4 py-3">
            <DialogTitle className="truncate text-sm">{attachment.filename}</DialogTitle>
            <span className="text-xs text-muted-foreground">
              {[formatSize(attachment.sizeBytes), formatDateTime(attachment.createdAt)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </DialogHeader>

          <div className="flex flex-1 items-center justify-center overflow-auto bg-black/40 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- same blob: URL. */}
            <img
              src={url ?? ""}
              alt={attachment.filename}
              className="max-h-full max-w-full object-contain"
            />
          </div>

          <div className="flex justify-end border-t border-border px-4 py-3">
            {/* The download copies the bytes at click time, so it is safe against
                the object URL being revoked when this unmounts. */}
            <a
              href={url ?? ""}
              download={attachment.filename}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <Download size={14} className="mr-1.5" />
              Download
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
