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
  // Flat, backend-computed "who is this result for" fields (backend handoff shipped —
  // the userId-only workaround below is now removed). Prefer these over
  // booking.patientName: booking can be null, and the backend is moving this data off it.
  //
  // THE TRAP: `patientId` is absence-as-signal, not absence-as-unknown. It's present when
  // the patient is a FamilyMember, and ABSENT when the patient IS the account holder
  // (relationship "self"). Verified live on prod:
  //   result 13b6bc3c-b19e-495e-8fc6-129da5b1dc07: patientName "Hafsah Abdulhameed",
  //     relationship "sibling", patientId "7b757eca-558c-4afc-9d49-19068cca1205"
  //   another prod result: patientName "Fareetha Rafi", relationship "self", patientId ABSENT
  //
  // Dev is NOT in lockstep with prod: dev returns neither field on this endpoint at all.
  // So there are three states, not two — see classifyPatientState() below, which is the
  // single place that turns (patientId, relationship) into a meaning.
  patientName?: string | null;
  patientId?: string | null;
  relationship?: string | null;
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

type PatientState =
  | { kind: "family"; patientId: string } // a FamilyMember other than the account holder
  | { kind: "self" } // patientId absent, relationship confirms it's the account holder
  | { kind: "unknown" }; // neither field present — dev backend, or a pre-handoff prod row

/**
 * Turn (patientId, relationship) into one of three meanings. Do NOT collapse "self" and
 * "unknown" into one "no id" case — they mean different things (see the patientId comment
 * on ResultDetail above for the live-prod evidence of that trap).
 */
function classifyPatientState(result: Pick<ResultDetail, "patientId" | "relationship">): PatientState {
  if (result.patientId) return { kind: "family", patientId: result.patientId };
  if (result.relationship?.trim().toLowerCase() === "self") return { kind: "self" };
  return { kind: "unknown" };
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

  // WHO this result belongs to. Computed once — the header (title + badge + AI button)
  // and the Patient cell below both need the same classification.
  const subjectName = result.patientName?.trim() || result.booking?.patientName?.trim() || null;
  const accountName = result.user.name ?? result.user.whatsappPhone;
  const patientState = classifyPatientState(result);
  const isDifferentFromAccount = patientState.kind === "family"
    ? true
    : patientState.kind === "self"
      ? false
      // No relationship signal at all (dev backend, or a pre-handoff prod row) — fall back
      // to a raw name comparison. That's a guess, not a fact: live prod showed
      // "ishaaq m j" (account) vs "Ishaaq" (patient) false-positive here on sloppy name
      // entry, which `relationship` now answers exactly for every row that has it.
      : subjectName !== null && subjectName !== accountName;

  return (
    <AdminLayout title="Result Detail">
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              {/* Title must name the PATIENT, not the account holder — a booking can be for
                  a family member, and this is their blood result. Prefer the flat
                  `patientName` field (backend handoff — see the ResultDetail.patientName
                  comment above); fall back to booking.patientName for older shapes. Both can
                  be absent (booking null + pre-handoff prod/dev) — fall back to an explicit
                  label instead of crashing or silently showing the account name as if it
                  were the patient. */}
              <CardTitle className="capitalize">
                {result.testType.replace(/_/g, " ")} — {subjectName ?? "Uploaded report (no booking)"}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <p className="text-xs text-muted-foreground">Account: {accountName}</p>
                {isDifferentFromAccount && (
                  <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-400">
                    Different from patient
                  </Badge>
                )}
                {!subjectName && (
                  <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-400">
                    Patient identity unconfirmed
                  </Badge>
                )}
              </div>
            </div>
            <Link href={
              patientState.kind === "family"
                ? `/playground?patientId=${patientState.patientId}`
                : `/playground?userId=${result.user.id}`
            }>
              <Button size="sm" variant="outline" className="gap-1.5 shrink-0">
                <Sparkles size={14} />
                {/* Only claim patient scope when we have a real FamilyMember id ("family").
                    For "self" and "unknown" there's no patient id to scope to — the account
                    link is what's actually being followed, so say that instead of
                    overclaiming (patientId wins over userId in the playground — see
                    app/playground/page.tsx's deep-link effect). */}
                {patientState.kind === "family" ? "Ask AI about this patient" : "Ask AI about this account"}
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
              // So: only show these values once the pipeline actually finished. This gate is
              // PERMANENT, not a stopgap — backend's fix for the underlying default
              // (their item 7) is filed but not shipped; elevatedFlag is still non-nullable
              // and failed rows still get chronologicalAge 0. Don't remove this gate when
              // that lands unless the backend contract itself changes.
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
                    {subjectName ? (
                      <>
                        <p className="font-medium">
                          {subjectName}
                          {/* Relationship only when it adds something: "family" is the one
                              state where it's new information ("self" would just repeat the
                              account name; "unknown" has no relationship to show). Mirrors
                              PatientCell in app/users/[id]/page.tsx. */}
                          {patientState.kind === "family" && result.relationship && (
                            <span className="text-xs capitalize text-muted-foreground"> · {result.relationship.trim()}</span>
                          )}
                        </p>
                        {/* Always links to the account — this admin has no standalone patient
                            profile page, only the playground supports patient-scoped context
                            (the Ask AI button above). The account page still shows every
                            booking/result for the household, including this patient's. */}
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
