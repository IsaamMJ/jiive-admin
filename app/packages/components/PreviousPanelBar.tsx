"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/InfoTip";
import { rupeesExact } from "../money";
import { agoLabel, type JournalEntry } from "../journal";
import { PREVIOUS_PANEL_EXPLAINER, type PanelIdentity } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// The way back, above the fold.
//
// Renders IMMEDIATELY from localStorage — it deliberately does not wait on the
// network. Undo is the thing you need most when the page is slow or the last
// write went wrong, so making it depend on a successful GET would remove it
// exactly when it matters.
//
// Restore is NOT a single unconfirmed tap. It opens the same confirm dialog,
// fully pre-filled from the snapshot, so nothing is typed and one more tap
// commits. What we removed is retyping an id from memory, not deliberation —
// restore moves the live customer price, and a phone in a pocket should not do
// that on one accidental touch. Reversibility is not the same as no confirmation.
// ─────────────────────────────────────────────────────────────────────────────

/** Every restore always names the row it targets. See page.tsx:openRestore. */
type RestoreFn = (testType: string, snapshot: PanelIdentity & { isActive: boolean }) => void;

interface Props {
  /** Latest restore point PER ROW. Not just primary — see journal.allRestorePoints. */
  entries: JournalEntry[];
  onRestore: RestoreFn;
}

/** More than this and it stops being an undo affordance and starts being a log. */
const MAX_BARS = 3;

export function PreviousPanelBar({ entries, onRestore }: Props) {
  if (entries.length === 0) {
    // CALM, AND EXPLICIT THAT IT IS AN ABSENCE OF RECORD — not a claim that
    // there was nothing to restore. Only honest now that we look across every
    // testType: while this read latestRestorePoint("primary") with the string
    // hardcoded, a confirmed switch on any other row rendered this sentence with
    // a perfectly good snapshot sitting unread in localStorage.
    return (
      <p className="flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
        No switch history in this browser yet. The first time you change a SKU, we&rsquo;ll save
        what it was so you can put it back.
        <InfoTip label={PREVIOUS_PANEL_EXPLAINER} />
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {entries.slice(0, MAX_BARS).map((entry) => (
        <OneBar key={entry.id} entry={entry} onRestore={onRestore} />
      ))}
      {entries.length > MAX_BARS && (
        <p className="text-[11px] text-muted-foreground">
          {entries.length - MAX_BARS} older restore point
          {entries.length - MAX_BARS === 1 ? "" : "s"} kept in this browser, not shown.
        </p>
      )}
    </div>
  );
}

function OneBar({ entry, onRestore }: { entry: JournalEntry; onRestore: RestoreFn }) {
  const s = entry.before;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <RotateCcw size={13} className="shrink-0" />
          {/* The row is NAMED. A bar that says only "previously live" while the
              button can target any of 6-8 packages is how the wrong row gets
              repriced. */}
          Previously live on <span className="font-mono">{entry.testType}</span>
          <InfoTip label={PREVIOUS_PANEL_EXPLAINER} />
        </div>
        <div className="mt-0.5 truncate text-sm">
          {s.displayName} · <span className="font-mono text-xs">{s.thyrocareSkuId}</span> ·{" "}
          {s.skuType} · {rupeesExact(s.pricePaise)}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          Replaced {agoLabel(entry.at)} from this browser
          {!s.isActive && " · that row was switched off at the time"}
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={() => onRestore(entry.testType, s)}
      >
        Put this back on {entry.testType}
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciling a write we never saw the end of.
//
// A `pending` entry means the journal was written but the read-back never
// completed — the tab died, the phone slept, the response was lost. We compare
// the snapshot against the row as it is RIGHT NOW and report one of three
// answers. The third is the honest one and the reason this exists: if the live
// row matches neither what we sent nor what was there before, we say so and
// offer both, rather than picking the more comfortable explanation.
// ─────────────────────────────────────────────────────────────────────────────

interface ReconcileProps {
  entry: JournalEntry;
  verdict: "confirmed" | "failed" | "unresolved";
  onRestore: RestoreFn;
  onDismiss: () => void;
}

export function ReconcileBanner({ entry, verdict, onRestore, onDismiss }: ReconcileProps) {
  const when = agoLabel(entry.at);

  if (verdict === "confirmed") {
    return (
      <Banner tone="ok" onDismiss={onDismiss}>
        <span className="font-medium">Your change {when} did land.</span> The package is{" "}
        <span className="font-mono">{entry.after.thyrocareSkuId}</span> ·{" "}
        {rupeesExact(entry.after.pricePaise)}, exactly as you sent it. We couldn&rsquo;t confirm it
        at the time because the tab closed before the reply arrived.
      </Banner>
    );
  }

  if (verdict === "failed") {
    return (
      <Banner tone="warn" onDismiss={onDismiss}>
        <span className="font-medium">Your change {when} did NOT land.</span> Nothing changed — the
        package is still <span className="font-mono">{entry.before.thyrocareSkuId}</span> ·{" "}
        {rupeesExact(entry.before.pricePaise)}.
      </Banner>
    );
  }

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
      <div className="flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400">
        <AlertTriangle size={15} /> Something changed after your switch on{" "}
        <span className="font-mono">{entry.testType}</span> {when}.
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        The live row is neither what you sent nor what was there before, so we won&rsquo;t guess
        what happened. Here are both — pick one, or leave it alone.
      </p>
      <dl className="mt-2 flex flex-col gap-1 text-xs">
        <Row k="You sent" v={`${entry.after.thyrocareSkuId} · ${entry.after.skuType} · ${rupeesExact(entry.after.pricePaise)}`} />
        <Row k="It was" v={`${entry.before.thyrocareSkuId} · ${entry.before.skuType} · ${rupeesExact(entry.before.pricePaise)}`} />
      </dl>
      <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
        {/* Both buttons carry entry.testType. Dropping it here is how an
            unresolved kidney switch ended up rewriting primary. */}
        <Button size="sm" variant="outline" onClick={() => onRestore(entry.testType, entry.before)}>
          Restore what it was
        </Button>
        <Button size="sm" variant="outline" onClick={() => onRestore(entry.testType, entry.after)}>
          Re-apply what I sent
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Leave it
        </Button>
      </div>
    </div>
  );
}

function Banner({
  tone,
  children,
  onDismiss,
}: {
  tone: "ok" | "warn";
  children: React.ReactNode;
  onDismiss: () => void;
}) {
  return (
    <div
      className={
        tone === "ok"
          ? "flex items-start justify-between gap-3 rounded-lg border border-green-500/30 bg-green-500/5 p-3 text-xs"
          : "flex items-start justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs"
      }
    >
      <div className="text-muted-foreground">{children}</div>
      <Button size="sm" variant="ghost" className="shrink-0" onClick={onDismiss}>
        OK
      </Button>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-muted-foreground">{k}</dt>
      <dd className="font-mono">{v}</dd>
    </div>
  );
}
