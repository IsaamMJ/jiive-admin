"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CATEGORY_LABEL,
  SEVERITY_LABEL,
  VENDOR_LABEL,
  type IncidentCategory,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentVendor,
} from "../types";

const SEVERITY_CLASS: Record<IncidentSeverity, string> = {
  S1: "bg-red-500/20 text-red-400 border-red-500/30",
  S2: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  S3: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  S0: "bg-sky-500/20 text-sky-400 border-sky-500/30",
};

export function SeverityBadge({ severity, className }: { severity: IncidentSeverity; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-semibold tabular-nums", SEVERITY_CLASS[severity], className)}>
      {severity} · {SEVERITY_LABEL[severity]}
    </Badge>
  );
}

// OPEN / RESOLVED / CLOSED are deliberately distinct, so they must LOOK distinct.
// RESOLVED is amber, not green: the customer is whole but the RCA is still owed.
const STATUS_CLASS: Record<IncidentStatus, string> = {
  OPEN: "bg-red-500/20 text-red-400 border-red-500/30",
  RESOLVED: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  CLOSED: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
};

const STATUS_LABEL: Record<IncidentStatus, string> = {
  OPEN: "Open",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export function IncidentStatusBadge({ status, className }: { status: IncidentStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-semibold", STATUS_CLASS[status], className)}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function CategoryBadge({ category }: { category: IncidentCategory }) {
  return (
    <Badge variant="outline" className="text-xs font-normal">
      {CATEGORY_LABEL[category]}
    </Badge>
  );
}

export function VendorBadge({ vendor }: { vendor: IncidentVendor }) {
  return (
    <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
      {VENDOR_LABEL[vendor]}
    </Badge>
  );
}

/** The InfoTip copy explaining why RESOLVED and CLOSED are not the same thing. */
export const STATUS_EXPLAINER =
  "Resolved = the customer is whole again. Closed = we also wrote down why it happened and every action has an owner and a date. They are separate on purpose: once the customer's pain is gone, so is the motivation to write the RCA — and then it never gets written.";

export const SEVERITY_EXPLAINER =
  "Graded by harm to the customer, not by how loud it was. Unsure? Pick the higher one and move on — you can re-grade it later. S0 near-misses are worth logging: they are the cheapest lesson available, and a string of them is how you spot a systemic defect before it hurts someone.";
