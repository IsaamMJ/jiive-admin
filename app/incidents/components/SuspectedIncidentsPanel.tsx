"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoTip } from "@/components/InfoTip";
import { cn } from "@/lib/utils";
import { localDateNDaysFrom } from "@/app/bookings/lib/dayLabels";
import type { Booking } from "@/app/bookings/lib/types";
import { fetchBookingsForSuspicion, incidentErrorMessage } from "../api";
import { SUSPICION_CLASS, SUSPICION_LABEL, deriveSuspectedIncidents } from "../lib/suspected";
import type { FilePrefill } from "./FileIncidentDialog";

/** How far back we look for things that smell wrong. */
const LOOKBACK_DAYS = 21;
const FETCH_LIMIT = 500;

export function SuspectedIncidentsPanel({ onFile }: { onFile: (prefill: FilePrefill) => void }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dismissals are in-memory only, and that is deliberate: this panel is a DERIVED
  // VIEW of the bookings table, not a record of anything. There is no "ignored
  // suspicion" entity on the backend to persist to, and inventing a localStorage
  // one would be a second, unauditable source of truth that silently hides real
  // no-shows from whoever sits down at a different machine. Ignoring here just
  // clears the row for the rest of this session; a reload brings it back.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const today = new Date();
    fetchBookingsForSuspicion({
      appointmentFrom: localDateNDaysFrom(today, -LOOKBACK_DAYS),
      appointmentTo: localDateNDaysFrom(today, 0),
      limit: FETCH_LIMIT,
    })
      .then((b) => setBookings(b))
      .catch((err: unknown) => setError(incidentErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  // Deferred a tick: `load` flips the loading flag, and doing that during the
  // effect's synchronous pass cascades a second render before the first commits.
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const suspected = useMemo(() => deriveSuspectedIncidents(bookings), [bookings]);
  const visible = suspected.filter((s) => !dismissed.has(s.bookingId));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-1.5 text-base">
          Suspected incidents
          <InfoTip label="Not incidents — just bookings that look wrong, spotted automatically from the booking record. Nothing here is logged until you file it. This is how a no-show gets noticed at all, instead of surfacing weeks later in a WhatsApp scroll." />
          {visible.length > 0 && (
            <Badge variant="outline" className="ml-1 border-amber-500/30 bg-amber-500/15 text-amber-400">
              {visible.length}
            </Badge>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Derived from bookings in the last {LOOKBACK_DAYS} days. Ignoring a row only hides it until you reload.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
          </div>
        ) : error ? (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3">
            <span className="text-sm text-red-400">Couldn{"'"}t check bookings — {error}</span>
            <Button variant="outline" size="sm" onClick={load}>Retry</Button>
          </div>
        ) : visible.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {suspected.length === 0
              ? "Nothing looks wrong in the last 21 days."
              : "All suspected incidents ignored for this session."}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {visible.map((s) => (
              <div
                key={s.bookingId}
                className="flex flex-col gap-2 rounded-lg border border-border bg-card/60 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={cn("text-xs", SUSPICION_CLASS[s.kind])}>
                      {SUSPICION_LABEL[s.kind]}
                    </Badge>
                    <span className="text-sm font-medium">{s.customerName}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {s.orderId ?? "no order ID"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {s.appointmentDate} {s.appointmentTime}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">{s.detected}</span>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    className="min-h-9 flex-1 sm:flex-none"
                    onClick={() =>
                      onFile({
                        whatHappened: s.suggestedWhatHappened,
                        severity: s.suggestedSeverity,
                        category: s.suggestedCategory,
                        orderIds: s.orderId ? [s.orderId] : [],
                      })
                    }
                  >
                    File
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-9 flex-1 sm:flex-none"
                    onClick={() => setDismissed((d) => new Set(d).add(s.bookingId))}
                  >
                    Ignore
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
