"use client";

import { InfoTip } from "@/components/InfoTip";
import { humanizeEnumValue, TAGS_EXPLAINER, type FeedbackEntry } from "../types";

/**
 * "What people are telling us" — the tag counts, sitting above the feed where the
 * operator cannot miss them. Data entry that never comes back to the person
 * entering it is exactly why logs go unused; this is the reward for logging.
 *
 * v1 counts tags across the LOADED PAGE only (client-side) — simple, honest, and
 * good enough until the volume justifies a server aggregate. The strip says so,
 * so nobody mistakes it for an all-time total.
 */
export function FeedbackTagStrip({ feedback }: { feedback: FeedbackEntry[] }) {
  const counts = new Map<string, number>();
  for (const entry of feedback) {
    for (const tag of entry.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card/60 px-4 py-3">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        What people are telling us
        <InfoTip label={TAGS_EXPLAINER} />
        <span className="ml-1 font-normal normal-case tracking-normal text-muted-foreground/70">
          on this page
        </span>
      </span>
      {tags.length === 0 ? (
        <span className="text-xs text-muted-foreground">
          Nothing tagged on this page yet — themes show up here as feedback gets logged.
        </span>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {tags.map(([tag, count]) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs"
            >
              <span>{humanizeEnumValue(tag)}</span>
              <span className="font-semibold tabular-nums text-foreground">×{count}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
