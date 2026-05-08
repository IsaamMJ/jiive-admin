"use client";

import { useState } from "react";
import { BookingRow } from "./BookingRow";
import { dayLabel } from "../lib/dayLabels";
import type { DayBucket } from "../lib/types";

export function DaySection({ bucket, today }: { bucket: DayBucket; today: string }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <section className="rounded-lg border border-border overflow-hidden bg-card">
      <header className="px-6 py-3 bg-muted/40 border-b border-border flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{dayLabel(bucket.date, today)}</h3>
        <span className="text-xs text-muted-foreground">
          {bucket.bookings.length} {bucket.bookings.length === 1 ? "booking" : "bookings"}
        </span>
      </header>
      {bucket.bookings.length === 0 ? (
        <p className="px-6 py-6 text-sm text-muted-foreground text-center">No bookings</p>
      ) : (
        <div>
          {bucket.bookings.map((b) => (
            <BookingRow
              key={b.id}
              booking={b}
              expanded={expandedId === b.id}
              onToggle={() => setExpandedId(expandedId === b.id ? null : b.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
