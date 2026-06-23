"use client";

import { Badge } from "@/components/ui/badge";
import type { Booking } from "../lib/types";
import { cn } from "@/lib/utils";

type Variant = "user" | "thyrocare" | "admin" | "unknown";

const VARIANTS: Record<Variant, { label: string; cls: string }> = {
  user: {
    label: "Cancelled · User",
    cls: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  },
  thyrocare: {
    label: "Cancelled · Lab",
    cls: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
  admin: {
    label: "Cancelled · Admin",
    cls: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  },
  unknown: {
    label: "Cancelled · ?",
    cls: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  },
};

function variantFor(by: Booking["cancelledBy"]): Variant {
  if (by === "user") return "user";
  if (by === "thyrocare") return "thyrocare";
  if (typeof by === "string" && by.startsWith("admin")) return "admin";
  return "unknown";
}

export function CancellationBadge({ cancelledBy }: { cancelledBy: Booking["cancelledBy"] }) {
  const v = VARIANTS[variantFor(cancelledBy)];
  const tooltip =
    cancelledBy === null
      ? "Pre-2026-05-09 cancellation"
      : typeof cancelledBy === "string" && cancelledBy.startsWith("admin:")
      ? `Admin: ${cancelledBy.slice(6)}`
      : undefined;
  return (
    <Badge variant="outline" className={cn("font-medium", v.cls)} title={tooltip}>
      {v.label}
    </Badge>
  );
}
