"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  createdAt: string;
  user: { id: string; whatsappPhone: string; name: string };
  booking: { patientName: string; appointmentDate: string; appointmentTime: string };
  biomarkerValues: {
    biomarkerName: string;
    testCode: string;
    rawValue: string;
    rawUnit: string;
    convertedValue: string;
    convertedUnit: string;
    referenceRange: string;
    indicator: string;
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
          <CardHeader>
            <CardTitle className="capitalize">{result.testType.replace(/_/g, " ")} — {result.user.name ?? result.user.whatsappPhone}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><p className="text-muted-foreground">Bio Age</p><p className="text-xl font-bold">{result.calculatedAge}</p></div>
            <div><p className="text-muted-foreground">Chrono Age</p><p className="text-xl font-bold">{result.chronologicalAge}</p></div>
            <div><p className="text-muted-foreground">Delta</p>
              <p className={`text-xl font-bold ${parseFloat(result.ageDelta) < 0 ? "text-green-400" : "text-red-400"}`}>
                {result.ageDelta}
              </p>
            </div>
            <div><p className="text-muted-foreground">Status</p><div className="mt-1"><StatusBadge status={result.status} /></div></div>
            <div><p className="text-muted-foreground">Formula</p><p>{result.formulaVersion}</p></div>
            <div><p className="text-muted-foreground">Elevated</p><p>{result.elevatedFlag ? "Yes" : "No"}</p></div>
            <div><p className="text-muted-foreground">Date</p><p>{new Date(result.createdAt).toLocaleDateString()}</p></div>
            <div><p className="text-muted-foreground">Patient</p>
              <Link href={`/users/${result.user.id}`} className="text-primary hover:underline">{result.booking.patientName}</Link>
            </div>
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
                      <TableHead>Converted</TableHead>
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
                        <TableCell>{b.convertedValue} {b.convertedUnit}</TableCell>
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
