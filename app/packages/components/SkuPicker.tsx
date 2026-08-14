"use client";

import { useMemo, useState } from "react";
import { Check, Search, AlertTriangle, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/InfoTip";
import { cn } from "@/lib/utils";
import { matchSku, nearMatches, searchSkus, skuKey, type CatalogState, type SkuMatch, type SlimSku } from "../catalog";
import { NOT_IN_CATALOG_EXPLAINER, SKU_TYPE_EXPLAINER, SKU_TYPES, type SkuType } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// One control, not two modes.
//
// Free text is a FIRST-CLASS path here, not a punished fallback. Thyrocare's
// email told the founder to use "COMHECHPA", and that string appears nowhere in
// their own catalog's 966 rows. A picker that only accepted catalog entries
// would refuse the lab's own instruction. So: type anything; we look it up and
// tell you what we found or didn't; we never stop you.
//
// The type field is the other half of trap 1 and behaves differently depending
// on what we know:
//   MATCHED   → the type is READ FROM THE CATALOG and locked. Not an input at
//               all, so a mismatched pair is unconstructible on the common path.
//   UNMATCHED → the select unlocks, starts at NOTHING, and blocks Save until the
//               operator chooses. It is NEVER pre-filled from the current row —
//               pre-filling is precisely the old-type-on-a-new-id bug wearing a
//               helpful face.
//
// That second paragraph described an invariant this file did not implement until
// 2026-08-05: onSkuIdChange changed only the id, so hand-editing the id left the
// PREVIOUS row's type in state and the select opened pre-filled with it. Typing
// COMHECHPA (an SSKU, and the id Thyrocare emailed the founder) over
// PROJ1062813/OFFER shipped `type: "OFFER"` with nothing amber on screen. The
// pairing now lives in SwitchPanelDialog — every id edit that moves away from
// the last KNOWN-PAIRED id clears the type — which is why `onPick` below hands
// the whole row up instead of calling two setters.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  skuId: string;
  onSkuIdChange: (v: string) => void;
  /** null = the operator has not chosen. Never defaulted. */
  skuType: SkuType | null;
  onSkuTypeChange: (v: SkuType | null) => void;
  /** A catalog row chosen wholesale: id AND type together, as a verified pair. */
  onPick: (sku: SlimSku) => void;
  catalog: CatalogState;
  match: SkuMatch | null;
}

export function SkuPicker({
  skuId,
  onSkuIdChange,
  skuType,
  onSkuTypeChange,
  onPick,
  catalog,
  match,
}: Props) {
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  // Memoised so the `[]` fallback isn't a new array identity on every render,
  // which would re-run both searches below on every keystroke anywhere in the
  // dialog — over a 966-row catalog.
  const skus = useMemo(
    () => (catalog.status === "ready" ? catalog.skus : []),
    [catalog],
  );
  const results = useMemo(
    () => (searchOpen && search.trim() !== "" ? searchSkus(skus, search, 50) : []),
    [skus, search, searchOpen],
  );
  const suggestions = useMemo(
    () => (!match && skuId.trim() !== "" ? nearMatches(skus, skuId, 3) : []),
    [skus, skuId, match],
  );

  const pick = (s: SlimSku) => {
    // The id and the type move TOGETHER, through one call, so the pair is
    // recorded as verified upstream. Two separate setters is how the type
    // survived an id it no longer belonged to.
    onPick(s);
    setSearchOpen(false);
    setSearch("");
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          Thyrocare SKU id
          <InfoTip label={NOT_IN_CATALOG_EXPLAINER} />
        </span>
        <div className="flex items-center gap-2">
          <Input
            value={skuId}
            onChange={(e) => onSkuIdChange(e.target.value)}
            placeholder="PROJ1062813"
            className="h-9 flex-1 font-mono text-sm"
            autoCapitalize="characters"
            spellCheck={false}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 shrink-0"
            onClick={() => setSearchOpen((v) => !v)}
          >
            <Search size={14} />
            <span className="ml-1 hidden sm:inline">Browse</span>
          </Button>
        </div>
      </div>

      {searchOpen && <CatalogSearch catalog={catalog} value={search} onChange={setSearch} results={results} onPick={pick} />}

      <MatchChip catalog={catalog} match={match} skuId={skuId} onUseCatalogId={pick} />

      {/* Suggestions, never auto-applied. The primary action is "keep what I
          typed" by construction: these are secondary chips and the input above
          is untouched until one is tapped. */}
      {suggestions.length > 0 && catalog.status === "ready" && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-muted-foreground">
            Similar entries in the catalog — tap only if one of these is what you meant. Otherwise
            keep what you typed.
          </span>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s, i) => (
              <button
                key={skuKey(s, i)}
                type="button"
                onClick={() => pick(s)}
                className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] hover:border-primary/50 hover:text-primary"
              >
                <span className="font-mono">{s.id}</span>
                <span className="ml-1 text-muted-foreground">{s.type}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <SkuTypeField match={match} skuType={skuType} onChange={onSkuTypeChange} skuId={skuId} catalog={catalog} />
    </div>
  );
}

// ── The match chip ──────────────────────────────────────────────────────────

function MatchChip({
  catalog,
  match,
  skuId,
  onUseCatalogId,
}: {
  catalog: CatalogState;
  match: SkuMatch | null;
  skuId: string;
  onUseCatalogId: (s: SlimSku) => void;
}) {
  if (skuId.trim() === "") return null;

  if (catalog.status === "loading" || catalog.status === "idle") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 size={12} className="animate-spin" /> Checking Thyrocare&rsquo;s catalog&hellip;
      </p>
    );
  }

  // CATALOG DOWN ≠ SKU NOT FOUND. This branch exists because collapsing the two
  // would tell the operator their id is unknown when in fact we never looked.
  if (catalog.status === "down") {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-600 dark:text-amber-400">
        <span className="font-medium">Thyrocare&rsquo;s catalog is unreachable</span>, so we
        can&rsquo;t check this id or read its markers. You can still switch — you&rsquo;re just
        doing it without the safety net.
        <div className="mt-1 text-muted-foreground">{catalog.reason}</div>
      </div>
    );
  }

  if (match) {
    // GREEN IS RESERVED FOR "the string on the wire IS this row's id".
    //
    // A name/alias match is a successful LOOKUP and a failed IDENTIFICATION. We
    // send what was typed (thyrocare.service.ts puts it on the order as both id
    // and name), so matching "PRIMARY HEALTH" reads OFFER and 9/9 off
    // PROJ1062813 and then ships the words "PRIMARY HEALTH" to the lab —
    // replacing the one id known to work in prod today. Painting that green with
    // a verified bio-age tick is the worst thing this chip could do, and it is
    // the single most likely string a founder types.
    const wrongString = match.typedIsNotTheId;
    return (
      <div
        className={cn(
          "rounded-lg border p-2.5 text-xs",
          wrongString ? "border-amber-500/40 bg-amber-500/5" : "border-green-500/30 bg-green-500/5",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-1.5 font-medium",
            wrongString
              ? "text-amber-600 dark:text-amber-400"
              : "text-green-600 dark:text-green-400",
          )}
        >
          {wrongString ? <AlertTriangle size={13} /> : <Check size={13} />}{" "}
          {wrongString
            ? `That's the ${match.reason === "alias" ? "alias" : "name"} of a SKU, not its id`
            : "In Thyrocare's catalog"}
        </div>
        <div className="mt-1 text-foreground">{match.sku.name}</div>
        <div className="mt-0.5 text-muted-foreground">
          {match.sku.type}
          {match.sku.noOfTestsIncluded > 0 && ` · ${match.sku.noOfTestsIncluded} tests`}
          {match.sku.sellingPriceRupees && ` · lab charges us ₹${match.sku.sellingPriceRupees}`}
        </div>

        {wrongString && (
          <>
            <p className="mt-1.5 text-muted-foreground">
              Thyrocare&rsquo;s catalog id for it is{" "}
              <span className="font-mono text-foreground">{match.sku.id}</span>. We send this field
              to the lab as the order&rsquo;s id, so what you type here is what they receive — the
              type and the markers below were read off{" "}
              <span className="font-mono">{match.sku.id}</span>, not off what you typed.
            </p>
            {match.ambiguousCount > 1 && (
              <p className="mt-1 flex items-start gap-1 text-amber-600 dark:text-amber-400">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                {match.ambiguousCount} different SKUs share that name. We showed you the first one —
                it may not be the one you mean. Use Browse and pick the id you want.
              </p>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 h-7"
              onClick={() => onUseCatalogId(match.sku)}
            >
              Use <span className="ml-1 font-mono">{match.sku.id}</span>
            </Button>
          </>
        )}

        {!wrongString && match.idEqualsName && (
          <p className="mt-1 text-muted-foreground">
            Thyrocare lists this with the id and the name identical — normal for 291 of their 966
            rows, nothing to fix.
          </p>
        )}
        {match.sku.minBeneficiaries != null && match.sku.minBeneficiaries > 1 && (
          <p className="mt-1 flex items-start gap-1 text-amber-600 dark:text-amber-400">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            Thyrocare requires at least {match.sku.minBeneficiaries} people on one order for this
            SKU. A single-patient booking cannot satisfy that.
          </p>
        )}
      </div>
    );
  }

  // GREY, NOT RED. "Not in the catalog" is not a verdict that the id is wrong.
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-2.5 text-xs">
      <div className="font-medium text-foreground">Not in Thyrocare&rsquo;s catalog</div>
      <p className="mt-1 text-muted-foreground">
        That doesn&rsquo;t make it wrong. Thyrocare&rsquo;s email to us quotes ids their own catalog
        API doesn&rsquo;t contain — <span className="font-mono">COMHECHPA</span> appears nowhere in
        all 966 rows, not as an id and not as an alias, yet it&rsquo;s what they told us to use. If
        the lab gave you this id in writing, use it.
      </p>
      <p className="mt-1.5 text-muted-foreground">
        Because we can&rsquo;t find it, three things follow: you set the SKU type yourself; we
        can&rsquo;t tell you whether bio-age will work; and if the id is wrong, Thyrocare rejects
        the order <span className="font-medium text-foreground">after the customer has paid</span>.
      </p>
    </div>
  );
}

// ── The type field ──────────────────────────────────────────────────────────

function SkuTypeField({
  match,
  skuType,
  onChange,
  skuId,
  catalog,
}: {
  match: SkuMatch | null;
  skuType: SkuType | null;
  onChange: (v: SkuType | null) => void;
  skuId: string;
  catalog: CatalogState;
}) {
  const label = (
    <span className="flex items-center gap-1.5 text-sm font-medium">
      SKU type
      <InfoTip label={SKU_TYPE_EXPLAINER} />
    </span>
  );

  // MATCHED → locked chip, not a select. The type is a fact we read, not an
  // opinion the operator supplies, so there is nothing here to get wrong.
  if (match && SKU_TYPES.includes(match.sku.type as SkuType)) {
    return (
      <div className="flex flex-col gap-1.5">
        {label}
        <div className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-green-500/30 bg-green-500/5 px-2.5 py-1.5 text-xs">
          <Check size={13} className="text-green-600 dark:text-green-400" />
          <span className="font-mono font-medium">{match.sku.type}</span>
          <span className="text-muted-foreground">· from Thyrocare&rsquo;s catalog</span>
        </div>
      </div>
    );
  }

  // STILL LOOKING ≠ NOT FOUND. `match` is null while the catalog is in flight,
  // which used to render the flat assertion "We can't find X in Thyrocare's
  // catalog" two seconds before we found it — an absent signal dressed as a
  // negative finding, and the operator can act on it. Own branch, own copy.
  const looking = catalog.status === "loading" || catalog.status === "idle";

  // UNMATCHED → the operator must assert it. No default, no prefill.
  const why = looking
    ? "We're still reading Thyrocare's catalog — nobody has looked this id up yet."
    : catalog.status === "down"
      ? "Thyrocare's catalog is unreachable, so we can't read this SKU's type for you."
      : `We can't find "${skuId.trim() || "this id"}" in Thyrocare's catalog, so we can't read its type for you.`;

  return (
    <div className="flex flex-col gap-1.5">
      {label}
      <select
        value={skuType ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : (e.target.value as SkuType))}
        className={cn(
          "h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-48",
          skuType === null ? "border-amber-500/50" : "border-input",
        )}
      >
        <option value="" disabled>
          Choose…
        </option>
        {SKU_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {skuId.trim() !== "" && (
        <p
          className={cn(
            "text-[11px]",
            looking ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400",
          )}
        >
          {why}{" "}
          {looking
            ? "If we find it, we'll fill the type in for you."
            : "You have to tell us. A wrong type makes Thyrocare reject the order — after the customer has paid."}
        </p>
      )}
    </div>
  );
}

// ── Catalog browse ──────────────────────────────────────────────────────────

function CatalogSearch({
  catalog,
  value,
  onChange,
  results,
  onPick,
}: {
  catalog: CatalogState;
  value: string;
  onChange: (v: string) => void;
  results: SlimSku[];
  onPick: (s: SlimSku) => void;
}) {
  if (catalog.status === "loading" || catalog.status === "idle") {
    return (
      <p className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">
        <Loader2 size={12} className="animate-spin" /> Loading Thyrocare&rsquo;s catalog&hellip; you
        can keep typing the id by hand — this is only a lookup.
      </p>
    );
  }
  if (catalog.status === "down") {
    return (
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-600 dark:text-amber-400">
        Can&rsquo;t browse — Thyrocare&rsquo;s catalog is unreachable. Type the id by hand instead.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-2.5">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Search ${catalog.skus.length} SKUs by id, name or alias…`}
        className="h-8 text-sm"
        autoFocus
      />
      {value.trim() !== "" && (
        <div className="mt-2 max-h-56 overflow-y-auto">
          {results.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">
              Nothing in the catalog matches that. You can still type the id by hand above — the
              catalog is incomplete by their own admission.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {results.map((s, i) => (
                <li key={skuKey(s, i)}>
                  <button
                    type="button"
                    onClick={() => onPick(s)}
                    className="w-full rounded-md px-2 py-1.5 text-left hover:bg-accent"
                  >
                    <div className="font-mono text-xs">{s.id}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {s.name} · {s.type}
                      {s.noOfTestsIncluded > 0 && ` · ${s.noOfTestsIncluded} tests`}
                    </div>
                  </button>
                </li>
              ))}
              {results.length >= 50 && (
                <li className="px-2 py-1.5 text-[11px] text-muted-foreground">
                  Showing the first 50 — refine your search.
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export { matchSku };
