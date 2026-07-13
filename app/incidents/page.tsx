"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ClipboardList, Plus } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InfoTip } from "@/components/InfoTip";
import { cn } from "@/lib/utils";
import { incidentErrorMessage, listIncidents, listOpenActions } from "./api";
import {
  CATEGORY_LABEL,
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_VENDORS,
  VENDOR_LABEL,
  type IncidentCategory,
  type IncidentListParams,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentSummary,
  type IncidentVendor,
  type OpenActionItem,
} from "./types";
import { CategoryBadge, IncidentStatusBadge, SeverityBadge, STATUS_EXPLAINER, VendorBadge } from "./components/IncidentBadges";
import { FileIncidentDialog, type FilePrefill } from "./components/FileIncidentDialog";
import { SuspectedIncidentsPanel } from "./components/SuspectedIncidentsPanel";
import { OpenActionsDialog } from "./components/OpenActionsDialog";
import { formatDateTime } from "./lib/datetime";

const PAGE_SIZE = 50;

type StatusFilter = IncidentStatus | "not_closed" | "all";

export default function IncidentsPage() {
  const router = useRouter();

  const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Default view: everything not CLOSED.
  const [status, setStatus] = useState<StatusFilter>("not_closed");
  const [severity, setSeverity] = useState<IncidentSeverity | "all">("all");
  const [category, setCategory] = useState<IncidentCategory | "all">("all");
  const [vendor, setVendor] = useState<IncidentVendor | "all">("all");
  const [occurredFrom, setOccurredFrom] = useState("");
  const [occurredTo, setOccurredTo] = useState("");
  const [rcaOwedOnly, setRcaOwedOnly] = useState(false);
  const [offset, setOffset] = useState(0);

  // Top-strip counters.
  const [rcaOwedCount, setRcaOwedCount] = useState<number | null>(null);
  const [openActions, setOpenActions] = useState<OpenActionItem[]>([]);
  const [actionsLoading, setActionsLoading] = useState(true);
  const [actionsError, setActionsError] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);

  const [fileOpen, setFileOpen] = useState(false);
  const [prefill, setPrefill] = useState<FilePrefill | null>(null);
  // Bumped on every open so the dialog remounts with fresh state initialised from
  // the prefill — no reset-on-open effect to keep in sync.
  const [fileKey, setFileKey] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    const params: IncidentListParams = { limit: PAGE_SIZE, offset };
    if (status === "not_closed") params.excludeClosed = true;
    else if (status !== "all") params.status = status;
    if (severity !== "all") params.severity = severity;
    if (category !== "all") params.category = category;
    if (vendor !== "all") params.vendor = vendor;
    if (occurredFrom) params.occurredFrom = occurredFrom;
    if (occurredTo) params.occurredTo = occurredTo;
    if (rcaOwedOnly) params.rcaOwed = true;

    listIncidents(params)
      .then((r) => {
        setIncidents(r.incidents);
        setTotal(r.total);
        setError(null);
      })
      .catch((err: unknown) => {
        setIncidents([]);
        setTotal(0);
        setError(incidentErrorMessage(err));
      })
      .finally(() => setLoading(false));
  }, [offset, status, severity, category, vendor, occurredFrom, occurredTo, rcaOwedOnly]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  // RCA-owed count is a separate, cheap query so the badge is right regardless of
  // the filters currently applied to the table.
  const loadCounters = useCallback(() => {
    listIncidents({ rcaOwed: true, limit: 1 })
      .then((r) => setRcaOwedCount(r.total))
      .catch(() => setRcaOwedCount(null));

    setActionsLoading(true);
    listOpenActions()
      .then((r) => { setOpenActions(r.actions); setActionsError(null); })
      .catch((err: unknown) => { setOpenActions([]); setActionsError(incidentErrorMessage(err)); })
      .finally(() => setActionsLoading(false));
  }, []);

  // Deferred a tick, same reason as the debounced list load above: setting the
  // loading flag during the effect's synchronous pass cascades an extra render.
  useEffect(() => {
    const t = setTimeout(loadCounters, 0);
    return () => clearTimeout(t);
  }, [loadCounters]);

  const overdueCount = openActions.filter((a) => a.overdue).length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.floor(offset / PAGE_SIZE);

  function openFile(p: FilePrefill | null) {
    setPrefill(p);
    setFileKey((k) => k + 1);
    setFileOpen(true);
  }

  function resetPaging<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setOffset(0); };
  }

  return (
    <AdminLayout title="Incidents">
      <div className="flex flex-col gap-5 pb-20 sm:pb-0">
        {/* Top strip — the two numbers that keep this log alive. */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => { setRcaOwedOnly(true); setStatus("all"); setOffset(0); }}
            className={cn(
              "flex min-h-11 flex-1 items-center gap-3 rounded-xl border px-4 py-2.5 text-left transition-colors sm:flex-none",
              rcaOwedOnly
                ? "border-amber-500 bg-amber-500/20"
                : "border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20"
            )}
          >
            <ClipboardList size={16} className="shrink-0 text-amber-400" />
            <span className="flex flex-col">
              <span className="text-xs font-semibold uppercase tracking-wide text-amber-400">
                RCA owed ({rcaOwedCount ?? "—"})
              </span>
              <span className="text-[11px] text-muted-foreground">Resolved, cause not written up</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActionsOpen(true)}
            className={cn(
              "flex min-h-11 flex-1 items-center gap-3 rounded-xl border px-4 py-2.5 text-left transition-colors sm:flex-none",
              overdueCount > 0
                ? "border-red-500/40 bg-red-500/10 hover:bg-red-500/20"
                : "border-border bg-card/60 hover:bg-accent"
            )}
          >
            <AlertTriangle
              size={16}
              className={cn("shrink-0", overdueCount > 0 ? "text-red-400" : "text-muted-foreground")}
            />
            <span className="flex flex-col">
              <span
                className={cn(
                  "text-xs font-semibold uppercase tracking-wide",
                  overdueCount > 0 ? "text-red-400" : "text-muted-foreground"
                )}
              >
                Overdue actions ({actionsError ? "—" : overdueCount})
              </span>
              <span className="text-[11px] text-muted-foreground">Past their due date, across all incidents</span>
            </span>
          </button>

          {rcaOwedOnly && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setRcaOwedOnly(false); setStatus("not_closed"); setOffset(0); }}
            >
              Clear RCA filter
            </Button>
          )}

          <Button className="ml-auto hidden sm:inline-flex" onClick={() => openFile(null)}>
            <Plus size={14} className="mr-1.5" />
            File incident
          </Button>
        </div>

        <SuspectedIncidentsPanel onFile={openFile} />

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={(v) => resetPaging(setStatus)((v as StatusFilter) ?? "not_closed")}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="not_closed">Not closed</SelectItem>
              <SelectItem value="all">All statuses</SelectItem>
              {INCIDENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={severity} onValueChange={(v) => resetPaging(setSeverity)((v as IncidentSeverity) ?? "all")}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              {INCIDENT_SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={category} onValueChange={(v) => resetPaging(setCategory)((v as IncidentCategory) ?? "all")}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {INCIDENT_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={vendor} onValueChange={(v) => resetPaging(setVendor)((v as IncidentVendor) ?? "all")}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All vendors</SelectItem>
              {INCIDENT_VENDORS.map((v2) => (
                <SelectItem key={v2} value={v2}>{VENDOR_LABEL[v2]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              aria-label="Occurred from"
              value={occurredFrom}
              onChange={(e) => resetPaging(setOccurredFrom)(e.target.value)}
              className="w-40"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              aria-label="Occurred to"
              value={occurredTo}
              onChange={(e) => resetPaging(setOccurredTo)(e.target.value)}
              className="w-40"
            />
          </div>

          <span className="text-sm text-muted-foreground">
            {loading ? "…" : `${total} incident${total !== 1 ? "s" : ""}`}
          </span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
          </div>
        ) : error ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-red-400">Couldn{"'"}t load incidents</span>
              <span className="text-sm text-muted-foreground">{error}</span>
            </div>
            <Button variant="outline" size="sm" onClick={load}>Retry</Button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ref</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>
                      <span className="inline-flex items-center gap-1">
                        Status
                        <InfoTip label={STATUS_EXPLAINER} />
                      </span>
                    </TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Occurred</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Orders</TableHead>
                    <TableHead>Owner</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {incidents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                        <div className="flex flex-col items-center gap-3">
                          <span>No incidents match these filters.</span>
                          <Button variant="outline" size="sm" onClick={() => openFile(null)}>
                            <Plus size={14} className="mr-1.5" />
                            File the first one
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : incidents.map((i) => (
                    <TableRow
                      key={i.id}
                      onClick={() => router.push(`/incidents/${i.id}`)}
                      className="cursor-pointer"
                    >
                      <TableCell className="whitespace-nowrap font-mono text-xs font-semibold">{i.ref}</TableCell>
                      <TableCell className="max-w-xs">
                        <span className="line-clamp-2 text-sm">{i.title}</span>
                        {i.overdueActionCount > 0 && (
                          <span className="text-xs font-medium text-red-400">
                            {i.overdueActionCount} overdue action{i.overdueActionCount !== 1 ? "s" : ""}
                          </span>
                        )}
                      </TableCell>
                      <TableCell><SeverityBadge severity={i.severity} /></TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <IncidentStatusBadge status={i.status} />
                          {i.rcaOwed && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-400">
                              RCA owed
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell><CategoryBadge category={i.category} /></TableCell>
                      <TableCell><VendorBadge vendor={i.vendor} /></TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(i.occurredAt)}
                      </TableCell>
                      <TableCell className="text-xs">{i.customerName ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {i.affectedOrderIds.length === 0
                          ? "—"
                          : i.affectedOrderIds.length === 1
                          ? i.affectedOrderIds[0]
                          : `${i.affectedOrderIds[0]} +${i.affectedOrderIds.length - 1}`}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{i.owner?.name ?? "Unassigned"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Thumb-reachable on a phone — filing must never require scrolling to the top. */}
      <Button
        onClick={() => openFile(null)}
        className="fixed bottom-5 right-5 z-40 h-14 rounded-full px-5 shadow-lg sm:hidden"
      >
        <Plus size={18} className="mr-1.5" />
        File incident
      </Button>

      <FileIncidentDialog
        key={fileKey}
        open={fileOpen}
        onOpenChange={setFileOpen}
        prefill={prefill}
        onFiled={() => { load(); loadCounters(); }}
      />

      <OpenActionsDialog
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        actions={openActions}
        loading={actionsLoading}
        error={actionsError}
        onRetry={loadCounters}
      />
    </AdminLayout>
  );
}
