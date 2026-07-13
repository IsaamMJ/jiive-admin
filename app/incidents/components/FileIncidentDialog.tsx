"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InfoTip } from "@/components/InfoTip";
import { cn } from "@/lib/utils";
import { fileIncident, incidentErrorMessage } from "../api";
import {
  SEVERITY_HINT,
  suggestVendor,
  VENDOR_SHORT_LABEL,
  type IncidentCategory,
  type IncidentSeverity,
  type IncidentSummary,
  type IncidentVendor,
} from "../types";
import { SEVERITY_EXPLAINER } from "./IncidentBadges";
import { datetimeLocalToIso, toDatetimeLocalValue } from "../lib/datetime";
import { useIncidentMeta } from "../lib/useIncidentMeta";

export interface FilePrefill {
  whatHappened?: string;
  severity?: IncidentSeverity;
  category?: IncidentCategory;
  orderIds?: string[];
  title?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: FilePrefill | null;
  onFiled?: (incident: IncidentSummary) => void;
}

const SEVERITY_TILE: Record<IncidentSeverity, string> = {
  S0: "data-[on=true]:border-sky-500 data-[on=true]:bg-sky-500/15 data-[on=true]:text-sky-300",
  S3: "data-[on=true]:border-amber-500 data-[on=true]:bg-amber-500/15 data-[on=true]:text-amber-300",
  S2: "data-[on=true]:border-orange-500 data-[on=true]:bg-orange-500/15 data-[on=true]:text-orange-300",
  S1: "data-[on=true]:border-red-500 data-[on=true]:bg-red-500/15 data-[on=true]:text-red-300",
};

/** "VL8E1FF6, VLB2CE67  VL1D9908" → ["VL8E1FF6","VLB2CE67","VL1D9908"], deduped. */
function parseOrderIds(raw: string): string[] {
  const seen = new Set<string>();
  for (const t of raw.split(/[\s,;]+/)) {
    const id = t.trim().toUpperCase();
    if (id) seen.add(id);
  }
  return [...seen];
}

function deriveTitle(whatHappened: string): string {
  const firstLine = whatHappened.trim().split("\n")[0]?.trim() ?? "";
  return firstLine.length > 90 ? `${firstLine.slice(0, 87)}…` : firstLine;
}

/**
 * The parent remounts this via a changing `key` each time it opens, so state
 * initialises fresh from `prefill` and there is no reset-on-open effect to keep
 * in sync. `occurredAt` defaults to now and is freely back-datable — people file
 * after the fire is out, and forcing now() would destroy the chronology.
 */
export function FileIncidentDialog({ open, onOpenChange, prefill, onFiled }: Props) {
  // Severity and category vocabularies come from the server. If that call fails we
  // fall back to the local constants and say so — a meta lookup must never be able
  // to take incident filing down with it.
  const { meta, degraded: metaDegraded } = useIncidentMeta();

  const [whatHappened, setWhatHappened] = useState(prefill?.whatHappened ?? "");
  const [title, setTitle] = useState(prefill?.title ?? "");
  const [titleTouched, setTitleTouched] = useState(Boolean(prefill?.title));
  const [severity, setSeverity] = useState<IncidentSeverity | null>(prefill?.severity ?? null);
  const [category, setCategory] = useState<IncidentCategory | null>(prefill?.category ?? null);
  const [orderIdsRaw, setOrderIdsRaw] = useState((prefill?.orderIds ?? []).join(", "));
  // Vendor is pre-selected from the category and only becomes "sticky" once the
  // operator actually touches it — so picking a category keeps re-suggesting,
  // but an explicit override is never silently overwritten.
  const [vendor, setVendor] = useState<IncidentVendor | null>(null);
  const [occurredAt, setOccurredAt] = useState(() => toDatetimeLocalValue(new Date()));
  // "Is this in the future?" is computed when the field changes, never during
  // render — reading the clock while rendering is impure and makes the output
  // depend on when React happened to re-render.
  const [occurredInFuture, setOccurredInFuture] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Guards a second submit fired before the first response lands (double-tap on
  // a phone is easy). The disabled state alone can't cover the in-flight window.
  const submittingRef = useRef(false);

  function handleOccurredChange(value: string) {
    setOccurredAt(value);
    const iso = datetimeLocalToIso(value);
    setOccurredInFuture(iso !== null && new Date(iso).getTime() > Date.now() + 60_000);
  }

  const orderIds = parseOrderIds(orderIdsRaw);
  const occurredIso = datetimeLocalToIso(occurredAt);
  // An untouched vendor tracks the category. This is the field the Thyrocare
  // scorecard is counted on, and the server defaults an unsent one to "none" —
  // so it is ALWAYS sent, and it is never left to the operator to remember.
  const effectiveVendor: IncidentVendor = vendor ?? suggestVendor(category);
  // Auto-suggest the title from the first line of the paste until the operator
  // touches the field themselves. One less thing to type at 8:50am.
  const effectiveTitle = titleTouched ? title : deriveTitle(whatHappened);

  const disabledReason: string | null =
    whatHappened.trim() === ""
      ? "Describe what happened."
      : effectiveTitle.trim() === ""
      ? "Add a one-line title."
      : severity === null
      ? "Pick a severity."
      : category === null
      ? "Pick a category."
      : occurredIso === null
      ? "Set when it happened."
      : occurredInFuture
      ? "That time is in the future — file it after it happens."
      : orderIds.length === 0
      ? "Add at least one order ID."
      : null;

  async function handleSubmit() {
    if (disabledReason || !severity || !category || !occurredIso) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const incident = await fileIncident({
        title: effectiveTitle.trim(),
        severity,
        category,
        occurredAt: occurredIso,
        whatHappened,
        // `orderIds` on the way in, `affectedOrderIds` on the way back out. The
        // asymmetry is the live contract, not a typo.
        orderIds,
        vendor: effectiveVendor,
      });
      toast.success(`${incident.ref} filed.`);
      onFiled?.(incident);
      onOpenChange(false);
    } catch (err: unknown) {
      // Keep the dialog open and every field intact — a network blip must never
      // cost someone the WhatsApp thread they just pasted.
      toast.error(incidentErrorMessage(err));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitting) onOpenChange(o); }}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92dvh] w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="flex items-center gap-1.5">
            File an incident
            <InfoTip label="Six fields, under a minute. Everything else can be filled in later from a laptop. A log that captures everything with six fields beats a thorough one that captures a third." />
          </DialogTitle>
        </DialogHeader>

        {/* Scrolls; the submit bar below stays pinned within thumb reach. */}
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
          {/* 1 — What happened. First, because pasting is the first thing they do. */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="inc-what" className="flex items-center gap-1.5 text-sm font-medium">
              What happened
              <InfoTip label="Paste the WhatsApp thread straight in. Raw and messy beats tidy and late — this is the evidence, not a report." />
            </label>
            <textarea
              id="inc-what"
              value={whatHappened}
              onChange={(e) => setWhatHappened(e.target.value)}
              disabled={submitting}
              rows={7}
              placeholder="Paste the WhatsApp thread, or just type what went wrong…"
              className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-base leading-relaxed transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm dark:bg-input/30"
            />
          </div>

          {/* 2 — Title (auto-suggested from the paste). */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="inc-title" className="text-sm font-medium">
              One-line title
            </label>
            <Input
              id="inc-title"
              value={effectiveTitle}
              onChange={(e) => { setTitleTouched(true); setTitle(e.target.value); }}
              disabled={submitting}
              placeholder="Phlebo no-show, customer fasted 14h"
              className="text-base sm:text-sm"
            />
            {!titleTouched && effectiveTitle !== "" && (
              <span className="text-xs text-muted-foreground">
                Taken from the first line above — edit it if you like.
              </span>
            )}
          </div>

          {/* 3 — Severity: four big tap targets. */}
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              Severity
              <InfoTip label={SEVERITY_EXPLAINER} />
            </span>
            <div className="grid grid-cols-2 gap-2">
              {meta.severities.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  data-on={severity === s.value}
                  aria-pressed={severity === s.value}
                  disabled={submitting}
                  onClick={() => setSeverity(s.value)}
                  className={cn(
                    "flex min-h-16 flex-col items-start justify-center gap-0.5 rounded-xl border border-border bg-card px-3 py-2 text-left transition-colors",
                    "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                    SEVERITY_TILE[s.value] ?? "data-[on=true]:border-primary data-[on=true]:bg-primary/15"
                  )}
                >
                  <span className="text-sm font-semibold">
                    {s.value} · {s.label}
                  </span>
                  <span className="text-[11px] leading-tight text-muted-foreground">
                    {SEVERITY_HINT[s.value] ?? ""}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 4 — Category chips. */}
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              Category
              <InfoTip label="A fixed list, on purpose. This is the field that makes “how many phlebo no-shows did Thyrocare have this quarter?” a single query. Free-text tags would never add up." />
            </span>
            <div className="flex flex-wrap gap-1.5">
              {meta.categories.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  aria-pressed={category === c.value}
                  disabled={submitting}
                  onClick={() => setCategory(c.value)}
                  className={cn(
                    "min-h-9 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                    category === c.value
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent"
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {metaDegraded && (
              <span className="text-xs text-muted-foreground">
                Couldn{"'"}t reach the server{"'"}s category list — showing the built-in one. Filing still works.
              </span>
            )}
          </div>

          {/* Vendor — pre-selected from the category, one tap to override.
              Never a required decision, but ALWAYS sent. */}
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              Who does this land on?
              <InfoTip label="This is what makes the Thyrocare scorecard countable — if it's wrong, the vendor numbers are wrong. We pre-select it from the category; change it if we guessed wrong." />
            </span>
            <div className="flex gap-1.5">
              {(["thyrocare", "internal", "none"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={effectiveVendor === v}
                  disabled={submitting}
                  onClick={() => setVendor(v)}
                  className={cn(
                    "min-h-10 flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                    effectiveVendor === v
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent"
                  )}
                >
                  {VENDOR_SHORT_LABEL[v]}
                </button>
              ))}
            </div>
            {vendor === null && category !== null && (
              <span className="text-xs text-muted-foreground">
                Suggested from the category — tap to change it.
              </span>
            )}
          </div>

          {/* 5 — When it happened. Defaults to now, back-datable. */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="inc-when" className="flex items-center gap-1.5 text-sm font-medium">
              When it happened
              <InfoTip label="Defaults to now, but set it back to when it actually hit the customer. The gap between that and when you filed is our detection latency — it only means something if this is honest." />
            </label>
            <Input
              id="inc-when"
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => handleOccurredChange(e.target.value)}
              disabled={submitting}
              className="text-base sm:text-sm"
            />
          </div>

          {/* 6 — Order IDs (multiple). */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="inc-orders" className="flex items-center gap-1.5 text-sm font-medium">
              Order IDs
              <InfoTip label="One ID is enough — the server expands it into the customer, the slot, the phlebo's name and phone, the address, and every other order paid for in the same batch. Add more if several orders are involved." />
            </label>
            <Input
              id="inc-orders"
              value={orderIdsRaw}
              onChange={(e) => setOrderIdsRaw(e.target.value)}
              disabled={submitting}
              placeholder="VL8E1FF6, VLB2CE67"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="font-mono text-base sm:text-sm"
            />
            {orderIds.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {orderIds.length} order{orderIds.length !== 1 ? "s" : ""}:{" "}
                <span className="font-mono">
                  {orderIds.slice(0, 6).join(", ")}
                  {orderIds.length > 6 ? ` +${orderIds.length - 6} more` : ""}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Pinned submit bar — reachable with a thumb at any scroll position. */}
        <DialogFooter className="mx-0 mb-0 flex-col gap-2 rounded-none border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="order-2 text-xs text-muted-foreground sm:order-1">
            {disabledReason ?? "Ready to file."}
          </span>
          <div className="order-1 flex gap-2 sm:order-2">
            <Button
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
              className="flex-1 sm:flex-none"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || disabledReason !== null}
              title={disabledReason ?? undefined}
              className="h-11 flex-1 text-base sm:h-9 sm:flex-none sm:text-sm"
            >
              {submitting ? (
                <>
                  <Loader2 size={14} className="mr-2 animate-spin" />
                  Filing…
                </>
              ) : (
                "File incident"
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
