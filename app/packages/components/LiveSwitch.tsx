"use client";

import { AlertTriangle, ArrowRight, Loader2, Radio } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/InfoTip";
import { cn } from "@/lib/utils";

import { rupeesExact } from "../money";
import { bioAgeRoutingChanges, bookingTestTypeFor, type LiveState } from "../live";
import {
  BIO_AGE_ROUTING_EXPLAINER, LIVE_EXPLAINER, MULTI_LIVE_EXPLAINER,
  NO_LIVE_EXPLAINER, type Package,
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// "Which package is live" as a thing you can SEE, not a thing you discover
// through a 400.
//
// The screen used to render one independent on/off switch per row, which is a
// promise that any combination is selectable. It never was — and since backend
// 4e8bad0 the server actively refuses: deactivating the only live package is a
// hard 400. Six switches for a one-of-N choice is the wrong control, and the
// operator finds out at the worst possible moment, holding a red toast, on the
// screen that sets what customers are charged.
//
// So: a radio group in the table (page.tsx), and this card above it saying in
// words what is live right now. Both are needed. The radios express the
// CONSTRAINT; the card expresses the CURRENT ANSWER, including the two answers
// the radios physically cannot show — nothing live, and more than one live.
// ─────────────────────────────────────────────────────────────────────────────

/** SKU and type are ALWAYS printed together. Trap 1: a new id wearing the old
 *  type is rejected by Thyrocare after the customer has paid, so no surface in
 *  this module may show one without the other. */
function SkuLine({ p }: { p: Package }) {
  return (
    <span className="font-mono text-xs">
      {p.thyrocareSkuId} <span className="text-muted-foreground">· {p.skuType}</span>
    </span>
  );
}

export function LiveNowCard({
  state,
  onReload,
}: {
  state: LiveState;
  onReload: () => void;
}) {
  if (state.kind === "none") {
    // NOT an empty state. package.service.ts:164-174 keeps selling from env
    // config here — an absence on this screen is a live, unpriced sale, and
    // rendering it as a calm "nothing selected" would be the exact inversion.
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3.5">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
          <AlertTriangle size={15} className="shrink-0" /> No package is live.
          <InfoTip label={NO_LIVE_EXPLAINER} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          This does not stop sales. The server falls back to the env-configured SKU and price,
          which this screen cannot read, so customers are still being charged — for something
          nobody here chose. Pick one below.
        </p>
      </div>
    );
  }

  if (state.kind === "many") {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3.5">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
          <AlertTriangle size={15} className="shrink-0" /> {state.rows.length} packages report live.
          <InfoTip label={MULTI_LIVE_EXPLAINER} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Only one can be. The server does not refuse — it sells{" "}
          <span className="font-medium text-foreground">{state.served.displayName}</span> (
          <SkuLine p={state.served} /> · {rupeesExact(state.served.pricePaise)}), the first by
          display order then testType. The others are{" "}
          {state.rows
            .filter((r) => r.testType !== state.served.testType)
            .map((r) => r.displayName)
            .join(", ")}
          .
        </p>
        <Button size="sm" variant="outline" className="mt-2.5" onClick={onReload}>
          Reload the list
        </Button>
      </div>
    );
  }

  const p = state.row;
  return (
    <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-3.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-400">
        <Radio size={13} className="shrink-0" /> Live right now
        <InfoTip label={LIVE_EXPLAINER} />
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-base font-semibold">{p.displayName}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{p.testType}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
        <SkuLine p={p} />
        <span className="text-muted-foreground">·</span>
        <span className="font-semibold tabular-nums">{rupeesExact(p.pricePaise)}</span>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Every new booking is quoted this price, charged this amount, and drawn as this Thyrocare
        panel. Results are processed as{" "}
        <span className="font-mono">{bookingTestTypeFor(p.testType)}</span>
        <InfoTip label={BIO_AGE_ROUTING_EXPLAINER} />
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The confirm.
//
// BUILD-CHECKLIST #6: a consequential action confirms first and spells out the
// consequence. This one moves the customer-facing price AND the blood panel that
// is physically drawn, so the dialog is a side-by-side receipt of both packages
// rather than a "are you sure?".
//
// It shows SKU AND TYPE for both sides. Not because the type is changing — the
// row already holds a paired id and type — but because this is the moment the
// operator decides which pair goes to the lab, and the module's rule is that no
// surface shows one without the other.
// ─────────────────────────────────────────────────────────────────────────────

export function GoLiveDialog({
  from,
  to,
  open,
  onOpenChange,
  onConfirm,
  busy,
  error,
}: {
  /** The package being switched off. `null` only in the nothing-live case. */
  from: Package | null;
  to: Package;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: () => void;
  busy: boolean;
  /** The server's own words, verbatim. Never a paraphrase. */
  error: string | null;
}) {
  const priceMoves = !!from && from.pricePaise !== to.pricePaise;
  const routingChanges = bioAgeRoutingChanges(from, to);
  const toBooking = bookingTestTypeFor(to.testType);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Make {to.displayName} the live package?</DialogTitle>
          <DialogDescription>
            Everyone who books from the next minute onward is quoted this price and drawn this
            panel. Bookings already made keep the amount and SKU they were created with — this does
            not reprice or refund anything.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2.5">
          {/* Vertical on mobile, never a two-column table that needs scrolling.
              The founder uses this on a phone. */}
          <Side
            label={from ? "Off" : "Currently live"}
            pkg={from}
            tone="from"
            emptyNote="Nothing on this list is live, so the server is selling the env-configured default. Choosing one takes over from that."
          />
          <div className="flex justify-center">
            <ArrowRight size={15} className="rotate-90 text-muted-foreground sm:rotate-0" />
          </div>
          <Side label="Live" pkg={to} tone="to" />
        </div>

        {priceMoves && from && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-600 dark:text-amber-400">
            <span className="font-semibold">The price customers pay changes.</span>{" "}
            <span className="text-muted-foreground">
              {rupeesExact(from.pricePaise)} → {rupeesExact(to.pricePaise)}. Lumi quotes the new
              figure on the very next conversation, and Razorpay charges it.
            </span>
          </p>
        )}

        {/* Fires on a POSITIVE fact — the booking testType provably changes, and
            only 'biological_age' runs PhenoAge. It says nothing about whether the
            new panel covers the nine markers; that is bioage.ts's question and
            its honest answer for an unknown SKU is "we can't check". */}
        {routingChanges && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-600 dark:text-amber-400">
            <span className="font-semibold">
              {toBooking === "biological_age"
                ? "Results start being scored as a bio-age."
                : "Results stop being scored as a bio-age."}
            </span>{" "}
            <span className="text-muted-foreground">
              Bookings on this package are stamped{" "}
              <span className="font-mono">{toBooking}</span>, and only{" "}
              <span className="font-mono">biological_age</span> runs the PhenoAge calculation.
              {toBooking !== "biological_age" &&
                " Customers get a results page with markers and no age on it — nothing errors."}
            </span>
            <InfoTip label={BIO_AGE_ROUTING_EXPLAINER} />
          </p>
        )}

        <p className="text-[11px] text-muted-foreground">
          The switch is one database transaction — {from ? `${from.displayName} goes off` : "the env fallback stops"} as{" "}
          {to.displayName} comes on. There is no moment with two live, and no moment with none.
        </p>

        {/* THE SERVER'S OWN TEXT. The refusal it can return names the package,
            says why, and says what to do instead; replacing it with "something
            went wrong" throws all three away. */}
        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle size={14} className="shrink-0" /> The server refused that.
            </div>
            <p className="mt-1 text-foreground">{error}</p>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 size={13} className="mr-1.5 animate-spin" />}
            {busy ? "Switching…" : `Go live at ${rupeesExact(to.pricePaise)}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Side({
  label,
  pkg,
  tone,
  emptyNote,
}: {
  label: string;
  pkg: Package | null;
  tone: "from" | "to";
  emptyNote?: string;
}) {
  if (!pkg) {
    return (
      <div className="rounded-lg border border-dashed border-border p-2.5 text-xs text-muted-foreground">
        <span className="font-medium">{label}: nothing.</span> {emptyNote}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "rounded-lg border p-2.5",
        tone === "to" ? "border-green-500/30 bg-green-500/5" : "border-border bg-muted/30",
      )}
    >
      <div
        className={cn(
          "text-[11px] font-medium uppercase tracking-wide",
          tone === "to" ? "text-green-700 dark:text-green-400" : "text-muted-foreground",
        )}
      >
        {label}
      </div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
        <span className={cn("text-sm", tone === "to" ? "font-semibold" : "text-muted-foreground")}>
          {pkg.displayName}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">{pkg.testType}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
        <SkuLine p={pkg} />
        <span className="text-muted-foreground">·</span>
        <span className="font-medium tabular-nums">{rupeesExact(pkg.pricePaise)}</span>
      </div>
    </div>
  );
}
