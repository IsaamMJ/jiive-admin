"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoTip } from "@/components/InfoTip";
import { cn } from "@/lib/utils";
import { exportFeedback, feedbackErrorMessage } from "../api";
import { EXPORT_PII_EXPLAINER, type ExportParams } from "../types";

type Range = "all" | "30d" | "custom";

/** YYYY-MM-DD in the user's timezone, N days ago (0 = today). */
function localDate(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The [Export] control. A small popover: date range (All / Last 30 days /
 * Custom), an "Exclude names & phones" checkbox that is CHECKED BY DEFAULT
 * (health-adjacent data goes to an external AI — themes don't need names), and a
 * Download CSV button.
 *
 * The download is fetched as a blob through the axios client so the bearer token
 * is attached (a plain <a href> would 401), then handed to the browser via a
 * temporary object URL that is revoked immediately after.
 */
export function ExportMenu() {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<Range>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [excludePii, setExcludePii] = useState(true);
  const [downloading, setDownloading] = useState(false);

  function resolveParams(): ExportParams {
    const params: ExportParams = { includePii: !excludePii };
    if (range === "30d") {
      params.from = localDate(30);
      params.to = localDate(0);
    } else if (range === "custom") {
      if (from) params.from = from;
      if (to) params.to = to;
    }
    return params;
  }

  async function download() {
    if (downloading) return;
    setDownloading(true);
    try {
      const { blob, filename } = await exportFeedback(resolveParams());
      // Create → click → revoke, all here so the object URL never leaks.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
      setOpen(false);
    } catch (err) {
      toast.error(feedbackErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Download size={14} className="mr-1.5" />
        Export
      </Button>

      {open && (
        <>
          {/* Click-catcher — closes the popover on any outside tap. */}
          <button
            type="button"
            aria-label="Close export menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Date range
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {([
                    ["all", "All"],
                    ["30d", "Last 30d"],
                    ["custom", "Custom"],
                  ] as Array<[Range, string]>).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={range === value}
                      onClick={() => setRange(value)}
                      className={cn(
                        "min-h-9 rounded-lg border px-2 text-xs font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        range === value
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border text-muted-foreground hover:bg-accent"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {range === "custom" && (
                <div className="flex flex-col gap-1.5">
                  <Input
                    type="date"
                    aria-label="Export from"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="text-sm"
                  />
                  <Input
                    type="date"
                    aria-label="Export to"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="text-sm"
                  />
                </div>
              )}

              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-card/60 px-2.5 py-2">
                <input
                  type="checkbox"
                  checked={excludePii}
                  onChange={(e) => setExcludePii(e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                <span className="flex flex-col">
                  <span className="flex items-center gap-1.5 text-xs font-medium">
                    Exclude names &amp; phones
                    <InfoTip label={EXPORT_PII_EXPLAINER} />
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    On by default — the export is fed to an AI.
                  </span>
                </span>
              </label>

              <Button size="sm" disabled={downloading} onClick={() => void download()}>
                {downloading ? (
                  <><Loader2 size={14} className="mr-1.5 animate-spin" />Preparing…</>
                ) : (
                  <><Download size={14} className="mr-1.5" />Download CSV</>
                )}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
