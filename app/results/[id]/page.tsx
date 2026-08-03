"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import api from "@/lib/api";

interface ResultDetail {
  id: string;
  testType: string;
  calculatedAge: string;
  chronologicalAge: string;
  ageDelta: string;
  status: string;
  elevatedFlag: boolean;
  overflowCapped: boolean;
  formulaVersion: string;
  // Only meaningful when status === "failed" — see saveFailedResult in
  // results-pipeline.service.ts. Null on completed/pending results.
  failureReason: string | null;
  retestReminderOptIn: boolean;
  retestReminderSentAt: string | null;
  createdAt: string;
  user: { id: string; whatsappPhone: string; name: string };
  // Nullable: Result.bookingId is nullable (prisma/schema.prisma:273) and the WhatsApp
  // report-upload path creates Results with no booking at all
  // (report-parser.service.ts:423-435). Every dereference below must handle null —
  // there is no error.tsx under app/, so an unguarded access here white-screens.
  booking: { patientName: string; appointmentDate: string; appointmentTime: string } | null;
  biomarkerValues: {
    biomarkerName: string;
    testCode: string;
    rawValue: string;
    rawUnit: string;
    convertedValue: string | null;
    convertedUnit: string | null;
    referenceRange: string | null;
    indicator: string | null;
    validationStatus: string;
  }[];
  aiSuggestions: { text: string; category: string; urgency: string }[];
  resultTokens: { token: string; expiresAt: string; viewCount: number }[];
}

export default function ResultDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [result, setResult] = useState<ResultDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/results/${id}`).then((r) => { setResult(r.data.result); setLoading(false); });
  }, [id]);

  if (loading) return (
    <AdminLayout title="Result Detail">
      <div className="flex flex-col gap-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
      </div>
    </AdminLayout>
  );

  if (!result) return (
    <AdminLayout title="Result Detail">
      <p className="text-muted-foreground">Result not found.</p>
    </AdminLayout>
  );

  return (
    <AdminLayout title="Result Detail">
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              {/* Title must name the PATIENT, not the account holder — a booking can be for
                  a family member, and this is their blood result. Live proof: result
                  13b6bc3c-b19e-495e-8fc6-129da5b1dc07 showed "Zahrah Abdulhameed" here while
                  the Patient cell correctly showed "Hafsah Abdulhameed" (2 of 15 live results
                  mismatch). booking can be null — fall back to an explicit label instead of
                  crashing or silently showing the account name as if it were the patient. */}
              <CardTitle className="capitalize">
                {result.testType.replace(/_/g, " ")} — {result.booking ? result.booking.patientName : "Uploaded report (no booking)"}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <p className="text-xs text-muted-foreground">Account: {result.user.name ?? result.user.whatsappPhone}</p>
                {result.booking && result.booking.patientName !== (result.user.name ?? result.user.whatsappPhone) && (
                  <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-400">
                    Different from patient
                  </Badge>
                )}
                {!result.booking && (
                  <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-400">
                    Patient identity unconfirmed
                  </Badge>
                )}
              </div>
            </div>
            <Link href={`/playground?userId=${result.user.id}`}>
              <Button size="sm" variant="outline" className="gap-1.5 shrink-0">
                <Sparkles size={14} />
                {/* Account-scoped, not patient-scoped: GET /results/:id doesn't return a
                    patientId yet (see backend handoff), so don't claim patient-level scope. */}
                Ask AI about this account
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            {(() => {
              // An absent signal is never a positive assurance. saveFailedResult
              // (results-pipeline.service.ts:628-650) writes FAILED rows with
              // chronologicalAge: 0 and never sets elevatedFlag, so it silently
              // defaults to false (elevatedFlag is non-nullable — schema.prisma:289).
              // Rendered raw, that reads as a real clinical all-clear it never computed.
              // So: only show these values once the pipeline actually finished.
              const isCompleted = result.status === "completed";
              const delta = isCompleted && result.ageDelta != null ? parseFloat(result.ageDelta) : NaN;
              return (
                <>
                  <div><p className="text-muted-foreground">Bio Age</p>
                    <p className="text-xl font-bold">{isCompleted ? result.calculatedAge : "—"}</p>
                  </div>
                  <div><p className="text-muted-foreground">Chrono Age</p>
                    <p className="text-xl font-bold">{isCompleted ? result.chronologicalAge : "—"}</p>
                  </div>
                  <div><p className="text-muted-foreground">Delta</p>
                    <p className={`text-xl font-bold ${Number.isFinite(delta) ? (delta < 0 ? "text-green-400" : "text-red-400") : ""}`}>
                      {isCompleted ? result.ageDelta : "—"}
                    </p>
                  </div>
                  <div><p className="text-muted-foreground">Status</p><div className="mt-1"><StatusBadge status={result.status} /></div></div>
                  <div><p className="text-muted-foreground">Formula</p><p>{result.formulaVersion}</p></div>
                  <div><p className="text-muted-foreground">Elevated</p>
                    <p>{isCompleted ? (result.elevatedFlag ? "Yes" : "No") : "Not evaluated"}</p>
                  </div>
                  <div><p className="text-muted-foreground">Date</p><p>{new Date(result.createdAt).toLocaleDateString()}</p></div>
                  <div><p className="text-muted-foreground">Patient</p>
                    {result.booking ? (
                      <>
                        <p className="font-medium">{result.booking.patientName}</p>
                        {/* Links to the ACCOUNT, not a patient page — no patientId to link
                            to yet, so say what the link actually goes to. */}
                        <Link href={`/users/${result.user.id}`} className="text-xs text-primary hover:underline">
                          View account →
                        </Link>
                      </>
                    ) : (
                      <p className="text-muted-foreground">Uploaded report — no booking</p>
                    )}
                  </div>
                  <div><p className="text-muted-foreground">Retest reminder</p>
                    {result.retestReminderSentAt ? (
                      <p className="text-green-400">Sent {new Date(result.retestReminderSentAt).toLocaleDateString()}</p>
                    ) : result.retestReminderOptIn ? (
                      <p className="text-blue-400">Opted in</p>
                    ) : (
                      <p className="text-muted-foreground">—</p>
                    )}
                  </div>
                  {!isCompleted && result.failureReason && (
                    <div className="col-span-2 md:col-span-4">
                      <p className="text-muted-foreground">Failure reason</p>
                      <p className="text-red-400">{result.failureReason}</p>
                    </div>
                  )}
                </>
              );
            })()}
          </CardContent>
        </Card>

        {result.biomarkerValues.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Biomarkers</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Biomarker</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Raw Value</TableHead>
                      <TableHead>Reference Range</TableHead>
                      <TableHead>Indicator</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.biomarkerValues.map((b, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{b.biomarkerName}</TableCell>
                        <TableCell className="font-mono text-xs">{b.testCode}</TableCell>
                        <TableCell>{b.rawValue} {b.rawUnit}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{b.referenceRange}</TableCell>
                        <TableCell><StatusBadge status={b.indicator} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {result.aiSuggestions.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">AI Suggestions</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3">
              {result.aiSuggestions.map((s, i) => (
                <div key={i} className="flex flex-col gap-1 border-l-2 border-primary pl-3">
                  <div className="flex gap-2">
                    <Badge variant="outline" className="capitalize text-xs">{s.category}</Badge>
                    <Badge variant="outline" className="capitalize text-xs">{s.urgency}</Badge>
                  </div>
                  <p className="text-sm">{s.text}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {result.resultTokens.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Result Tokens</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Token</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">Views</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.resultTokens.map((t, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{t.token}</TableCell>
                      <TableCell className="text-xs">{new Date(t.expiresAt).toLocaleString()}</TableCell>
                      <TableCell className="text-right">{t.viewCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}
