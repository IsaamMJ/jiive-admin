"use client";

import { Check, X, HelpCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  MARKER_LABEL,
  REQUIRED_BIOMARKERS,
  markerFromSkuIdItself,
  type Coverage,
  type Marker,
  type UnknownReason,
} from "../bioage";

// ─────────────────────────────────────────────────────────────────────────────
// The bio-age verdict, rendered honestly.
//
// ONE COMPONENT, TWO PLACES. This is used live in the switch editor as the
// operator types AND inside the confirmation dialog. Deliberately not two
// components: if the editor said "9/9" and the confirm said "3/9" the operator
// would have no way to know which to believe, and the two would drift the first
// time either was edited.
//
// THE RENDERING RULES ARE THE SPEC, NOT TASTE:
//
//  1. NO PROGRESS BAR. EVER. A one-third-filled bar reads as "a third of the way
//     there". There is no "way there" — bio-age needs all nine markers or it
//     returns nothing at all, so 3/9 and 0/9 produce identical customer outcomes.
//  2. "3/9" NEVER APPEARS AS A HEADLINE OR A BADGE. Nine explicit rows, six of
//     them with a ✗, is the honest picture. A fraction invites the reader to
//     treat coverage as a score.
//  3. MISSING MARKERS ARE LISTED BEFORE FOUND ONES. What is absent is the
//     finding; what is present is context.
//  4. `unknown` IS GREY AND DENIES BOTH DIRECTIONS EXPLICITLY. It is neither
//     "no bio-age" nor "bio-age is fine". Rendering it as either is the exact
//     absent-signal-as-assurance bug this codebase exists to avoid.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  coverage: Coverage;
  /** Shown under an `unknown` verdict — for a PSKU the id itself is a test code,
   *  which is the one thing we can still learn. Never upgrades the verdict. */
  skuId?: string;
  /** True while the catalog is still loading. Renders a SKELETON, never 0/9. */
  loading?: boolean;
  compact?: boolean;
}

export function BioAgeVerdict({ coverage, skuId, loading, compact }: Props) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          Checking Thyrocare&rsquo;s catalog for the nine bio-age markers&hellip;
        </div>
        <Skeleton className="h-4 w-40" />
      </div>
    );
  }

  if (coverage.kind === "unknown") {
    return <UnknownVerdict why={coverage.why} skuId={skuId} />;
  }

  if (coverage.kind === "full") {
    return (
      <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-green-600 dark:text-green-400">
          <Check size={15} /> Bio-age: AVAILABLE
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          All nine PhenoAge markers are in this panel&rsquo;s test list.
        </p>
        {!compact && <MarkerGrid found={coverage.found} missing={[]} />}
      </div>
    );
  }

  // kind === "none" — 0..8 markers. A FAILURE, not a partial. See Coverage docs.
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
        <X size={15} /> Bio-age: NOT AVAILABLE
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Bio-age will <span className="font-medium text-foreground">not</span> be produced on this
        panel. This is not &ldquo;partial bio-age&rdquo; — the calculation needs all nine markers or
        it returns nothing, so every customer who books this gets an apology instead of a biological
        age.
      </p>
      <MarkerGrid found={coverage.found} missing={coverage.missing} />
    </div>
  );
}

function UnknownVerdict({ why, skuId }: { why: UnknownReason; skuId?: string }) {
  // The id itself may be a PhenoAge test code — true for 7 PSKU ids (FBS, SCRE,
  // CRP, HSCRP, ALKP, SALB, TLEUC). Worth saying, because for a PSKU it is
  // literally all the information that exists. It stays a footnote: knowing one
  // marker of nine is not knowing nine of nine, and the gap between those is the
  // customer's entire result.
  const selfMarker = skuId ? markerFromSkuIdItself(skuId) : null;

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <HelpCircle size={15} /> Bio-age: UNKNOWN
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{UNKNOWN_COPY[why]}</p>
      <p className="mt-1.5 text-xs text-muted-foreground">
        This does <span className="font-medium text-foreground">not</span> mean &ldquo;no
        bio-age&rdquo;, and it does <span className="font-medium text-foreground">not</span> mean
        &ldquo;bio-age is fine&rdquo;. Nobody has checked.
      </p>
      {selfMarker && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          One thing we can tell: the SKU code{" "}
          <span className="font-mono text-foreground">{skuId}</span> is itself the test code for{" "}
          <span className="font-medium text-foreground">{MARKER_LABEL[selfMarker]}</span>, so at
          least that marker is covered. The other eight are still unknown.
        </p>
      )}
    </div>
  );
}

const UNKNOWN_COPY: Record<UnknownReason, string> = {
  "no-match":
    "This SKU isn't in Thyrocare's catalog, so we can't read its test list. Their catalog doesn't contain every id they issue — see the note on the SKU field.",
  "catalog-down":
    "Thyrocare's catalog is unreachable right now, so we couldn't look up this panel's tests at all.",
  // The live case on dev today: all 529 prod PSKUs (and dev's FBS) return an
  // empty testsIncluded. Computing 0/9 from that would be a lie about the
  // package that is live on dev right now.
  "empty-tests":
    "Thyrocare lists this SKU but returns no test list for it — which is normal for PSKU-type SKUs and tells us nothing about its markers either way.",
  "not-checked": "We haven't looked this SKU up yet.",
};

/** Missing first — what's absent is the finding. */
function MarkerGrid({ found, missing }: { found: Marker[]; missing: Marker[] }) {
  const foundSet = new Set(found);
  const ordered = [...missing, ...REQUIRED_BIOMARKERS.filter((m) => foundSet.has(m))];
  return (
    <ul className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
      {ordered.map((m) => {
        const has = foundSet.has(m);
        return (
          <li
            key={m}
            className={cn(
              "flex items-center gap-1.5 text-xs",
              has ? "text-muted-foreground" : "font-medium text-destructive",
            )}
          >
            {has ? <Check size={12} className="shrink-0" /> : <X size={12} className="shrink-0" />}
            {MARKER_LABEL[m]}
          </li>
        );
      })}
    </ul>
  );
}
