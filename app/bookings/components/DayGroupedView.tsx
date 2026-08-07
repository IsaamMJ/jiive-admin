"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Loader2,
  ChevronDown,
  ChevronUp,
  CalendarDays,
  CheckCircle2,
  Clock4,
  XCircle,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoTip } from "@/components/InfoTip";
import { DaySection } from "./DaySection";
import { groupByDay } from "../lib/groupByDay";
import { localDateNDaysFrom } from "../lib/dayLabels";
import { bookingsCoverageNote, fetchAllBookings } from "../lib/fetchAllBookings";
import type { DayBucket } from "../lib/types";
import { cn } from "@/lib/utils";

const WINDOW_DAYS = 7;

/**
 * One 7-day window, plus whether we actually read all of it.
 *
 * This used to be a bare DayBucket[] fetched with `limit=500`, which the server
 * clamps to 200 in silence (admin.controller.ts:2032) — so a busy week rendered a
 * partial day list AND fed partial numbers to the tiles above it, with nothing on
 * screen to say so. `fetchAllBookings` pages to completeness; `incomplete` is what
 * survives when even that comes up short.
 */
interface DayWindow {
  buckets: DayBucket[];
  /** Non-null = we could NOT read the whole window. The text says what's missing. */
  incomplete: string | null;
}

function todayLocal(): string {
  return localDateNDaysFrom(new Date(), 0);
}

/** "7 Aug" — no year; these ranges are always within a couple of weeks of now. */
function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function StatTile({
  icon: Icon,
  label,
  value,
  accent,
  scope,
  subline,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: number;
  accent: string;
  /** The date range this number covers. NOT optional — see the stats comment. */
  scope: string;
  subline?: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm flex-1 min-w-0">
      <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", accent)}>
        <Icon size={16} />
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
          {label}
        </span>
        <span className="text-xl font-bold tabular-nums leading-tight">{value}</span>
        {/* The scope rides ON the tile, not only in a caption, because the number
            is meaningless without it — see the stats comment for the live
            0/0/0/0-vs-19-completed contradiction that made this mandatory. */}
        <span className="text-[10px] text-muted-foreground/80 truncate mt-0.5">{scope}</span>
        {subline && (
          <span className="text-[10px] text-muted-foreground/80 truncate">{subline}</span>
        )}
      </div>
    </div>
  );
}

export function DayGroupedView() {
  const [today] = useState<string>(todayLocal);
  // Future windows: index 0 = today..today+6, index 1 = today+7..today+13, ...
  const [futureWindows, setFutureWindows] = useState<DayWindow[]>([]);
  // Past windows: index 0 = today-7..today-1, index 1 = today-14..today-8, ...
  const [pastWindows, setPastWindows] = useState<DayWindow[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingPast, setLoadingPast] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Direction: +1 means future (offset = futureIdx*7..+6), -1 means past (offset = -((pastIdx+1)*7)..-(pastIdx*7+1))
  const fetchWindow = useCallback(
    async (direction: 1 | -1, index: number): Promise<DayWindow> => {
      const base = new Date(`${today}T00:00:00`);
      const startOffset =
        direction === 1 ? index * WINDOW_DAYS : -((index + 1) * WINDOW_DAYS);
      const from = localDateNDaysFrom(base, startOffset);
      const to = localDateNDaysFrom(base, startOffset + WINDOW_DAYS - 1);
      // No `limit` here on purpose — the pager owns it, and it is pinned at the
      // server's real ceiling of 200 (admin.controller.ts:2032). Passing a bigger
      // number was the bug.
      const r = await fetchAllBookings({ appointmentFrom: from, appointmentTo: to });
      return {
        buckets: groupByDay(r.bookings, from, WINDOW_DAYS),
        incomplete: bookingsCoverageNote(r),
      };
    },
    [today]
  );

  useEffect(() => {
    let cancelled = false;
    setLoadingInitial(true);
    fetchWindow(1, 0)
      .then((w) => { if (!cancelled) setFutureWindows([w]); })
      .catch((e) => { if (!cancelled) setError(e?.message ?? "Failed to load"); })
      .finally(() => { if (!cancelled) setLoadingInitial(false); });
    return () => { cancelled = true; };
  }, [fetchWindow]);

  const loadMoreFuture = async () => {
    setLoadingMore(true);
    try {
      const next = await fetchWindow(1, futureWindows.length);
      setFutureWindows((w) => [...w, next]);
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to load");
    } finally {
      setLoadingMore(false);
    }
  };

  const loadMorePast = async () => {
    setLoadingPast(true);
    try {
      const prev = await fetchWindow(-1, pastWindows.length);
      setPastWindows((w) => [...w, prev]);
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to load");
    } finally {
      setLoadingPast(false);
    }
  };

  // Render order: oldest past window first → newest past → future windows in order.
  // pastWindows[0] is the most recent past block (today-7..today-1), so we reverse.
  const allBuckets = useMemo(() => {
    const past = [...pastWindows].reverse().flatMap((w) => w.buckets); // oldest → newest
    return [...past, ...futureWindows.flatMap((w) => w.buckets)];
  }, [pastWindows, futureWindows]);

  // Every window that came back short, in render order. If ANY of these is set,
  // the day list below is missing rows and the tiles above are undercounts.
  const coverageGaps = useMemo(() => {
    const all = [...[...pastWindows].reverse(), ...futureWindows];
    return all.map((w) => w.incomplete).filter((n): n is string => n !== null);
  }, [pastWindows, futureWindows]);

  // The forward window the tiles actually cover: today .. today + 7n - 1, where n
  // grows every time the operator presses "Load next 7 days".
  const statsRange = useMemo(() => {
    const days = Math.max(1, futureWindows.length) * WINDOW_DAYS;
    const to = localDateNDaysFrom(new Date(`${today}T00:00:00`), days - 1);
    return { from: today, to, label: `${shortDate(today)} – ${shortDate(to)}` };
  }, [today, futureWindows.length]);

  // ── The four tiles ─────────────────────────────────────────────────────────
  //
  // These count today + the FORWARD windows only (`futureWindows`), deliberately
  // excluding any past week the operator loads, so pressing "Load previous" can't
  // double-count. Two consequences that MUST be stated on screen, not left for the
  // reader to work out:
  //
  //  1. They are not all-time. Live prod on 2026-08-07 rendered 0 / 0 / 0 / 0 here
  //     while GET /dashboard reported 19 completed and 4 cancelled — the same word
  //     "Completed" against contradictory numbers, with neither side saying what it
  //     covered. Nothing was wrong with either figure; the tiles cover a week with
  //     no bookings in it, and /dashboard covers all time.
  //  2. They GROW with the button. "Load next 7 days" widens the range these count,
  //     so the same tile legitimately shows a different number depending on how
  //     many times it was pressed. That is only honest if the range is on the tile,
  //     which is why StatTile.scope is required rather than optional.
  //
  // Making them all-time instead would be the wrong fix — it would contradict the
  // day list they sit directly above.
  const stats = useMemo(() => {
    const todayBookings = allBuckets.find((b) => b.date === today)?.bookings ?? [];
    const futureOnly = futureWindows.flatMap((w) => w.buckets).flatMap((b) => b.bookings);
    const upcomingActive = futureOnly.filter((b) =>
      ["pending_payment", "confirmed", "phlebo_assigned", "payment_completed", "booking_confirmed"].includes(b.status)
    );
    const completed = futureOnly.filter((b) => b.status === "completed").length;
    const cancelledList = futureOnly.filter((b) => b.status === "cancelled" || b.status === "failed");
    const cancelledByUser = cancelledList.filter((b) => b.cancelledBy === "user").length;
    const cancelledByLab = cancelledList.filter((b) => b.cancelledBy === "thyrocare").length;
    const cancelledByAdmin = cancelledList.filter(
      (b) => typeof b.cancelledBy === "string" && b.cancelledBy.startsWith("admin")
    ).length;
    return {
      today: todayBookings.length,
      upcoming: upcomingActive.length,
      completed,
      cancelled: cancelledList.length,
      cancelledByUser,
      cancelledByLab,
      cancelledByAdmin,
    };
  }, [allBuckets, futureWindows, today]);

  const cancelSubline = (() => {
    if (stats.cancelled === 0) return undefined;
    const parts: string[] = [];
    if (stats.cancelledByUser) parts.push(`${stats.cancelledByUser}u`);
    if (stats.cancelledByLab) parts.push(`${stats.cancelledByLab}l`);
    if (stats.cancelledByAdmin) parts.push(`${stats.cancelledByAdmin}a`);
    const unknown = stats.cancelled - stats.cancelledByUser - stats.cancelledByLab - stats.cancelledByAdmin;
    if (unknown > 0) parts.push(`${unknown}?`);
    return parts.join(" · ");
  })();

  if (loadingInitial) {
    return (
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/60 overflow-hidden">
            <Skeleton className="h-16 w-full rounded-none" />
            <div className="p-4 flex flex-col gap-2">
              {Array.from({ length: 2 }).map((_, j) => <Skeleton key={j} className="h-12" />)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Stats strip. The scope caption is part of the strip, not decoration —
          these numbers are a claim about a date range and are wrong without it. */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>
            Counting{" "}
            <span className="font-medium text-foreground">{statsRange.label}</span>
            {" "}— today onwards only
          </span>
          <InfoTip label="These four count the forward days loaded on this page, starting today. Loading previous days does not add to them, and loading more future days widens the range. They are NOT all-time totals, so they will not match the Dashboard's counts — that page covers every booking ever made." />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile
            icon={CalendarDays}
            label="Today"
            value={stats.today}
            accent="bg-primary/15 text-primary"
            scope={shortDate(today)}
          />
          <StatTile
            icon={Clock4}
            label="Upcoming"
            value={stats.upcoming}
            accent="bg-amber-500/15 text-amber-400"
            scope={statsRange.label}
          />
          <StatTile
            icon={CheckCircle2}
            label="Completed"
            value={stats.completed}
            accent="bg-emerald-500/15 text-emerald-400"
            scope={statsRange.label}
          />
          <StatTile
            icon={XCircle}
            label="Cancelled"
            value={stats.cancelled}
            accent="bg-rose-500/15 text-rose-400"
            scope={statsRange.label}
            subline={cancelSubline}
          />
        </div>
      </div>

      {/* A window that came back short makes BOTH the tiles and the day list below
          undercounts. Say it once, at the top, where the numbers are. */}
      {coverageGaps.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
          <div className="flex flex-col gap-1 text-xs text-amber-300">
            <span className="font-medium">
              Some days are missing bookings — the counts above and the list below are
              lower than the truth.
            </span>
            {coverageGaps.map((note, i) => (
              <span key={i} className="text-amber-300/80">{note}</span>
            ))}
          </div>
        </div>
      )}

      {/* Load previous */}
      <div className="flex justify-center">
        <Button
          variant="outline"
          size="sm"
          onClick={loadMorePast}
          disabled={loadingPast}
          className="gap-2 rounded-full px-5"
        >
          {loadingPast ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Loading previous 7 days
            </>
          ) : (
            <>
              <ChevronUp size={14} />
              Load previous 7 days
            </>
          )}
        </Button>
      </div>

      {/* Day sections */}
      <div className="flex flex-col gap-4">
        {allBuckets.map((bucket) => (
          <DaySection key={bucket.date} bucket={bucket} today={today} />
        ))}
      </div>

      {/* Load next */}
      <div className="flex justify-center pt-2 pb-6">
        <Button
          variant="outline"
          size="sm"
          onClick={loadMoreFuture}
          disabled={loadingMore}
          className="gap-2 rounded-full px-5"
        >
          {loadingMore ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Loading next 7 days
            </>
          ) : (
            <>
              <ChevronDown size={14} />
              Load next 7 days
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
