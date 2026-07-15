"use client";

import { formatDateTime } from "@/app/incidents/lib/datetime";
import { humanizeEnumValue, previousCallAt, type PreviousCall } from "../types";
import { CsatChip, DispositionBadge } from "./CallBadges";

/**
 * What was said the last time we rang this person.
 *
 * This is not a nicety. A courtesy call that re-asks a question the customer
 * already answered is worse than no call — it tells them nobody read the last
 * one. The caller must be able to see it without leaving the screen or scrolling
 * while the phone is at their ear.
 *
 * Every field here is rendered only if the wire actually sent it, because the
 * previous-call shape is the one part of the contract that wasn't verified
 * field-by-field. A missing note renders as nothing, never as "undefined".
 */
export function PreviousCallsList({ calls }: { calls: PreviousCall[] }) {
  if (calls.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {calls.length === 1 ? "Last time we called" : `Previous calls (${calls.length})`}
      </span>

      {calls.map((c) => {
        const at = previousCallAt(c);
        const tags = c.tags ?? [];
        return (
          <div key={c.id} className="flex flex-col gap-1 border-t border-border/60 pt-2 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <DispositionBadge disposition={c.disposition} />
              {typeof c.csat === "number" && <CsatChip csat={c.csat} />}
              {typeof c.attemptNumber === "number" && (
                <span className="text-[11px] text-muted-foreground">Attempt {c.attemptNumber}</span>
              )}
              {at && (
                <span className="ml-auto text-[11px] text-muted-foreground">{formatDateTime(at)}</span>
              )}
            </div>

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {humanizeEnumValue(t)}
                  </span>
                ))}
              </div>
            )}

            {c.notes && <p className="text-xs leading-relaxed text-foreground/90">{c.notes}</p>}

            {c.verbatim && (
              <p className="border-l-2 border-border pl-2 text-xs italic leading-relaxed text-muted-foreground">
                “{c.verbatim}”
              </p>
            )}

            {c.callbackAt && (
              <span className="text-[11px] text-sky-400">
                Asked to be rung back at {formatDateTime(c.callbackAt)}
              </span>
            )}

            {(c.calledBy?.name || c.calledByAdminId) && (
              <span className="text-[11px] text-muted-foreground">
                Called by {c.calledBy?.name ?? "another admin"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
