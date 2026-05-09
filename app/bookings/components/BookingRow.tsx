"use client";

import { ChevronDown, Phone, MapPin, Clock } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { BookingExpandedPanel } from "./BookingExpandedPanel";
import { formatRelativeTime } from "../lib/formatRelativeTime";
import type { Booking } from "../lib/types";
import { cn } from "@/lib/utils";

function fmt12h(time: string): { h: string; m: string; ampm: string } {
  const [hStr, mStr] = time.split(":");
  let h = parseInt(hStr, 10);
  const m = mStr ?? "00";
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return { h: String(h), m, ampm };
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

// Deterministic gradient pick from name so the same patient always gets the same color.
const GRADIENTS = [
  "from-rose-500/80 to-orange-500/80",
  "from-violet-500/80 to-fuchsia-500/80",
  "from-sky-500/80 to-cyan-500/80",
  "from-emerald-500/80 to-teal-500/80",
  "from-amber-500/80 to-yellow-500/80",
  "from-indigo-500/80 to-blue-500/80",
];
function gradientFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return GRADIENTS[Math.abs(h) % GRADIENTS.length];
}

interface Props {
  booking: Booking;
  expanded: boolean;
  onToggle: () => void;
}

export function BookingRow({ booking, expanded, onToggle }: Props) {
  const t = fmt12h(booking.appointmentTime);

  return (
    <div className={cn("border-t border-border/60 first:border-t-0 transition-colors", expanded && "bg-accent/30")}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full grid grid-cols-[auto_56px_auto_1fr_auto_auto_auto_auto] items-center gap-3 sm:gap-4 px-4 sm:px-6 py-3.5 text-left hover:bg-accent/40 transition-colors"
      >
        {/* Chevron */}
        <ChevronDown
          size={14}
          className={cn(
            "text-muted-foreground/60 shrink-0 transition-transform duration-200",
            !expanded && "-rotate-90"
          )}
        />

        {/* Time block */}
        <div className="flex flex-col items-start leading-none">
          <span className="text-base font-semibold tabular-nums">{t.h}:{t.m}</span>
          <span className="text-[10px] font-medium text-muted-foreground tracking-wider mt-0.5">{t.ampm}</span>
        </div>

        {/* Avatar */}
        <div
          className={cn(
            "h-9 w-9 rounded-full bg-gradient-to-br shrink-0 flex items-center justify-center text-[11px] font-bold text-white shadow-sm",
            gradientFor(booking.patientName || booking.id)
          )}
        >
          {initials(booking.patientName) || "?"}
        </div>

        {/* Name + phone */}
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium truncate">{booking.patientName}</span>
          <span className="text-xs text-muted-foreground font-mono truncate hidden sm:flex items-center gap-1">
            <Phone size={10} className="shrink-0 opacity-60" />
            {booking.user.whatsappPhone}
          </span>
        </div>

        {/* Thyrocare ID */}
        <span
          className={cn(
            "text-xs font-mono hidden md:inline-flex items-center px-2 py-0.5 rounded-md tabular-nums",
            booking.thyrocareOrderId
              ? "bg-muted/70 text-foreground/80 border border-border/40"
              : "text-muted-foreground/40"
          )}
        >
          {booking.thyrocareOrderId ?? "—"}
        </span>

        {/* Status */}
        <span className="shrink-0">
          <StatusBadge status={booking.status} />
        </span>

        {/* City */}
        <span className="text-xs text-muted-foreground hidden lg:inline-flex items-center gap-1 w-28 truncate">
          <MapPin size={11} className="shrink-0 opacity-60" />
          {booking.address?.city ?? "—"}
        </span>

        {/* Booked relative */}
        <span className="text-xs text-muted-foreground hidden xl:inline-flex items-center gap-1 w-32 justify-end">
          <Clock size={11} className="shrink-0 opacity-60" />
          {formatRelativeTime(booking.createdAt)}
        </span>
      </button>

      <div
        className={cn(
          "grid transition-all duration-200 ease-out",
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">
          {expanded && <BookingExpandedPanel booking={booking} />}
        </div>
      </div>
    </div>
  );
}
