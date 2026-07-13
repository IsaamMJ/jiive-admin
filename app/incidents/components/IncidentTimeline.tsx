"use client";

import { useRef, useState } from "react";
import { Loader2, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoTip } from "@/components/InfoTip";
import { addTimelineEntry, fetchAttachmentBlob, incidentErrorMessage } from "../api";
import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  type IncidentDetail,
  type TimelineAttachment,
  type TimelineEntry,
} from "../types";
import { datetimeLocalToIso, formatDateTime, toDatetimeLocalValue } from "../lib/datetime";

/** Entries written more than a few minutes after the moment they describe were back-dated. */
const BACKDATE_THRESHOLD_MS = 5 * 60_000;

/**
 * Attachments are served from an admin-auth'd endpoint (Round 2 R1), so a bare
 * <a href> would 401. Fetch the bytes through the API client, then open the blob.
 */
function AttachmentLink({ attachment }: { attachment: TimelineAttachment }) {
  const [opening, setOpening] = useState(false);

  async function open() {
    if (opening) return;
    setOpening(true);
    try {
      const objectUrl = await fetchAttachmentBlob(attachment.url);
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      // The new tab holds its own reference; release ours once it has loaded.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (err: unknown) {
      toast.error(incidentErrorMessage(err));
    } finally {
      setOpening(false);
    }
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={opening}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
    >
      {opening ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />}
      {attachment.filename ?? "attachment"}
    </button>
  );
}

function Entry({ entry }: { entry: TimelineEntry }) {
  const backdated =
    new Date(entry.createdAt).getTime() - new Date(entry.at).getTime() > BACKDATE_THRESHOLD_MS;

  return (
    <li className="relative border-l border-border pb-4 pl-5 last:pb-0">
      <span className="absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full bg-border" />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium">{entry.admin?.name ?? "System"}</span>
        <span className="text-xs text-muted-foreground">{formatDateTime(entry.at)}</span>
        {backdated && (
          <span
            className="text-[10px] uppercase tracking-wide text-muted-foreground/70"
            title={`Written ${formatDateTime(entry.createdAt)}`}
          >
            back-dated
          </span>
        )}
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{entry.body}</p>
      {entry.attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {entry.attachments.map((a) => <AttachmentLink key={a.id} attachment={a} />)}
        </div>
      )}
    </li>
  );
}

interface Props {
  incident: IncidentDetail;
  onUpdated: (detail: IncidentDetail) => void;
}

export function IncidentTimeline({ incident, onUpdated }: Props) {
  const [body, setBody] = useState("");
  const [at, setAt] = useState(() => toDatetimeLocalValue(new Date()));
  // Computed on change, never during render — reading the clock while rendering
  // is impure, and the answer would depend on when React last re-rendered.
  const [atInFuture, setAtInFuture] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleAtChange(value: string) {
    setAt(value);
    const iso = datetimeLocalToIso(value);
    setAtInFuture(iso !== null && new Date(iso).getTime() > Date.now() + 60_000);
  }

  // Newest last: you read an incident forward, the way it happened.
  const entries = [...incident.timeline].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  );

  const atIso = datetimeLocalToIso(at);
  const disabledReason: string | null =
    body.trim() === ""
      ? "Write an update first."
      : atIso === null
      ? "Set a valid timestamp."
      : atInFuture
      ? "That timestamp is in the future."
      : null;

  function addImages(list: FileList | null) {
    if (!list || list.length === 0) return;
    const picked: File[] = [];
    for (const f of Array.from(list)) {
      // Allowlist, not "any image/*". SVG is excluded deliberately — the server
      // sniffs the bytes and rejects it too; this just fails fast and explains why.
      if (!(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(f.type)) {
        toast.error(`${f.name} — only PNG, JPEG and WebP are accepted (SVG is not, for security).`);
        continue;
      }
      if (f.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`${f.name} is over 5 MB — skipped.`);
        continue;
      }
      picked.push(f);
    }
    setImages((cur) => [...cur, ...picked]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleAdd() {
    if (disabledReason || !atIso) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const updated = await addTimelineEntry(incident.id, { body, at: atIso }, images);
      onUpdated(updated);
      setBody("");
      setImages([]);
      setAt(toDatetimeLocalValue(new Date()));
      setAtInFuture(false);
      toast.success("Update added.");
    } catch (err: unknown) {
      // Keep the text — never make someone retype a pasted thread after a blip.
      toast.error(incidentErrorMessage(err));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-base">
          Timeline
          <InfoTip label="Append-only: entries are never edited or deleted, which is exactly what makes this usable as evidence in a vendor conversation later. Capture updates as they happen and the RCA writes itself." />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing yet. Add what you know — including things that happened before you filed this.
          </p>
        ) : (
          <ul className="flex flex-col">
            {entries.map((e) => <Entry key={e.id} entry={e} />)}
          </ul>
        )}

        {/* Add-update box */}
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card/40 p-3">
          <textarea
            aria-label="Add an update"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={submitting}
            rows={4}
            placeholder="What happened next? Paste the thread, attach the screenshots…"
            className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-base leading-relaxed transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm dark:bg-input/30"
          />

          {images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {images.map((f, idx) => (
                <span
                  key={`${f.name}-${idx}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs"
                >
                  <Paperclip size={12} className="text-muted-foreground" />
                  <span className="max-w-40 truncate">{f.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    disabled={submitting}
                    onClick={() => setImages((cur) => cur.filter((_, i) => i !== idx))}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Happened at
              <InfoTip label="Back-date this to when it actually happened. People paste yesterday's thread today, and stamping it with now() would destroy the chronology that makes the timeline worth keeping." />
            </label>
            <Input
              type="datetime-local"
              aria-label="Timestamp of this update"
              value={at}
              onChange={(e) => handleAtChange(e.target.value)}
              disabled={submitting}
              className="w-full text-base sm:w-56 sm:text-sm"
            />

            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              hidden
              onChange={(e) => addImages(e.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={submitting}
              onClick={() => fileRef.current?.click()}
              className="min-h-9"
            >
              <Paperclip size={14} className="mr-1.5" />
              Attach images
            </Button>

            <div className="flex flex-1 items-center justify-end gap-2">
              {disabledReason && body !== "" && (
                <span className="text-xs text-muted-foreground">{disabledReason}</span>
              )}
              <Button
                onClick={handleAdd}
                disabled={submitting || disabledReason !== null}
                title={disabledReason ?? undefined}
                className="min-h-9"
              >
                {submitting ? (
                  <>
                    <Loader2 size={14} className="mr-2 animate-spin" />
                    Adding…
                  </>
                ) : (
                  "Add update"
                )}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
