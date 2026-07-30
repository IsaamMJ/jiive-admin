"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Wand2, Loader2, CheckCircle2, AlertTriangle, XCircle, Pencil, Upload, ChevronDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InfoTip } from "@/components/InfoTip";
import { cn } from "@/lib/utils";
import api from "@/lib/api";
import type { ConvertResponse, PasteTextResponse } from "./types";

/**
 * Paste raw web/journal content → converted Markdown, verified, then ingested
 * through the normal review flow.
 *
 * THE SAFETY PROPERTY: an LLM sits in this ingest path, so a number could be
 * silently altered (19 mg/day → 18). The backend verifies every number in the
 * output traces back to the source and returns `verify.ok`. When that is false
 * the ingest button is DISABLED — not warned about, disabled. Once a wrong value
 * is embedded and cited, it is indistinguishable from a correct one.
 *
 * Conversion persists nothing; ingestion posts the (optionally edited) markdown
 * to the existing paste-text endpoint.
 */
export function ConvertPanel({ onIngested }: { onIngested: () => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [converting, setConverting] = useState(false);
  const [result, setResult] = useState<ConvertResponse | null>(null);

  // The operator can correct the markdown before ingesting. Editing invalidates
  // the backend's verification, so we re-verify rather than trust the old verdict.
  const [markdown, setMarkdown] = useState("");
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState(false);

  const [ingesting, setIngesting] = useState(false);
  const [showDropped, setShowDropped] = useState(false);

  const verify = result?.verify;
  const blocked = !!result && !verify?.ok;
  // An edit invalidates the verdict the backend gave us — re-convert to re-verify
  // rather than let an unverified edit through the gate.
  const ingestDisabled = !result || blocked || edited || ingesting;

  async function handleConvert() {
    if (!content.trim() || !title.trim() || converting) return;
    setConverting(true);
    setResult(null);
    setEdited(false);
    setEditing(false);
    try {
      const r = await api.post<ConvertResponse>("/rag/convert", {
        content: content,
        title: title.trim(),
      });
      setResult(r.data);
      setMarkdown(r.data.markdown);
      if (r.data.verify.ok) toast.success("Converted and verified.");
      else toast.error("Converted, but verification FAILED — ingestion is blocked.");
    } catch (err: unknown) {
      const d = (err as { response?: { data?: { message?: string; error?: string } } })?.response?.data;
      toast.error(d?.message ?? d?.error ?? "Conversion failed.");
    } finally {
      setConverting(false);
    }
  }

  async function handleIngest() {
    if (ingestDisabled) return;
    setIngesting(true);
    try {
      const r = await api.post<PasteTextResponse>("/rag/documents/text", {
        text: markdown,
        title: title.trim(),
      });
      toast.success(`"${r.data.title}" saved — pending review.`);
      setTitle("");
      setContent("");
      setResult(null);
      setMarkdown("");
      onIngested();
    } catch (err: unknown) {
      const d = (err as { response?: { data?: { message?: string } } })?.response?.data;
      toast.error(d?.message ?? "Could not save — check your connection and try again.");
    } finally {
      setIngesting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
          <Wand2 size={14} />
          Convert web content
          <InfoTip label="Paste a copied web page or journal article. An AI restructures it into clean Markdown, then every number in the result is checked against your pasted source. If any number can't be traced back, ingestion is blocked — that check is the whole reason it's safe to let an AI touch clinical text." />
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Paste the page content — it&apos;s converted to Markdown and every number is traced back
          to your source before it can be ingested. Nothing is saved until you ingest.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="convert-title" className="text-xs">Title</Label>
          <Input
            id="convert-title"
            placeholder="ICMR-NIN 2020 Dietary Guidelines"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={converting}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="convert-content" className="text-xs">Pasted content</Label>
          <textarea
            id="convert-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={converting}
            placeholder="Paste the copied page here…"
            className="min-h-32 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          />
          <span className="text-[11px] text-muted-foreground">
            {content.trim() ? `${content.trim().split(/\s+/).length.toLocaleString()} words` : "—"}
          </span>
        </div>

        <Button
          className="self-start gap-1.5"
          disabled={!content.trim() || !title.trim() || converting}
          onClick={handleConvert}
        >
          {converting ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
          {converting ? "Converting…" : "Convert"}
        </Button>

        {result && verify && (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            {/* ── The verdict. This is the safety gate, so it leads. ───────── */}
            {verify.ok ? (
              <div className="flex items-start gap-2 rounded-lg border border-green-500/30 bg-green-500/10 p-3">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-green-500" />
                <div className="text-xs">
                  <p className="font-medium text-green-600 dark:text-green-400">
                    Numbers verified — all {verify.stats.numbersInOutput} traced to your source
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    {verify.stats.numbersInSource} numbers in source · {verify.stats.sections} sections ·{" "}
                    {verify.stats.sourceWords.toLocaleString()} → {verify.stats.outputWords.toLocaleString()} words
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
                <XCircle size={16} className="mt-0.5 shrink-0 text-destructive" />
                <div className="text-xs">
                  <p className="font-semibold text-destructive">
                    REJECTED — this cannot be ingested
                  </p>
                  {verify.stats.fabricatedNumbers.length > 0 && (
                    <p className="mt-1 text-muted-foreground">
                      {verify.stats.fabricatedNumbers.length} number
                      {verify.stats.fabricatedNumbers.length !== 1 ? "s" : ""} in the output{" "}
                      {verify.stats.fabricatedNumbers.length !== 1 ? "are" : "is"} not in your source:{" "}
                      <span className="font-mono font-medium text-destructive">
                        {verify.stats.fabricatedNumbers.join(", ")}
                      </span>
                    </p>
                  )}
                  {verify.errors.map((e, i) => (
                    <p key={i} className="mt-1 text-muted-foreground">{e}</p>
                  ))}
                  <p className="mt-1.5 text-muted-foreground">
                    Nothing was saved. Re-copy the source, or edit the markdown and convert again.
                  </p>
                </div>
              </div>
            )}

            {verify.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
                {verify.warnings.map((w, i) => (
                  <p key={i} className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />{w}
                  </p>
                ))}
              </div>
            )}

            {/* ── What the cleanup did (proves junk removal happened) ──────── */}
            <div className="grid gap-1.5 text-[11px] text-muted-foreground sm:grid-cols-2">
              <p>
                <span className="font-medium text-foreground">Cleanup:</span>{" "}
                {result.cleanup.preRemovedLines + result.cleanup.postRemovedLines} lines removed
                {[...result.cleanup.preRemovedSections, ...result.cleanup.postRemovedSections].length > 0 &&
                  ` (${[...result.cleanup.preRemovedSections, ...result.cleanup.postRemovedSections].join(", ")})`}
              </p>
              <p>
                <span className="font-medium text-foreground">Structure:</span>{" "}
                {result.sectionsFound} sections · {result.tablesSkipped} table
                {result.tablesSkipped !== 1 ? "s" : ""} held out of prose
              </p>
            </div>

            {/* ── Dropped fragments — truncation must never be silent ──────── */}
            {result.dropped.length > 0 && (
              <div className="rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => setShowDropped((v) => !v)}
                  className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] text-muted-foreground"
                >
                  <AlertTriangle size={12} className="shrink-0 text-amber-500" />
                  {result.dropped.length} fragment{result.dropped.length !== 1 ? "s" : ""} dropped — check nothing important was lost
                  <ChevronDown size={12} className={cn("ml-auto transition-transform", showDropped && "rotate-180")} />
                </button>
                {showDropped && (
                  <div className="flex flex-col gap-1.5 border-t border-border px-3 py-2">
                    {result.dropped.map((d, i) => (
                      <div key={i} className="text-[11px]">
                        <span className="font-medium">{d.source}</span>{" "}
                        <span className="text-muted-foreground">({d.words}w)</span>
                        <p className="truncate text-muted-foreground">{d.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Chunk preview: exactly what would be embedded ────────────── */}
            <div>
              <p className="mb-1.5 text-xs font-medium">
                Will create {result.chunks.length} chunk{result.chunks.length !== 1 ? "s" : ""}
              </p>
              <div className="max-h-44 overflow-y-auto rounded-lg border border-border">
                {result.chunks.map((c) => (
                  <div key={c.chunkIndex} className="border-b border-border px-3 py-1.5 text-[11px] last:border-0">
                    <span className="tabular-nums text-muted-foreground">
                      {String(c.chunkIndex + 1).padStart(2, " ")}.
                    </span>{" "}
                    <span className="tabular-nums text-muted-foreground">
                      {c.text.trim().split(/\s+/).length}w
                    </span>{" "}
                    <span className="text-foreground">{c.source}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Edit + ingest ───────────────────────────────────────────── */}
            {editing && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="convert-md" className="text-xs">Markdown</Label>
                <textarea
                  id="convert-md"
                  value={markdown}
                  onChange={(e) => { setMarkdown(e.target.value); setEdited(true); }}
                  className="min-h-48 w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            )}

            {edited && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                You edited the markdown, so the verification above no longer applies. Convert again to
                re-check the numbers before ingesting.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditing((v) => !v)}>
                <Pencil size={13} />
                {editing ? "Hide markdown" : "Edit markdown"}
              </Button>
              <Button size="sm" className="gap-1.5" disabled={ingestDisabled} onClick={handleIngest}>
                {ingesting ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                {ingesting ? "Ingesting…" : "Ingest → review"}
              </Button>
              {blocked && (
                <span className="text-[11px] text-destructive">
                  Blocked: numbers in the output don&apos;t trace to the source.
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
