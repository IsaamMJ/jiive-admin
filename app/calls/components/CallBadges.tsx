"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  DISPOSITION_LABEL,
  enumLabel,
  QUEUE_REASON_LABEL,
  type CallDisposition,
  type CallQueueReason,
} from "../types";

// The vocabulary is the server's, so a value we have no colour for is possible.
// Fall back to a neutral chip and a humanised label rather than an unstyled badge
// reading "undefined".
const NEUTRAL_CLASS = "bg-muted text-muted-foreground border-border";

/**
 * Why this person is queued. `incident` is red and stays red: these are people we
 * hurt, and the colour is the whole point of the pill — it is what makes the
 * caller ring them first without reading anything.
 */
const REASON_CLASS: Record<CallQueueReason, string> = {
  incident: "bg-red-500/20 text-red-400 border-red-500/30",
  first_time: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  low_csat: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  nth_repeat: "bg-muted text-muted-foreground border-border",
};

export function QueueReasonBadge({
  reason,
  className,
}: {
  reason: CallQueueReason;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("font-semibold", REASON_CLASS[reason] ?? NEUTRAL_CLASS, className)}
    >
      {enumLabel(QUEUE_REASON_LABEL, reason)}
    </Badge>
  );
}

const DISPOSITION_CLASS: Record<CallDisposition, string> = {
  connected: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  callback: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  no_answer: "bg-muted text-muted-foreground border-border",
  unreachable: "bg-muted text-muted-foreground border-border",
  refused: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  wrong_number: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  do_not_contact: "bg-red-500/20 text-red-400 border-red-500/30",
};

export function DispositionBadge({
  disposition,
  className,
}: {
  disposition: CallDisposition;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("text-xs font-medium", DISPOSITION_CLASS[disposition] ?? NEUTRAL_CLASS, className)}
    >
      {enumLabel(DISPOSITION_LABEL, disposition)}
    </Badge>
  );
}

/**
 * "Attempt 2 of 3". Amber on the last one — the next no-answer is the last time
 * we ever ring this person, and that should change how hard you try to reach them.
 */
export function AttemptBadge({
  attemptNumber,
  maxAttempts,
  className,
}: {
  attemptNumber: number;
  maxAttempts: number;
  className?: string;
}) {
  const last = attemptNumber >= maxAttempts;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums",
        last ? "border-amber-500/30 bg-amber-500/10 text-amber-400" : "border-border text-muted-foreground",
        className
      )}
    >
      Attempt {attemptNumber} of {maxAttempts}
      {last ? " · last" : ""}
    </span>
  );
}

/** A CSAT score as it appeared on a previous call. 1–3 reads as a problem. */
export function CsatChip({ csat, className }: { csat: number; className?: string }) {
  const good = csat >= 4;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums",
        good
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          : "border-red-500/30 bg-red-500/10 text-red-400",
        className
      )}
    >
      CSAT {csat}/5
    </span>
  );
}
