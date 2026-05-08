"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { BookingExpandedPanel } from "./BookingExpandedPanel";
import { formatRelativeTime } from "../lib/formatRelativeTime";
import type { Booking } from "../lib/types";

function fmt12h(time: string): string {
  // "09:30" -> "9:30 AM"
  const [hStr, mStr] = time.split(":");
  let h = parseInt(hStr, 10);
  const m = mStr ?? "00";
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

interface Props {
  booking: Booking;
  expanded: boolean;
  onToggle: () => void;
}

export function BookingRow({ booking, expanded, onToggle }: Props) {
  return (
    <div className="border-t border-border first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-6 py-3 text-left hover:bg-accent/50 transition-colors"
      >
        {expanded ? <ChevronDown size={14} className="text-muted-foreground shrink-0" /> : <ChevronRight size={14} className="text-muted-foreground shrink-0" />}
        <span className="text-sm font-mono w-20 shrink-0">{fmt12h(booking.appointmentTime)}</span>
        <span className="text-sm font-medium flex-1 min-w-0 truncate">{booking.patientName}</span>
        <span className="text-xs font-mono text-muted-foreground hidden sm:inline w-32 truncate">{booking.user.whatsappPhone}</span>
        <span className="text-xs font-mono text-muted-foreground hidden md:inline w-28 truncate">
          {booking.thyrocareOrderId ?? "—"}
        </span>
        <span className="shrink-0"><StatusBadge status={booking.status} /></span>
        <span className="text-xs text-muted-foreground hidden lg:inline w-24 truncate">{booking.address?.city ?? ""}</span>
        <span className="text-xs text-muted-foreground hidden xl:inline w-28 text-right">Booked {formatRelativeTime(booking.createdAt)}</span>
      </button>
      {expanded && <BookingExpandedPanel booking={booking} />}
    </div>
  );
}
