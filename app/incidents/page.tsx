"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ClipboardList, Plus, Sparkles } from "lucide-react";
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
import { getRcaOwed, incidentErrorMessage, listIncidents, listOpenActions } from "./api";
import {
  SEVERITY_LABEL,
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
import { DraftIncidentDialog } from "./components/DraftIncidentDialog";
import { SuspectedIncidentsPanel } from "./components/SuspectedIncidentsPanel";
import { OpenActionsDialog } from "./components/OpenActionsDialog";
import { formatDateTime } from "./lib/datetime";
import { useIncidentMeta } from "./lib/useIncidentMeta";

const PAGE_SIZE = 50;

/**
 * The backend's `status` filter takes ONE value and rejects unknown query keys
 * outright (400), so "everything except CLOSED" is not expressible server-side —
 * there is no excludeClosed, and no multi-status. Guessing one took the whole
 * list down until it was caught in a browser.
 *
 * So: default to "all" (hide nothing), and offer the three real statuses. The
 * RCA-owed badge narrows to RESOLVED, which is exactly where an RCA obligation
 * lives — an incident is RESOLVED (customer whole) but not yet CLOSED (cause
 * dealt with). If the backend later adds excludeClosed, restore it as the default.
 */
type StatusFilter = IncidentStatus | "all";

export default function IncidentsPage() {
  const router = useRouter();

  // Filter vocabulary comes from the server (GET /incidents/meta) so it can never
  // drift from what the backend will actually accept.
  const { meta } = useIncidentMeta();

  const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<StatusFilter>("all");
  const [severity, setSeverity] = useState<IncidentSeverity | "all">("all");
  const [category, setCategory] = useState<IncidentCategory | "all">("all");
  const [vendor, setVendor] = useState<IncidentVendor | "all">("all");
  const [occurredFrom, setOccurredFrom] = useState("");
  const [occurredTo, setOccurredTo] = useState("");
  const [offset, setOffset] = useState(0);

  // Top-strip counters.
  const [rcaOwedCount, setRcaOwedCount] = useState<number | null>(null);
  const [openActions, setOpenActions] = useState<OpenActionItem[]>([]);
  const [actionsLoading, setActionsLoading] = useState(true);
  const [actionsError, setActionsError] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);

  const [fileOpen, setFileOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [prefill, setPrefill] = useState<FilePrefill | null>(null);
  // Bumped on every open so the dialog remounts with fresh state initialised from
  // the prefill — no reset-on-open effect to keep in sync.
  const [fileKey, setFileKey] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    const params: IncidentListParams = { limit: PAGE_SIZE, offset };
    // Only keys verified against the live backend — it 400s on anything else.
    if (status !== "all") params.status = status;
    if (severity !== "all") params.severity = severity;
    if (category !== "all") params.category = category;
    if (vendor !== "all") params.vendor = vendor;
    if (occurredFrom) params.from = occurredFrom;
    if (occurredTo) params.to = occurredTo;

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
  }, [offset, status, severity, category, vendor, occurredFrom, occurredTo]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  // The RCA-owed count comes from GET /incidents/rca-owed — the endpoint that owns
  // the definition of "owed" — rather than from a filtered /incidents query. It is
  // its own call so the badge stays correct regardless of the table's filters, and
  // so the number here always agrees with the rule the overdue-RCA email fires on.
  const loadCounters = useCallback(() => {
    getRcaOwed()
      .then((r) => setRcaOwedCount(r.count))
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

  // Per-incident overdue counts, counted from the cross-incident open-actions list
  // we already have. The list rows don't carry this, and inventing a number from
  // the row's `_count` (which counts ALL actions, not overdue ones) would be worse
  // than not showing it.
  const overdueByIncident = new Map<string, number>();
  for (const a of openActions) {
    if (a.overdue) overdueByIncident.set(a.incidentId, (overdueByIncident.get(a.incidentId) ?? 0) + 1);
  }

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
            // There's no server-side rcaOwed filter (it 400s). An RCA is owed exactly
            // when an incident is RESOLVED but not yet CLOSED, so narrow to RESOLVED —
            // and the row-level rcaOverdue flag does the rest.
            onClick={() => { setStatus("RESOLVED"); setOffset(0); }}
            className={cn(
              "flex min-h-11 flex-1 items-center gap-3 rounded-xl border px-4 py-2.5 text-left transition-colors sm:flex-none",
              status === "RESOLVED"
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

          {status !== "all" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setStatus("all"); setOffset(0); }}
            >
              Clear filter
            </Button>
          )}

          {/* Laptop-first: "Draft with AI" (dump a paragraph, AI fills the fields)
              sits alongside the manual file button. The phone FAB below stays
              manual-only — the AI-draft flow is the sit-down-and-write-it-up path. */}
          <div className="ml-auto hidden gap-2 sm:flex">
            <Button variant="outline" onClick={() => setDraftOpen(true)}>
              <Sparkles size={14} className="mr-1.5" />
              Draft with AI
            </Button>
            <Button onClick={() => openFile(null)}>
              <Plus size={14} className="mr-1.5" />
              File incident
            </Button>
          </div>
        </div>

        <SuspectedIncidentsPanel onFile={openFile} />

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={(v) => resetPaging(setStatus)((v as StatusFilter) ?? "all")}>
            <SelectTrigger className="w-44">
              <SelectValue>
                {(v: unknown) =>
                  v === "all"
                    ? "All statuses"
                    : (meta.statuses.find((s) => s.value === v)?.label ?? String(v))
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {meta.statuses.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={severity} onValueChange={(v) => resetPaging(setSeverity)((v as IncidentSeverity) ?? "all")}>
            <SelectTrigger className="w-40">
              <SelectValue>
                {(v: unknown) =>
                  v === "all"
                    ? "All severities"
                    : `${String(v)}${SEVERITY_LABEL[v as IncidentSeverity] ? ` · ${SEVERITY_LABEL[v as IncidentSeverity]}` : ""}`
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              {meta.severities.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.value}
                  {SEVERITY_LABEL[s.value] ? ` · ${s.label}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={category} onValueChange={(v) => resetPaging(setCategory)((v as IncidentCategory) ?? "all")}>
            <SelectTrigger className="w-52">
              <SelectValue>
                {(v: unknown) =>
                  v === "all"
                    ? "All categories"
                    : (meta.categories.find((c) => c.value === v)?.label ?? String(v))
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {meta.categories.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={vendor} onValueChange={(v) => resetPaging(setVendor)((v as IncidentVendor) ?? "all")}>
            <SelectTrigger className="w-40">
              <SelectValue>
                {(v: unknown) =>
                  v === "all"
                    ? "All vendors"
                    : (meta.vendors.find((x) => x.value === v)?.label ?? String(v))
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All vendors</SelectItem>
              {meta.vendors.map((v2) => (
                <SelectItem key={v2.value} value={v2.value}>{v2.label}</SelectItem>
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
                  ) : incidents.map((i) => {
                    const overdueActions = overdueByIncident.get(i.id) ?? 0;
                    return (
                    <TableRow
                      key={i.id}
                      onClick={() => router.push(`/incidents/${i.id}`)}
                      className="cursor-pointer"
                    >
                      <TableCell className="whitespace-nowrap font-mono text-xs font-semibold">{i.ref}</TableCell>
                      <TableCell className="max-w-xs">
                        <span className="line-clamp-2 text-sm">{i.title}</span>
                        {overdueActions > 0 && (
                          <span className="text-xs font-medium text-red-400">
                            {overdueActions} overdue action{overdueActions !== 1 ? "s" : ""}
                          </span>
                        )}
                      </TableCell>
                      <TableCell><SeverityBadge severity={i.severity} /></TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <IncidentStatusBadge status={i.status} />
                          {i.rcaOverdue ? (
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-red-400">
                              RCA overdue
                            </span>
                          ) : i.rcaOwed ? (
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-400">
                              RCA owed
                            </span>
                          ) : null}
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
                    );
                  })}
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

      <DraftIncidentDialog
        open={draftOpen}
        onOpenChange={setDraftOpen}
        // The AI draft (or the raw-text fallback on 503) opens the file form
        // pre-filled — the human reviews, picks order IDs, and clicks File.
        onReady={openFile}
      />

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
