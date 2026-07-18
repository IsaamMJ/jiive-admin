"use client";

import { useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InfoTip } from "@/components/InfoTip";
import { draftIncident, incidentErrorMessage } from "../api";
import type { FilePrefill } from "./FileIncidentDialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the file-form prefill once the AI drafts (or once we fall back). */
  onReady: (prefill: FilePrefill) => void;
}

/**
 * The "Draft with AI" entry point: dump a paragraph, the AI drafts every
 * judgement field, and we hand a prefill to the file form for review. Laptop-first
 * — this is the "sit down and write it up" path, not the 8:50am phone path.
 *
 * The AI is an accelerator, never a blocker: on ANY failure (the endpoint 503s
 * when the model is down) we still open the file form with the raw paragraph
 * preserved in whatHappened, so filing is always one step away. Nothing here files
 * anything — the human always reviews and clicks File in the next dialog.
 */
export function DraftIncidentDialog({ open, onOpenChange, onReady }: Props) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  // Guards a double-click on Draft before the first request lands.
  const loadingRef = useRef(false);

  function reset() {
    setText("");
  }

  async function handleDraft() {
    const trimmed = text.trim();
    if (trimmed === "" || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const draft = await draftIncident(trimmed);
      onReady({
        // Prefer the AI's tidied narrative, but never lose the operator's words —
        // fall back to the raw text if the draft came back empty.
        whatHappened: draft.whatHappened || text,
        title: draft.title,
        severity: draft.severity,
        category: draft.category,
        vendor: draft.vendor,
        occurredAt: draft.occurredAt ?? undefined,
        orderIds: [],
      });
      reset();
      onOpenChange(false);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      toast.error(
        status === 503
          ? "AI couldn't draft this — fill it in manually."
          : incidentErrorMessage(err)
      );
      // Never block filing: open the manual form with the raw paragraph intact.
      onReady({ whatHappened: text });
      reset();
      onOpenChange(false);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (loading) return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92dvh] w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="flex items-center gap-1.5">
            <Sparkles size={16} className="text-primary" />
            Draft with AI
            <InfoTip label="Dump what happened in plain words — the AI drafts the title, severity, category and vendor for you to review and file. It never files anything itself, and it never picks order IDs; you do that in the next step." />
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4">
          <label htmlFor="draft-text" className="text-sm font-medium">
            What happened
          </label>
          <textarea
            id="draft-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={loading}
            rows={9}
            autoFocus
            placeholder="Paste or type what happened — the AI drafts the fields, you review and file. e.g. “Phlebo didn't show for the 7:20am slot in Andheri, customer had fasted 14 hours, Thyrocare's fault, order VL8E1FF6.”"
            className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-base leading-relaxed transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm dark:bg-input/30"
          />
          <span className="text-xs text-muted-foreground">
            The AI drafts the fields; you review, pick order IDs, and file. Nothing is filed until you do.
          </span>
        </div>

        <DialogFooter className="mx-0 mb-0 flex-col gap-2 rounded-none border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-end">
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => onOpenChange(false)}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button
            onClick={handleDraft}
            disabled={loading || text.trim() === ""}
            title={text.trim() === "" ? "Type what happened first." : undefined}
            className="flex-1 sm:flex-none"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="mr-2 animate-spin" />
                Drafting…
              </>
            ) : (
              <>
                <Sparkles size={14} className="mr-1.5" />
                Draft
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
