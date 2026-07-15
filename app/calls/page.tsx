"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, PhoneCall, RotateCw } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoTip } from "@/components/InfoTip";
import { cn } from "@/lib/utils";
import { getCallQueue, getCallStats, callErrorMessage } from "./api";
import {
  telHref,
  type CallQueueRow,
  type CallStats,
} from "./types";
import { QueueReasonBadge, AttemptBadge } from "./components/CallBadges";
import { CallStatsStrip } from "./components/CallStatsStrip";
import { PreviousCallsList } from "./components/PreviousCallsList";
import { LogCallDialog } from "./components/LogCallDialog";

/** Slot label — the wire sends an ISO date + a bare "HH:MM". Combine as local. */
function slotLabel(row: CallQueueRow): string {
  const date = (row.appointmentDate ?? "").slice(0, 10);
  const time = row.appointmentTime ?? "";
  return `${date}${time ? ` · ${time}` : ""}`.trim();
}

function whatTheyBooked(row: CallQueueRow): string {
  if (row.bookingCount > 1) {
    return `${row.bookingCount} tests${row.testTypes?.length ? ` (${row.testTypes.join(", ")})` : ""}`;
  }
  return row.testType || "—";
}

export default function CallsPage() {
  const [rows, setRows] = useState<CallQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [stats, setStats] = useState<CallStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [logRow, setLogRow] = useState<CallQueueRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getCallQueue()
      .then((r) => {
        // The server owns the ordering (priority ascending). We sort by it and
        // never re-rank — incident rows come first because the backend says so.
        const sorted = [...r.queue].sort((a, b) => a.priority - b.priority);
        setRows(sorted);
        setError(null);
      })
      .catch((e) => setError(callErrorMessage(e)))
      .finally(() => setLoading(false));
  }, []);

  const loadStats = useCallback(() => {
    setStatsLoading(true);
    getCallStats()
      .then((s) => { setStats(s); setStatsError(null); })
      .catch((e) => setStatsError(callErrorMessage(e)))
      .finally(() => setStatsLoading(false));
  }, []);

  const didLoad = useRef(false);
  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    load();
    loadStats();
  }, [load, loadStats]);

  // After a call is logged: a terminal disposition drops the row server-side, so
  // refetch both the queue and the stats rather than mutating locally.
  const onLogged = useCallback(() => {
    setLogRow(null);
    load();
    loadStats();
  }, [load, loadStats]);

  return (
    <AdminLayout title="Feedback calls">
      <div className="flex flex-col gap-5 pb-24 sm:pb-8">
        <CallStatsStrip stats={stats} loading={statsLoading} error={statsError} />

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Who to call next
            </h2>
            <InfoTip label="Sorted by priority: anyone we hurt (an incident) first, then first-time customers, then people who scored us low, then every fifth repeat customer. Everyone else isn't here on purpose — you can't call everyone, and this queue is the shortlist worth your time." />
          </div>
          <Button variant="outline" size="sm" onClick={() => { load(); loadStats(); }} disabled={loading}>
            <RotateCw size={14} className={cn("mr-1.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-border bg-card/60 p-8 text-center">
            <PhoneCall size={24} className="mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm font-medium">Nobody to call right now.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              People show up here after a completed booking, an incident, or a low score. Check back later.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {rows.map((row) => {
              const href = telHref(row.phone);
              const isOpen = expanded === row.bookingId;
              return (
                <li
                  key={row.bookingId}
                  className={cn(
                    "rounded-xl border bg-card/60 p-3.5 transition-colors sm:p-4",
                    row.queueReason === "incident"
                      ? "border-red-500/30"
                      : "border-border"
                  )}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{row.userName || row.patientName || "Unknown"}</span>
                        <QueueReasonBadge reason={row.queueReason} />
                        <AttemptBadge attemptNumber={row.attemptNumber} maxAttempts={row.maxAttempts} />
                        {row.callbackDue && (
                          <span className="rounded-md border border-sky-500/30 bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-medium text-sky-400">
                            Callback due
                          </span>
                        )}
                      </div>

                      <p className="mt-1 text-sm text-muted-foreground">
                        {whatTheyBooked(row)} · {slotLabel(row)}
                      </p>

                      {/* Incident — these are people we hurt. Show it loud. */}
                      {row.incident && (
                        <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                          <span className="font-semibold text-red-400">
                            {row.incident.ref ?? "Incident"}
                          </span>
                          {row.incident.title ? <span className="text-muted-foreground"> — {row.incident.title}</span> : null}
                        </div>
                      )}

                      {row.previousCalls.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : row.bookingId)}
                          className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:underline"
                        >
                          {isOpen ? "Hide" : "Show"} {row.previousCalls.length} previous call
                          {row.previousCalls.length > 1 ? "s" : ""}
                        </button>
                      )}
                      {isOpen && <div className="mt-2"><PreviousCallsList calls={row.previousCalls} /></div>}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {href ? (
                        <a href={href} className="inline-flex">
                          <Button variant="outline" size="sm" className="min-h-9">
                            <Phone size={14} className="mr-1.5" />
                            Call
                          </Button>
                        </a>
                      ) : (
                        <Button variant="outline" size="sm" disabled title="No usable phone number">
                          <Phone size={14} className="mr-1.5" />
                          No number
                        </Button>
                      )}
                      <Button size="sm" className="min-h-9" onClick={() => setLogRow(row)}>
                        Log call
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {logRow && (
        <LogCallDialog
          open={logRow !== null}
          onOpenChange={(o) => { if (!o) setLogRow(null); }}
          row={logRow}
          onLogged={onLogged}
        />
      )}
    </AdminLayout>
  );
}
