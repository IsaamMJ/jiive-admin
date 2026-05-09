"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import api from "@/lib/api";
import { DaySection } from "./DaySection";
import { groupByDay } from "../lib/groupByDay";
import { localDateNDaysFrom } from "../lib/dayLabels";
import type { Booking, DayBucket } from "../lib/types";

const WINDOW_DAYS = 7;
const FETCH_LIMIT = 500;

function todayLocal(): string {
  return localDateNDaysFrom(new Date(), 0);
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

  if (loadingInitial) {
    return (
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border overflow-hidden">
            <Skeleton className="h-10 w-full" />
            <div className="p-3 flex flex-col gap-2">
              {Array.from({ length: 3 }).map((_, j) => <Skeleton key={j} className="h-8" />)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-400">Error: {error}</p>;
  }

  const allBuckets = windows.flat();

  return (
    <div className="flex flex-col gap-4">
      {allBuckets.map((bucket) => (
        <DaySection key={bucket.date} bucket={bucket} today={today} />
      ))}
      <div className="flex justify-center pt-2">
        <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load next 7 days"}
        </Button>
      </div>
    </div>
  );
}
