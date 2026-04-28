"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import api from "@/lib/api";

type Range = "1h" | "6h" | "24h" | "7d" | "30d";
const RANGES: Range[] = ["1h", "6h", "24h", "7d", "30d"];
const STORAGE_KEY = "jiive-admin:usage-range";
const REFRESH_MS = 60_000;
const STALE_MIN = 30;

interface UsageWindow {
  rangeHours: number;
  totalCalls: number;
  costUsd: number;
  fallbackRate: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  errorRate: number;
  callsByModel: Record<string, number>;
  callsByName: Record<string, number>;
  lastCallAt: string | null;
}

interface UsageResponse extends UsageWindow {
  enabled: boolean;
  reason?: string;
  previous?: UsageWindow;
  source?: string;
  cachedAt?: string;
}

// ---------- format helpers ----------

function formatCost(usd: number): string {
  if (usd < 0.01) return "<$0.01";
  if (usd < 1) return `$${usd.toFixed(4)}`;
  if (usd < 1000) return `$${usd.toFixed(2)}`;
  return `$${(usd / 1000).toFixed(1)}k`;
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Math.max(0, Date.now() - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec} sec ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

function isStale(iso: string | null): boolean {
  if (!iso) return false;
  const ageMin = (Date.now() - new Date(iso).getTime()) / 60_000;
  return ageMin > STALE_MIN;
}

function deltaLabel(current: number, previous: number | undefined, fmt: (n: number) => string) {
  if (previous === undefined) return null;
  const diff = current - previous;
  const arrow = diff > 0 ? "↑" : diff < 0 ? "↓" : "·";
  const color =
    diff > 0
      ? "text-amber-400"
      : diff < 0
      ? "text-green-400"
      : "text-muted-foreground";
  return (
    <span className={`text-xs ${color}`}>
      {arrow} vs prev {fmt(previous)}
    </span>
  );
}

// ---------- range picker ----------

function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="inline-flex rounded-md border border-foreground/10 overflow-hidden text-xs">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={`px-3 py-1.5 transition-colors ${
            value === r
              ? "bg-primary text-primary-foreground"
              : "bg-card hover:bg-accent text-muted-foreground"
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

// ---------- widgets ----------

function MetricCard({
  title,
  value,
  delta,
  banner,
}: {
  title: string;
  value: string;
  delta?: React.ReactNode;
  banner?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {banner}
        <p className="text-3xl font-bold">{value}</p>
        {delta}
      </CardContent>
    </Card>
  );
}

function BreakdownCard({
  title,
  data,
}: {
  title: string;
  data: Record<string, number>;
}) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">No calls in range.</p>
        ) : (
          <div className="flex flex-col gap-2 text-xs">
            {entries.map(([name, count]) => {
              const pct = total === 0 ? 0 : (count / total) * 100;
              return (
                <div key={name}>
                  <div className="flex items-center justify-between gap-2">
                    <code className="font-mono truncate" title={name}>
                      {name}
                    </code>
                    <span className="tabular-nums text-muted-foreground">
                      {formatNumber(count)} · {pct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1 mt-1 w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- page ----------

export default function UsagePage() {
  const [range, setRange] = useState<Range>("24h");
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // hydrate range from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Range | null;
      if (stored && RANGES.includes(stored)) setRange(stored);
    } catch {
      // ignore
    }
  }, []);

  const onRangeChange = useCallback((r: Range) => {
    setRange(r);
    try {
      localStorage.setItem(STORAGE_KEY, r);
    } catch {
      // ignore
    }
  }, []);

  const fetchData = useCallback(() => {
    api
      .get<UsageResponse>(`/ai/usage?range=${range}&compare=previous`)
      .then((r) => {
        setData(r.data);
        setError(null);
        setLastUpdated(new Date());
      })
      .catch((e) => setError(e?.message ?? "Failed to load usage data"))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const id = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  const stale = data?.enabled && isStale(data.lastCallAt) && data.totalCalls > 0;
  const heartbeatStatus =
    !data?.enabled
      ? "disabled"
      : !data.lastCallAt
      ? "idle"
      : stale
      ? "stale"
      : "active";

  return (
    <AdminLayout title="Usage">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <p className="text-xs text-muted-foreground">
            AI traffic, cost and reliability — sourced from Langfuse, cached 60s.
          </p>
          {lastUpdated && (
            <p className="text-xs text-muted-foreground">
              Last updated {lastUpdated.toLocaleTimeString()} · auto-refreshes every 60s
            </p>
          )}
        </div>
        <RangePicker value={range} onChange={onRangeChange} />
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          <p className="mb-2">Failed to load usage data: {error}</p>
          <Button size="sm" variant="outline" onClick={fetchData}>
            Retry
          </Button>
        </div>
      ) : data && !data.enabled ? (
        <div className="rounded-md border border-slate-500/30 bg-slate-500/10 p-4 text-sm text-slate-400">
          Langfuse not configured. {data.reason ?? "Check backend env vars."}
        </div>
      ) : data ? (
        <div className="flex flex-col gap-6">
          {stale && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
              🔴 AI traffic stalled — last call was{" "}
              <strong>{formatRelative(data.lastCallAt)}</strong>. Check the chat service health.
            </div>
          )}
          {data.enabled && data.fallbackRate > 0.25 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
              ⚠️ High fallback rate: {formatPercent(data.fallbackRate)} of requests fell back to
              OpenAI. Primary endpoint may be degraded.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title={`Spend (${range})`}
              value={formatCost(data.costUsd)}
              delta={deltaLabel(data.costUsd, data.previous?.costUsd, formatCost)}
            />
            <MetricCard
              title={`Requests (${range})`}
              value={formatNumber(data.totalCalls)}
              delta={deltaLabel(data.totalCalls, data.previous?.totalCalls, formatNumber)}
            />
            <MetricCard
              title="Fallback rate"
              value={formatPercent(data.fallbackRate)}
              delta={deltaLabel(
                data.fallbackRate,
                data.previous?.fallbackRate,
                formatPercent
              )}
            />
            <MetricCard
              title="Last AI response"
              value={
                heartbeatStatus === "idle"
                  ? "No traffic yet"
                  : formatRelative(data.lastCallAt)
              }
              delta={
                <Badge
                  variant="outline"
                  className={
                    heartbeatStatus === "active"
                      ? "bg-green-500/20 text-green-400 border-green-500/30"
                      : heartbeatStatus === "stale"
                      ? "bg-red-500/20 text-red-400 border-red-500/30"
                      : "bg-slate-500/20 text-slate-400 border-slate-500/30"
                  }
                >
                  {heartbeatStatus === "active"
                    ? "Active"
                    : heartbeatStatus === "stale"
                    ? "Stalled"
                    : "Idle"}
                </Badge>
              }
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Latency (p50 / p95)
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                <p className="text-2xl font-bold">
                  {data.p50LatencyMs} <span className="text-base text-muted-foreground">ms</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  p95 {formatNumber(data.p95LatencyMs)} ms · avg{" "}
                  {formatNumber(data.avgLatencyMs)} ms
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Error rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatPercent(data.errorRate)}</p>
                {deltaLabel(data.errorRate, data.previous?.errorRate, formatPercent)}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Source
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground flex flex-col gap-1">
                <p>
                  Backend: <code className="font-mono">{data.source ?? "langfuse"}</code>
                </p>
                {data.cachedAt && (
                  <p>Cached at {new Date(data.cachedAt).toLocaleTimeString()}</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <BreakdownCard title="Calls by model" data={data.callsByModel} />
            <BreakdownCard title="Calls by name" data={data.callsByName} />
          </div>
        </div>
      ) : null}
    </AdminLayout>
  );
}
