"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { InfoTip } from "@/components/InfoTip";
import { getIncident, incidentErrorMessage, listAdmins, updateIncident } from "../api";
import {
  type IncidentDetail,
  type IncidentSeverity,
  type IncidentStatus,
} from "../types";
import {
  CategoryBadge,
  IncidentStatusBadge,
  SeverityBadge,
  STATUS_EXPLAINER,
  VendorBadge,
} from "../components/IncidentBadges";
import { IncidentContextBlock } from "../components/IncidentContextBlock";
import { IncidentTimeline } from "../components/IncidentTimeline";
import { IncidentRcaBlock } from "../components/IncidentRcaBlock";
import { describeDetectionGap, formatDateTime } from "../lib/datetime";
import { useIncidentMeta } from "../lib/useIncidentMeta";

export default function IncidentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  // Re-grading uses the server's severity vocabulary, not a local copy of it.
  const { meta } = useIncidentMeta();

  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [admins, setAdmins] = useState<Array<{ id: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    getIncident(id)
      .then((d) => { setIncident(d); setError(null); })
      .catch((err: unknown) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        setIncident(null);
        setError(
          status === 404
            ? "This incident doesn't exist — or the incidents API isn't available yet, because the backend for this feature is still being built."
            : incidentErrorMessage(err)
        );
      })
      .finally(() => setLoading(false));
  }, [id]);

  // Deferred a tick: `load` flips the loading flag, and doing that during the
  // effect's synchronous pass cascades a second render before the first commits.
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    listAdmins()
      .then((a) => setAdmins(a.map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => { /* owner picker degrades to empty; not worth a toast */ });
  }, []);

  async function patch(body: Parameters<typeof updateIncident>[1], successMsg?: string) {
    if (!incident || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const updated = await updateIncident(incident.id, body);
      setIncident(updated);
      if (successMsg) toast.success(successMsg);
    } catch (err: unknown) {
      toast.error(incidentErrorMessage(err));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AdminLayout title="Incident">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </AdminLayout>
    );
  }

  if (error || !incident) {
    return (
      <AdminLayout title="Incident">
        <div className="flex flex-col items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-4">
          <span className="text-sm font-medium text-red-400">Couldn{"'"}t load this incident</span>
          <span className="text-sm text-muted-foreground">{error}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load}>Retry</Button>
            <Button variant="ghost" size="sm" onClick={() => router.push("/incidents")}>
              Back to incidents
            </Button>
          </div>
        </div>
      </AdminLayout>
    );
  }

  const hasFactors = incident.contributingFactors.length > 0;

  // Closing with no cause written down is a hard 400 from the server — for every
  // severity, not just S1/S2. So the button is disabled until at least one
  // contributing factor exists, and it says why. Getting a 400 back would work
  // (we surface the server's message verbatim), but being refused after clicking
  // teaches nothing; a disabled button that explains itself teaches the rule.
  const closeBlockedReason: string | null = hasFactors
    ? null
    : "Add at least one contributing factor below before closing. Closing is the record that we know WHY it happened — that's what makes it different from resolving.";

  const gap = describeDetectionGap(incident.occurredAt, incident.reportedAt);

  const nextTransitions: Array<{ to: IncidentStatus; label: string; blocked: string | null }> =
    incident.status === "OPEN"
      ? [
          { to: "RESOLVED", label: "Mark resolved", blocked: null },
          { to: "CLOSED", label: "Close", blocked: closeBlockedReason },
        ]
      : incident.status === "RESOLVED"
      ? [{ to: "CLOSED", label: "Close", blocked: closeBlockedReason }]
      : [];

  return (
    <AdminLayout title={incident.ref}>
      <div className="flex flex-col gap-5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/incidents")}
          className="w-fit -ml-2 text-muted-foreground"
        >
          <ArrowLeft size={14} className="mr-1.5" />
          All incidents
        </Button>

        {/* Header */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold text-muted-foreground">{incident.ref}</span>
                <SeverityBadge severity={incident.severity} />
                <IncidentStatusBadge status={incident.status} />
                <InfoTip label={STATUS_EXPLAINER} />
                <CategoryBadge category={incident.category} />
                <VendorBadge vendor={incident.vendor} />
                {incident.rcaOverdue ? (
                  <span className="rounded-full border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">
                    RCA overdue
                  </span>
                ) : incident.rcaOwed ? (
                  <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
                    RCA owed{incident.rcaDueAt ? ` · due ${formatDateTime(incident.rcaDueAt)}` : ""}
                  </span>
                ) : null}
              </div>
              <CardTitle className="text-lg leading-snug">{incident.title}</CardTitle>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Occurred {formatDateTime(incident.occurredAt)}</span>
                <span>
                  Filed by {incident.filedBy?.name ?? "an admin token"} {gap ? `· ${gap}` : ""}
                </span>
                {incident.severity !== incident.originalSeverity && (
                  <span title="Severity was re-graded after filing">
                    Originally filed as {incident.originalSeverity}
                  </span>
                )}
                {incident.resolvedAt && <span>Resolved {formatDateTime(incident.resolvedAt)}</span>}
                {incident.closedAt && <span>Closed {formatDateTime(incident.closedAt)}</span>}
              </div>
            </div>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {nextTransitions.map((t) => (
                <Button
                  key={t.to}
                  disabled={saving || t.blocked !== null}
                  title={t.blocked ?? undefined}
                  onClick={() => patch({ status: t.to }, `Marked ${t.to.toLowerCase()}.`)}
                  className="min-h-10"
                >
                  {saving ? <Loader2 size={14} className="mr-2 animate-spin" /> : null}
                  {t.label}
                </Button>
              ))}
              {incident.status === "CLOSED" && (
                <span className="text-sm text-muted-foreground">
                  Closed — the cause is written down and every action has an owner and a date.
                </span>
              )}
              {nextTransitions.some((t) => t.blocked) && (
                <span className="text-xs text-amber-400">
                  {nextTransitions.find((t) => t.blocked)?.blocked}
                </span>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Owner
                  <InfoTip label="Attribution, not permission — everyone can read and edit every incident. This just says who is on it." />
                </span>
                <Select
                  value={incident.owner?.id ?? ""}
                  onValueChange={(v) => { if (v) patch({ ownerAdminId: v }, "Owner updated."); }}
                  disabled={saving}
                >
                  <SelectTrigger className="w-full sm:w-56">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    {admins.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Severity
                  <InfoTip label="Re-gradable. The original grade is kept, so we can see whether we systematically under-call things at the moment we file them." />
                </span>
                <Select
                  value={incident.severity}
                  onValueChange={(v) => {
                    if (v && v !== incident.severity) {
                      patch({ severity: v as IncidentSeverity }, "Severity updated.");
                    }
                  }}
                  disabled={saving}
                >
                  <SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {meta.severities.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.value} · {s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* What happened */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">What happened</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{incident.whatHappened}</p>
            {incident.vendorCommitment && (
              <div className="mt-4 rounded-lg border border-border bg-card/60 p-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Vendor commitment
                </span>
                <p className="mt-1 whitespace-pre-wrap text-sm">{incident.vendorCommitment}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <IncidentContextBlock context={incident.context} />

        <IncidentTimeline incident={incident} onUpdated={setIncident} admins={admins} />

        <IncidentRcaBlock incident={incident} onUpdated={setIncident} />
      </div>
    </AdminLayout>
  );
}
