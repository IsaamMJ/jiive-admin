"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminLayout } from "@/components/AdminLayout";
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

export default function ResultsPage() {
  const router = useRouter();
  const [results, setResults] = useState<Result[]>([]);
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (status !== "all") params.set("status", status);
    api.get(`/results?${params}`).then((r) => { setResults(r.data.results); setLoading(false); });
  }, [status]);

  return (
    <AdminLayout title="Results">
      <div className="flex flex-col gap-4">
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

        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
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
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">No results found</TableCell>
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
