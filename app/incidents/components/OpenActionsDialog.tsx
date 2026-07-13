"use client";

import Link from "next/link";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/InfoTip";
import { cn } from "@/lib/utils";
import { enumLabel, VENDOR_LABEL, type OpenActionItem } from "../types";
import { formatDate } from "../lib/datetime";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: OpenActionItem[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

/**
 * Every open action item across every incident, overdue first. This is the panel
 * that turns the log from a diary into an operating system — a postmortem whose
 * actions never complete is theatre.
 */
export function OpenActionsDialog({ open, onOpenChange, actions, loading, error, onRetry }: Props) {
  const sorted = [...actions].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="flex items-center gap-1.5">
            Open action items
            <InfoTip label="Across every incident, not just one. An action with no owner and no date never gets done, so both are required. A vendor commitment (“Thyrocare written RCA, due 16 Jul”) sits in this same list — with an internal owner whose job is to chase it." />
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
            </div>
          ) : error ? (
            <div className="flex flex-col items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3">
              <span className="text-sm text-red-400">{error}</span>
              <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>
            </div>
          ) : sorted.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No open action items. Nothing is owed by anyone.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {sorted.map((a) => (
                <div
                  key={a.id}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg border p-3",
                    a.overdue ? "border-red-500/40 bg-red-500/5" : "border-border bg-card/60"
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Link
                      href={`/incidents/${a.incidentId}`}
                      onClick={() => onOpenChange(false)}
                      className="font-mono font-semibold text-primary hover:underline"
                    >
                      {a.incidentRef}
                    </Link>
                    <span className="truncate text-muted-foreground">{a.incidentTitle}</span>
                  </div>
                  <span className="text-sm">{a.description}</span>
                  {/* Owed by the vendor, chased by one of us. The vendor is never
                      the owner — that is exactly how June 21's RCA went unwritten. */}
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    {a.ownerVendor && a.ownerVendor !== "none" && (
                      <span className="text-muted-foreground">
                        Owed by{" "}
                        <span className="font-medium text-foreground">
                          {enumLabel(VENDOR_LABEL, a.ownerVendor)}
                        </span>
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      Chased by <span className="font-medium text-foreground">{a.ownerLabel}</span>
                    </span>
                    <span className={cn(a.overdue ? "font-semibold text-red-400" : "text-muted-foreground")}>
                      Due {formatDate(a.dueDate)}
                      {a.overdue ? " · overdue" : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 rounded-none border-t px-4 py-3" showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
