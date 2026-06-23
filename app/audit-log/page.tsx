"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import api from "@/lib/api";

type JsonObj = Record<string, unknown> | null;

interface AuditEntry {
  id: string;
  adminUserId: string | null;
  actorLabel: string;
  action: string;
  targetType: string;
  targetId: string;
  beforeJson: JsonObj;
  afterJson: JsonObj;
  reason: string | null;
  createdAt: string;
  adminUser: { id: string; email: string; name: string; role: string } | null;
}

const PAGE_SIZE = 50;

const ACTIONS = [
  { value: "all", label: "All actions" },
  { value: "credit_pack.update", label: "Pack update" },
  { value: "credit_action_cost.update", label: "Action cost update" },
  { value: "credit.grant", label: "Credit grant" },
];

function diffFields(before: JsonObj, after: JsonObj): Array<{ key: string; before: unknown; after: unknown }> {
  if (!after) return [];
  if (!before) {
    return Object.entries(after).map(([key, value]) => ({ key, before: undefined, after: value }));
  }
  const out: Array<{ key: string; before: unknown; after: unknown }> = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      out.push({ key: k, before: before[k], after: after[k] });
    }
  }
  return out;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("all");
  const [targetId, setTargetId] = useState("");
  const [adminUserId, setAdminUserId] = useState("");
  const [offset, setOffset] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (action !== "all") params.set("action", action);
    if (targetId.trim()) params.set("targetId", targetId.trim());
    if (adminUserId.trim()) params.set("adminUserId", adminUserId.trim());
    api.get(`/audit-log?${params.toString()}`).then((r) => {
      setEntries(r.data.entries);
      setTotal(r.data.total);
      setLoading(false);
    });
  }, [offset, action, targetId, adminUserId]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.floor(offset / PAGE_SIZE);

  return (
    <AdminLayout title="Audit Log">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={action} onValueChange={(v) => { setAction(v ?? "all"); setOffset(0); }}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ACTIONS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            placeholder="Target ID (user / pack / cost)"
            value={targetId}
            onChange={(e) => { setTargetId(e.target.value); setOffset(0); }}
            className="max-w-xs font-mono text-xs"
          />
          <Input
            placeholder="Admin user ID"
            value={adminUserId}
            onChange={(e) => { setAdminUserId(e.target.value); setOffset(0); }}
            className="max-w-xs font-mono text-xs"
          />
          <span className="text-sm text-muted-foreground">{total} entries</span>
        </div>

        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Changes</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No audit entries</TableCell></TableRow>
                  ) : entries.map((e) => {
                    const diffs = diffFields(e.beforeJson, e.afterJson);
                    return (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(e.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-xs">
                          {e.adminUser ? (
                            <div>
                              <div className="font-medium">{e.adminUser.name}</div>
                              <div className="text-muted-foreground">{e.adminUser.email}</div>
                            </div>
                          ) : (
                            <span className="font-mono text-muted-foreground">{e.actorLabel}</span>
                          )}
                        </TableCell>
                        <TableCell><Badge variant="outline" className="font-mono text-xs">{e.action}</Badge></TableCell>
                        <TableCell className="text-xs">
                          <div>{e.targetType}</div>
                          <div className="font-mono text-muted-foreground">{e.targetId.slice(0, 8)}…</div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {diffs.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <div className="flex flex-col gap-0.5">
                              {diffs.map((d) => (
                                <div key={d.key}>
                                  <span className="font-mono">{d.key}:</span>{" "}
                                  {d.before !== undefined && (
                                    <>
                                      <span className="text-red-400 line-through">{fmt(d.before)}</span>{" → "}
                                    </>
                                  )}
                                  <span className="text-green-400">{fmt(d.after)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-xs">{e.reason ?? "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</span>
                <Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
