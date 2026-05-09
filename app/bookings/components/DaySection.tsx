"use client";

import { useState } from "react";
import { CalendarX2 } from "lucide-react";
import { BookingRow } from "./BookingRow";
import { dayLabel } from "../lib/dayLabels";
import type { DayBucket } from "../lib/types";
import { cn } from "@/lib/utils";

function dateMeta(dateStr: string): { weekday: string; dayNum: string; month: string } {
  const d = new Date(`${dateStr}T00:00:00`);
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: "short" }),
    dayNum: String(d.getDate()).padStart(2, "0"),
    month: d.toLocaleDateString(undefined, { month: "short" }),
  };
}

export function DaySection({ bucket, today }: { bucket: DayBucket; today: string }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const isToday = bucket.date === today;
  const meta = dateMeta(bucket.date);
  const label = dayLabel(bucket.date, today);
  const count = bucket.bookings.length;

  return (
    <section
      className={cn(
        "rounded-xl border bg-card/60 backdrop-blur-sm overflow-hidden shadow-sm transition-shadow",
        isToday ? "border-primary/40 shadow-primary/5 ring-1 ring-primary/20" : "border-border/60"
      )}
    >
      <header
        className={cn(
          "flex items-center gap-4 px-5 py-4 border-b",
          isToday ? "bg-primary/5 border-primary/20" : "bg-muted/30 border-border/60"
        )}
      >
        {/* Calendar tile */}
        <div
          className={cn(
            "flex flex-col items-center justify-center w-12 h-12 rounded-lg border shrink-0",
            isToday
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background text-foreground border-border/60"
          )}
        >
          <span className="text-[9px] font-semibold uppercase tracking-wider opacity-80 leading-none">
            {meta.month}
          </span>
          <span className="text-lg font-bold leading-none mt-0.5 tabular-nums">{meta.dayNum}</span>
        </div>

        {/* Label */}
        <div className="flex flex-col">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            {label}
            {isToday && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary text-primary-foreground">
                Live
              </span>
            )}
          </h3>
          <span className="text-xs text-muted-foreground">{meta.weekday}</span>
        </div>

        {/* Count */}
        <div className="ml-auto flex items-center gap-2">
          <span
            className={cn(
              "text-xs font-medium px-2.5 py-1 rounded-full",
              count === 0
                ? "bg-muted text-muted-foreground"
                : isToday
                ? "bg-primary/15 text-primary"
                : "bg-foreground/10 text-foreground/80"
            )}
          >
            {count} {count === 1 ? "booking" : "bookings"}
          </span>
        </div>
      </header>

      {count === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-muted-foreground/70">
          <CalendarX2 size={20} className="opacity-50" />
          <p className="text-xs">No bookings scheduled</p>
        </div>
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
