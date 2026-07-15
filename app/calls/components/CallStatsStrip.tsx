"use client";

import { InfoTip } from "@/components/InfoTip";
import { Skeleton } from "@/components/ui/skeleton";
import { humanizeEnumValue, TOP2BOX_EXPLAINER, type CallStats } from "../types";

/**
 * The read side, sitting above the queue where the caller cannot miss it.
 *
 * Per the proposal this is not decoration: data entry that never comes back to
 * the person entering it is exactly why CRMs go unused. The tag counts are RAW
 * COUNTS ("phlebo-late ×7"), not percentages — more honest, more actionable, and
 * the artefact that goes to Thyrocare.
 *
 * A failed stats call must never take the queue down with it: the strip renders
 * a single quiet line and the queue below carries on. Ringing the next person is
 * the job; the numbers are the reward.
 */
export function CallStatsStrip({
  stats,
  loading,
  error,
}: {
  stats: CallStats | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return <Skeleton className="h-20" />;
  }

  if (error || !stats) {
    return (
      <span className="text-xs text-muted-foreground">
        Couldn{"'"}t load call stats — {error ?? "no data"}. The queue below still works.
      </span>
    );
  }

  const tags = Object.entries(stats.tagCounts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/60 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Stat
          label="CSAT top-2-box"
          info={TOP2BOX_EXPLAINER}
          value={
            stats.csatResponses > 0 ? `${Math.round(stats.csatTop2BoxPercent)}%` : "—"
          }
          sub={
            stats.csatResponses > 0
              ? `${stats.csatResponses} answer${stats.csatResponses !== 1 ? "s" : ""} · avg ${stats.csatAverage.toFixed(1)}/5`
              : "No scores yet"
          }
        />
        <Stat
          label="Calls logged"
          value={String(stats.totalCalls)}
          sub={`${stats.optedOutUsers} opted out`}
          info="Every call, including the ones nobody answered. That's the point of one-tap logging — an attempt count that only records the calls that went well is fiction."
        />
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          What people are telling us
          <InfoTip label="Raw counts, not percentages — “phlebo-late ×7” is more honest and more actionable than “18.4% cited timeliness”. This list is the evidence that turns a Thyrocare conversation from anecdote into a scorecard." />
        </span>
        {tags.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            Nothing tagged yet — it shows up here as soon as calls get logged.
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
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  info,
}: {
  label: string;
  value: string;
  sub: string;
  info: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
        <InfoTip label={info} />
      </span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-[11px] text-muted-foreground">{sub}</span>
    </div>
  );
}
