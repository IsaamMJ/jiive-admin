"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import api from "@/lib/api";

// ---------- types ----------

interface GraphStats {
  enabled: boolean;
  nodes: number;
  relationships: number;
  labels: string[];
}

interface RagSource {
  name: string;
  chunks: number;
  lastIndexed: string | null;
}

interface RagOverview {
  collection: string;
  totalChunks: number;
  vectorDim: number;
  embeddingModel: string;
  sources: RagSource[];
  qdrantStatus: "healthy" | "degraded" | "down";
}

type AiStatus = "healthy" | "cold" | "degraded" | "down";

interface AiModelInfo {
  provider: "huggingface" | "openai" | "ec2";
  model: string;
  endpointUrl: string | null;
  status: AiStatus;
  lastPingMs: number | null;
  lastPingAt: string | null;
  fallbackProvider: string;
  fallbackModel: string;
}

// ---------- helpers ----------

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

function statusPillClass(status: string): string {
  switch (status) {
    case "healthy":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    case "cold":
    case "degraded":
      return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    case "down":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    default:
      return "bg-slate-500/20 text-slate-400 border-slate-500/30";
  }
}

function providerPillClass(provider: string): string {
  switch (provider) {
    case "huggingface":
      return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "openai":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    case "ec2":
      return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    default:
      return "bg-slate-500/20 text-slate-400 border-slate-500/30";
  }
}

// Generic polling hook
function usePolling<T>(path: string, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOnce = useCallback(() => {
    api
      .get<T>(path)
      .then((r) => {
        setData(r.data);
        setError(null);
      })
      .catch((e) => {
        setError(e?.message ?? "Request failed");
      })
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => {
    fetchOnce();
    const id = setInterval(fetchOnce, intervalMs);
    return () => clearInterval(id);
  }, [fetchOnce, intervalMs]);

  return { data, loading, error, refetch: fetchOnce };
}

// ---------- shared bits ----------

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
      <span>Failed to load.</span>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-1">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-10 w-24" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}

// ---------- Widget 1: Knowledge Graph ----------

const NEO4J_FREE_TIER_NODES = 50_000;

function KnowledgeGraphWidget() {
  const { data, loading, error, refetch } = usePolling<GraphStats>("/graph/stats", 5 * 60_000);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Knowledge Graph</CardTitle>
          <Badge variant="outline" className="bg-slate-500/10 text-slate-400 border-slate-500/30">
            Neo4j Aura
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading ? (
          <CardSkeleton />
        ) : error ? (
          <ErrorState onRetry={refetch} />
        ) : !data ? null : !data.enabled ? (
          <div className="rounded-md border border-slate-500/30 bg-slate-500/10 p-3 text-xs text-slate-400">
            Graph disabled — check <code className="font-mono">NEO4J_URI</code> env var
          </div>
        ) : (
          <>
            {data.nodes >= 40_000 && (
              <div className="rounded-md border border-orange-500/30 bg-orange-500/10 p-2 text-xs text-orange-400">
                Approaching free tier limit, consider upgrading to Pro
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Nodes</p>
                <p className="text-2xl font-bold">{data.nodes.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Relationships</p>
                <p className="text-2xl font-bold">{data.relationships.toLocaleString()}</p>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>Free tier usage</span>
                <span>
                  {((data.nodes / NEO4J_FREE_TIER_NODES) * 100).toFixed(2)}% of free tier
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${Math.min(100, (data.nodes / NEO4J_FREE_TIER_NODES) * 100)}%`,
                  }}
                />
              </div>
            </div>
            {data.labels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {data.labels.map((label) => (
                  <Badge key={label} variant="secondary" className="text-xs">
                    {label}
                  </Badge>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Widget 2: RAG Knowledge Base ----------

function RagWidget() {
  const { data, loading, error, refetch } = usePolling<RagOverview>("/rag/overview", 60_000);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>RAG Knowledge Base</CardTitle>
          {data && (
            <Badge variant="outline" className={statusPillClass(data.qdrantStatus)}>
              {data.qdrantStatus}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading ? (
          <CardSkeleton />
        ) : error ? (
          <ErrorState onRetry={refetch} />
        ) : !data ? null : (
          <>
            {data.qdrantStatus === "down" && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400">
                Qdrant unreachable — health checks failing
              </div>
            )}
            <div>
              <p className="text-3xl font-bold">{data.totalChunks.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">
                indexed chunks across {data.sources.length} document
                {data.sources.length === 1 ? "" : "s"}
              </p>
            </div>

            {data.totalChunks === 0 ? (
              <div className="rounded-md border border-slate-500/30 bg-slate-500/10 p-3 text-xs text-slate-400">
                No documents indexed. Run the ingestion script.
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border border-foreground/10">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Source</th>
                      <th className="px-3 py-2 text-right font-medium">Chunks</th>
                      <th className="px-3 py-2 text-right font-medium">Last indexed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.sources]
                      .sort((a, b) => b.chunks - a.chunks)
                      .map((s) => (
                        <tr key={s.name} className="border-t border-foreground/10">
                          <td
                            className="px-3 py-2 max-w-[180px] truncate"
                            title={s.name}
                          >
                            {s.name}
                          </td>
                          <td className="px-3 py-2 text-right">{s.chunks}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">
                            {s.lastIndexed ? formatRelative(s.lastIndexed) : "Unknown"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
      {data && (
        <CardFooter className="text-xs text-muted-foreground">
          Embedding: <code className="font-mono mx-1">{data.embeddingModel}</code> · Vector dim:{" "}
          {data.vectorDim}
        </CardFooter>
      )}
    </Card>
  );
}

// ---------- Widget 3: AI Model ----------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="text-xs text-primary hover:underline"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

function AiModelWidget() {
  const [data, setData] = useState<AiModelInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tookMs, setTookMs] = useState<number | null>(null);

  const ping = useCallback(() => {
    setLoading(true);
    setError(null);
    const start = performance.now();
    api
      .get<AiModelInfo>("/ai/model-info")
      .then((r) => {
        setData(r.data);
        setTookMs(Math.round(performance.now() - start));
      })
      .catch((e) => setError(e?.message ?? "Request failed"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>AI Model</CardTitle>
          {data && (
            <Badge variant="outline" className={statusPillClass(data.status)}>
              {data.status}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
          <span className="text-muted-foreground">
            Manual check — each ping uses HuggingFace compute.
          </span>
          <Button size="sm" variant="outline" onClick={ping} disabled={loading}>
            {loading ? "Pinging…" : data ? "Ping again" : "Check now"}
          </Button>
        </div>

        {tookMs !== null && !loading && (
          <p className="text-xs text-muted-foreground">
            Last ping took <span className="font-medium text-foreground">{tookMs} ms</span>
            {data?.lastPingMs !== null && data?.lastPingMs !== undefined && (
              <> · server-measured: {data.lastPingMs} ms</>
            )}
          </p>
        )}

        {loading && !data ? (
          <CardSkeleton />
        ) : error ? (
          <ErrorState onRetry={ping} />
        ) : !data ? (
          <p className="text-xs text-muted-foreground">
            No status loaded yet. Click <em>Check now</em> to ping the endpoint. Cold starts can
            take 30–60s.
          </p>
        ) : (
          <>
            {data.status === "cold" && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-400">
                ⚠️ Endpoint warming up — first request may take 30–60s. Auto-falls back to OpenAI on
                retry exhaustion.
              </div>
            )}
            {data.status === "down" && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400">
                🔴 Currently using OpenAI fallback
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Badge variant="outline" className={`w-fit capitalize ${providerPillClass(data.provider)}`}>
                  {data.provider}
                </Badge>
                <code className="font-mono text-xs break-all">{data.model}</code>
                {data.endpointUrl && (
                  <div className="flex items-center gap-2">
                    <code
                      className="font-mono text-[10px] text-muted-foreground truncate max-w-[160px]"
                      title={data.endpointUrl}
                    >
                      {data.endpointUrl}
                    </code>
                    <CopyButton text={data.endpointUrl} />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Fallback: {data.fallbackProvider} / {data.fallbackModel}
                </p>
              </div>

              <div className="flex flex-col gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Latency</p>
                  <p className="text-base font-medium">
                    {data.lastPingMs !== null ? `${data.lastPingMs} ms` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Last checked</p>
                  <p>{formatRelative(data.lastPingAt)}</p>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- exported section ----------

export function AiKnowledgeSection() {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">AI &amp; Knowledge Layer</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KnowledgeGraphWidget />
        <RagWidget />
        <AiModelWidget />
      </div>
    </section>
  );
}
