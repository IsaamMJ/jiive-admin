"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { InfoTip } from "@/components/InfoTip";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import api from "@/lib/api";

interface Result {
  id: string;
  testType: string;
  calculatedAge: string;
  chronologicalAge: string;
  ageDelta: string;
  status: string;
  elevatedFlag: boolean;
  formulaVersion: string;
  createdAt: string;
  user: { id: string; whatsappPhone: string; name: string };
  booking: { patientName: string; appointmentDate: string };
  // Flat subject fields (id-linked to FamilyMember, not a name match). "self" =
  // the account holder; null = an uploaded report not yet linked to a member.
  // The "User" column is who owns the account; "Patient" is who the test is FOR.
  patientName?: string | null;
  relationship?: string | null;
}

const STATUS_OPTIONS = ["all", "pending", "completed", "failed"];

/**
 * THE SERVER'S CEILING, and the reason this page cannot state a total.
 *
 * `GET /results` (jiive-backend admin.controller.ts `getResults`) does
 * `take = Math.min(parseInt(limit || '50', 10), 200)`, orders `createdAt desc`,
 * and returns a BARE `{ results: [...] }`. Three consequences, all of them
 * things this page must not paper over:
 *
 *   1. The clamp is SILENT. Asking for 500 returns 200 with no indication it was
 *      cut — verified live on dev 2026-08-07: `?limit=500` answered 200 OK and
 *      the response keys were `["results"]` and nothing else.
 *   2. There is no `total`. So the honest count is "how many are on screen", and
 *      any number this page calls a total would be invented.
 *   3. There is no `offset`/cursor param AT ALL. Result #201 is therefore not
 *      merely unloaded, it is UNREACHABLE from this screen — no button can fix
 *      it, only the backend can. Saying so out loud is the entire fix available
 *      here.
 *
 * Neither environment has passed 200 results yet (dev 11, prod 17 on
 * 2026-08-07), so the clamp could not be exercised live — it is read off the
 * handler, and that is why this page keys off "exactly RESULTS_LIMIT came back"
 * rather than claiming to know what was dropped.
 */
const RESULTS_LIMIT = 200;

const RESULTS_CAP_EXPLAINER =
  "The results list has no paging: the server returns at most the 200 most recent and there is no way to ask for the ones after that. When exactly 200 come back we cannot tell whether that is all of them or the newest 200 of more, so we say so rather than guess. Narrow the status filter to see a different slice.";

export default function ResultsPage() {
  const router = useRouter();
  const [results, setResults] = useState<Result[]>([]);
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  /**
   * A failed load. Previously there was no `.catch` at all, so any failure left
   * the skeleton spinning forever — which reads as "still loading" and is the
   * same lie by a different route.
   */
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: String(RESULTS_LIMIT) });
    // `status=all` is NOT sent: the server validates `status` against the
    // canonical ResultStatus set and 400s on anything outside it.
    if (status !== "all") params.set("status", status);
    api
      .get(`/results?${params}`)
      .then((r) => {
        if (cancelled) return;
        const rows = r.data?.results;
        if (!Array.isArray(rows)) {
          // Not an empty list — an envelope we don't recognise. Rendering it as
          // "no results found" would be exactly the wrong answer.
          setError("The server returned no `results` array — the response shape has changed.");
          setResults([]);
        } else {
          setResults(rows);
        }
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        const err = e as { response?: { status?: number; data?: { message?: string | string[] } }; message?: string };
        const body = err?.response?.data?.message;
        const server = Array.isArray(body) ? body.join(", ") : body;
        setError(server ?? err?.message ?? "Couldn't load results.");
        setResults([]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [status]);

  // Exactly at the ceiling: there may be older results and we have no way to
  // count them or fetch them. Below it, the list IS complete for this filter.
  const atCap = results.length >= RESULTS_LIMIT;

  return (
    <AdminLayout title="Results">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Select value={status} onValueChange={(v) => setStatus(v ?? "all")}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* "loaded", never "total" — the server does not send a count and this
              page must not manufacture one out of a page length. */}
          {!loading && !error && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              {results.length} loaded
              {atCap && <InfoTip label={RESULTS_CAP_EXPLAINER} />}
            </span>
          )}
        </div>

        {/* At the ceiling the list is NOT known to be complete. Say it plainly,
            above the table, where it cannot be missed. */}
        {!loading && !error && atCap && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
            <p className="text-muted-foreground">
              Showing the <span className="font-medium text-foreground">{RESULTS_LIMIT} most recent</span> results.
              This is the server&apos;s limit, not a count — anything older is not loaded, and there is
              currently no way to fetch it from this screen.
            </p>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : error ? (
          <div className="flex flex-col items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
            <p className="flex items-center gap-1.5 font-medium">
              <AlertTriangle size={15} className="shrink-0 text-amber-400" />
              Couldn&apos;t load results
            </p>
            <p className="text-xs break-words text-muted-foreground">{error}</p>
            <p className="text-[11px] text-muted-foreground/70">
              This is a failure to read, not an empty list.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Test</TableHead>
                  <TableHead>Bio Age</TableHead>
                  <TableHead>Chrono Age</TableHead>
                  <TableHead>Delta</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer hover:bg-accent"
                    onClick={() => router.push(`/results/${r.id}`)}
                  >
                    <TableCell className="text-muted-foreground">{r.user.name ?? r.user.whatsappPhone}</TableCell>
                    <TableCell>
                      {(() => {
                        const subject = r.patientName?.trim() || r.booking?.patientName?.trim() || r.user.name || r.user.whatsappPhone;
                        const rel = r.relationship?.trim();
                        const showRel = rel && rel.toLowerCase() !== "self";
                        return (
                          <span className="inline-flex items-baseline gap-1.5">
                            <span className="font-medium">{subject}</span>
                            {showRel && <span className="text-xs capitalize text-muted-foreground">· {rel}</span>}
                          </span>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="capitalize">{r.testType.replace(/_/g, " ")}</TableCell>
                    {(() => {
                      // Same "absent signal isn't a value" guard as the detail page: a FAILED
                      // row still carries chronologicalAge: 0 (results-pipeline.service.ts
                      // saveFailedResult never sets a real age), and parseFloat(null)/NaN
                      // was tripping the delta colour into a false-green/red read. Only
                      // trust these fields once the pipeline actually completed.
                      const isCompleted = r.status === "completed";
                      const delta = isCompleted && r.ageDelta != null ? parseFloat(r.ageDelta) : NaN;
                      return (
                        <>
                          <TableCell>{isCompleted ? (r.calculatedAge ?? "—") : "—"}</TableCell>
                          <TableCell>{isCompleted ? (r.chronologicalAge ?? "—") : "—"}</TableCell>
                          <TableCell className={Number.isFinite(delta) ? (delta < 0 ? "text-green-400" : "text-red-400") : ""}>
                            {isCompleted ? (r.ageDelta ?? "—") : "—"}
                          </TableCell>
                        </>
                      );
                    })()}
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-xs text-primary font-medium">View →</span>
                    </TableCell>
                  </TableRow>
                ))}
                {results.length === 0 && (
                  <TableRow>
                    {/* 9 columns, not 8 — the old value left the empty state
                        short of the table width. */}
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">No results found</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
