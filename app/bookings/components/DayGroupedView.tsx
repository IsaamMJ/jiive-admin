"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Loader2, ChevronDown, CalendarDays, CheckCircle2, Clock4, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import api from "@/lib/api";
import { DaySection } from "./DaySection";
import { groupByDay } from "../lib/groupByDay";
import { localDateNDaysFrom } from "../lib/dayLabels";
import type { Booking, DayBucket } from "../lib/types";
import { cn } from "@/lib/utils";

const WINDOW_DAYS = 7;
const FETCH_LIMIT = 500;

function todayLocal(): string {
  return localDateNDaysFrom(new Date(), 0);
}

function StatTile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: number;
  accent: string;
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
      </div>
    </div>
  );
}

export function DayGroupedView() {
  const [today] = useState<string>(todayLocal);
  const [windows, setWindows] = useState<DayBucket[][]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWindow = useCallback(async (windowIndex: number): Promise<DayBucket[]> => {
    const from = localDateNDaysFrom(new Date(`${today}T00:00:00`), windowIndex * WINDOW_DAYS);
    const to = localDateNDaysFrom(new Date(`${today}T00:00:00`), windowIndex * WINDOW_DAYS + WINDOW_DAYS - 1);
    const params = new URLSearchParams({
      appointmentFrom: from,
      appointmentTo: to,
      limit: String(FETCH_LIMIT),
    });
    const r = await api.get(`/bookings?${params}`);
    const bookings: Booking[] = r.data.bookings ?? [];
    return groupByDay(bookings, from, WINDOW_DAYS);
  }, [today]);

  useEffect(() => {
    let cancelled = false;
    setLoadingInitial(true);
    fetchWindow(0)
      .then((buckets) => { if (!cancelled) setWindows([buckets]); })
      .catch((e) => { if (!cancelled) setError(e?.message ?? "Failed to load"); })
      .finally(() => { if (!cancelled) setLoadingInitial(false); });
    return () => { cancelled = true; };
  }, [fetchWindow]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = await fetchWindow(windows.length);
      setWindows((w) => [...w, next]);
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to load");
    } finally {
      setLoadingMore(false);
    }
  };

  const allBuckets = useMemo(() => windows.flat(), [windows]);

  const stats = useMemo(() => {
    const todayBookings = allBuckets.find((b) => b.date === today)?.bookings ?? [];
    const all = allBuckets.flatMap((b) => b.bookings);
    const upcomingActive = all.filter((b) =>
      ["pending_payment", "confirmed", "phlebo_assigned", "payment_completed", "booking_confirmed"].includes(b.status)
    );
    const completed = all.filter((b) => b.status === "completed").length;
    const cancelled = all.filter((b) => b.status === "cancelled" || b.status === "failed").length;
    return {
      today: todayBookings.length,
      upcoming: upcomingActive.length,
      completed,
      cancelled,
    };
  }, [allBuckets, today]);

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
      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile
          icon={CalendarDays}
          label="Today"
          value={stats.today}
          accent="bg-primary/15 text-primary"
        />
        <StatTile
          icon={Clock4}
          label="Upcoming"
          value={stats.upcoming}
          accent="bg-amber-500/15 text-amber-400"
        />
        <StatTile
          icon={CheckCircle2}
          label="Completed"
          value={stats.completed}
          accent="bg-emerald-500/15 text-emerald-400"
        />
        <StatTile
          icon={XCircle}
          label="Cancelled"
          value={stats.cancelled}
          accent="bg-rose-500/15 text-rose-400"
        />
      </div>

      {/* Day sections */}
      <div className="flex flex-col gap-4">
        {allBuckets.map((bucket) => (
          <DaySection key={bucket.date} bucket={bucket} today={today} />
        ))}
      </div>

      {/* Load more */}
      <div className="flex justify-center pt-2 pb-6">
        <Button
          variant="outline"
          size="sm"
          onClick={loadMore}
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
