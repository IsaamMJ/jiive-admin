"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Loader2, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InfoTip } from "@/components/InfoTip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import {
  fetchPackage,
  isNoResponse,
  patchPackage,
  serverMessage,
  statusOf,
  type WriteOutcome,
} from "../api";
import { coverageForSku } from "../bioage";
import { loadCatalog, matchSku, norm, type CatalogState, type SlimSku } from "../catalog";
import * as journal from "../journal";
import {
  MAGNITUDE_GATE_FACTOR,
  needsMagnitudeGate,
  parseRupees,
  priceRatio,
  rupeeInputFromPaise,
  rupeesExact,
  type Paise,
} from "../money";
import {
  ACTIVE_EXPLAINER,
  BIO_AGE_EXPLAINER,
  PAISE_ECHO_EXPLAINER,
  SKU_TYPES,
  isSkuType,
  type Package,
  type PackagePatchBody,
  type PanelIdentity,
  type SkuType,
} from "../types";
import { BioAgeVerdict } from "./BioAgeVerdict";
import { SkuPicker } from "./SkuPicker";

// ─────────────────────────────────────────────────────────────────────────────
// Switch which Thyrocare panel a customer actually gets.
//
// Two stages in one dialog: EDIT, then CONFIRM. The confirm renders from the
// WIRE BODY OBJECT — the very object handed to axios — not from draft state. A
// summary built from draft state agrees with a body-construction bug; a render
// of the request itself disagrees with it. That is the difference between a
// receipt and a restatement.
//
// The body is FROZEN when the confirm opens, so an edit made behind the dialog
// cannot sneak into a request the operator already approved.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pkg: Package;
  /** Pre-fill from a journal snapshot (the restore path). Nothing is typed. */
  restoreFrom?: (PanelIdentity & { isActive: boolean }) | null;
  onDone: (row: Package) => void;
}

type Stage = "edit" | "confirm";

export function SwitchPanelDialog({ open, onOpenChange, pkg: pkgProp, restoreFrom, onDone }: Props) {
  const isRestore = !!restoreFrom;

  // THE BASELINE IS STATE, NOT THE PROP.
  //
  // Every "from" value on this screen — the diff, the ratio, the magnitude gate,
  // the journal's `before` snapshot — is measured against this row. When the
  // staleness re-read finds the server has moved on and the operator chooses
  // "keep my draft anyway", the baseline must move to the LIVE row: otherwise
  // the dialog goes on diffing against a row that no longer exists, and (worse)
  // the same conflict re-fires on every subsequent "Review the change", which
  // made the dismiss button a dead end you could only escape by discarding your
  // draft. Adopting the live row resolves the conflict AND keeps the draft.
  const [pkg, setPkg] = useState<Package>(pkgProp);

  // ── Draft ─────────────────────────────────────────────────────────────────
  //
  // Seeded through useState INITIALISERS, not an effect. page.tsx mounts this
  // component fresh for each open (and keys it on the row + mode), so the
  // initialiser runs exactly once per opening — which means there is no window
  // in which the dialog is showing the previous row's values, and no
  // setState-inside-an-effect cascade.
  const seed = restoreFrom ?? pkgProp;
  const [displayName, setDisplayName] = useState(seed.displayName);
  const [description, setDescription] = useState(
    restoreFrom ? restoreFrom.description : (pkgProp.description ?? ""),
  );
  const [skuId, setSkuId] = useState(seed.thyrocareSkuId);
  // The ONE case where pre-filling the type is safe: the id and the type below
  // are a pair that was LIVE TOGETHER (the current row, or a restore replaying
  // values the server itself held). `pairedIdRef` records which id this type
  // belongs to, and changeSkuId() drops the type the moment the id leaves it.
  //
  // Without that ref this seed WAS trap 1: hand-editing PROJ1062813 → COMHECHPA
  // kept skuType "OFFER" in state, the unmatched select opened pre-filled with
  // it, the confirm rendered OFFER→OFFER in calm grey as a field that is not
  // changing, and the lab rejected the order after the customer had paid.
  const [skuType, setSkuType] = useState<SkuType | null>(
    isSkuType(seed.skuType) ? seed.skuType : null,
  );
  const pairedIdRef = useRef(norm(seed.thyrocareSkuId));
  const [priceInput, setPriceInput] = useState(rupeeInputFromPaise(seed.pricePaise));
  const [requiresFasting, setRequiresFasting] = useState(seed.requiresFasting);
  const [fastingHours, setFastingHours] = useState(String(seed.fastingHours));

  const [stage, setStage] = useState<Stage>("edit");
  const [catalog, setCatalog] = useState<CatalogState>({ status: "idle" });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [formError, setFormError] = useState("");
  const [outcome, setOutcome] = useState<WriteOutcome | null>(null);
  const [ackNoBioAge, setAckNoBioAge] = useState(false);
  const [ackWrongIdString, setAckWrongIdString] = useState(false);
  // OPT-IN, on the EDIT stage, and never required.
  //
  // This used to be a mandatory tick on the CONFIRM stage — after buildBody()
  // had already frozen the request — so `if (willActivate && ackActivate)` was
  // evaluated with ackActivate still false and isActive NEVER reached the wire,
  // while the same panel refused to submit until the box was ticked. On all five
  // inactive prod rows the only way to fix a SKU typo was to assert the row was
  // going live, and then it didn't: the row stayed off and the outcome said
  // "Live now". (It wasn't even dead code — Back, then Review again, rebuilt the
  // body with the tick set and DID send isActive:true. Same intent, two
  // different requests, decided by whether you happened to bounce a stage.)
  //
  // As an edit-stage choice it is part of the draft, so buildBody() sees it,
  // the confirm renders what will actually be sent, and correcting a dormant row
  // no longer requires switching it on.
  const [activateNow, setActivateNow] = useState(false);
  const [magnitudeInput, setMagnitudeInput] = useState("");
  const [stale, setStale] = useState<Package | null>(null);
  const [frozenBody, setFrozenBody] = useState<PackagePatchBody | null>(null);
  const [showJson, setShowJson] = useState(false);

  // Catalog is fetched WHEN THE DIALOG OPENS, not on page mount — most visits to
  // /packages are to look at prices, and 2 MB of Thyrocare JSON should not be
  // the cost of that. Deferred through a timeout so the effect body never calls
  // setState synchronously (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setCatalog({ status: "loading" });
      loadCatalog().then((s) => {
        if (!cancelled) setCatalog(s);
      });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open]);

  // ── SKU id / type: one pair, never two independent fields ─────────────────
  //
  // The id setter is the ONLY way the id moves, and it drops the type whenever
  // the id leaves the value the type was verified against. `pick` re-supplies
  // both from one catalog row and re-arms the ref, so browsing is unaffected.
  const changeSkuId = useCallback((v: string) => {
    setSkuId(v);
    if (norm(v) !== pairedIdRef.current) setSkuType(null);
  }, []);

  const pickSku = useCallback((s: SlimSku) => {
    pairedIdRef.current = norm(s.id);
    setSkuId(s.id);
    setSkuType((SKU_TYPES as readonly string[]).includes(s.type) ? (s.type as SkuType) : null);
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────
  const match = useMemo(
    () => (catalog.status === "ready" ? matchSku(catalog.skus, skuId) : null),
    [catalog, skuId],
  );

  // The catalog's answer WINS over anything the operator asserted earlier.
  //
  // This replaces the old `typeContradiction` block, which refused to submit
  // when the two disagreed — and could not be satisfied, because on a match the
  // type renders as a LOCKED CHIP with no control to change. (Reachable by
  // asserting a type while the catalog was still loading, then having it land.)
  // Preferring the catalog makes a contradictory body unconstructible instead of
  // merely rejected, and it matches what the chip has always claimed on screen:
  // "from Thyrocare's catalog".
  const catalogType: SkuType | null =
    match && isSkuType(match.sku.type) ? match.sku.type : null;
  const effectiveSkuType: SkuType | null = catalogType ?? skuType;

  const coverage = useMemo(() => {
    if (catalog.status === "down") return { kind: "unknown", why: "catalog-down" } as const;
    if (catalog.status !== "ready") return { kind: "unknown", why: "not-checked" } as const;
    if (!match) return { kind: "unknown", why: "no-match" } as const;
    return coverageForSku(match.sku);
  }, [catalog, match]);

  // Coverage of what is live TODAY — needed to tell "this panel has no bio-age"
  // from "you are about to REMOVE bio-age", which are different warnings.
  const currentCoverage = useMemo(() => {
    if (catalog.status !== "ready") return null;
    const m = matchSku(catalog.skus, pkg.thyrocareSkuId);
    return m ? coverageForSku(m.sku) : null;
  }, [catalog, pkg.thyrocareSkuId]);

  const parsedPrice = useMemo(() => parseRupees(priceInput), [priceInput]);
  const pricePaise = parsedPrice.ok ? parsedPrice.paise : null;
  const fastingHoursNum = Number.parseInt(fastingHours, 10);

  // FASTING IS PART OF THE IDENTITY, NOT AN AFTERTHOUGHT. Glucose (FBS) is one
  // of the nine markers, and a non-fasting draw makes it useless. If the catalog
  // says the SKU needs fasting, we force it on rather than letting the operator
  // leave the old answer behind.
  const catalogForcesFasting = match?.sku.isFastingRequired === true;
  const effectiveFasting = catalogForcesFasting ? true : requiresFasting;

  /** Is this row currently switched off — i.e. is "also make it live" on offer? */
  const willActivateBase = !pkg.isActive;

  const changed = useMemo(() => {
    if (pricePaise === null) return false;
    return (
      displayName.trim() !== pkg.displayName ||
      description.trim() !== (pkg.description ?? "") ||
      skuId.trim() !== pkg.thyrocareSkuId ||
      effectiveSkuType !== pkg.skuType ||
      pricePaise !== pkg.pricePaise ||
      effectiveFasting !== pkg.requiresFasting ||
      fastingHoursNum !== pkg.fastingHours ||
      (willActivateBase && activateNow)
    );
  }, [
    displayName, description, skuId, effectiveSkuType, pricePaise, effectiveFasting,
    fastingHoursNum, pkg, willActivateBase, activateNow,
  ]);

  // WE FOUND THE SKU, BUT NOT UNDER THE STRING BEING SENT. See catalog.ts's
  // `typedIsNotTheId`. Gating on this is gating on a POSITIVE finding — we know
  // the catalog's id for that row — which is exactly the case where a required
  // acknowledgement is legitimate. Never a block: the operator may still have
  // written instruction from the lab.
  const wrongIdString = !!match?.typedIsNotTheId;

  // The primary row is the one the bio-age flow reads.
  //   destroysBioAge  — we KNOW the new panel can't do it (red, must ack).
  //   losesKnownBioAge — today's panel provably does all nine and we cannot tell
  //     whether the new one does (amber, must ack). Previously silent: the check
  //     was `coverage.kind === "none"`, which excludes `unknown`, so switching
  //     PROJ1062813 (9/9, verified live) to COMHECHPA raised nothing at all and
  //     `currentCoverage` — computed, threaded into ConfirmStage, and never once
  //     rendered — dropped the single most consequential fact about the switch.
  const currentIsFull = currentCoverage?.kind === "full";
  const destroysBioAge =
    pkg.testType === "primary" && currentIsFull && coverage.kind === "none";
  const losesKnownBioAge =
    pkg.testType === "primary" && currentIsFull && coverage.kind === "unknown";

  const willActivate = willActivateBase && activateNow;
  const gateNeeded = pricePaise !== null && needsMagnitudeGate(pkg.pricePaise, pricePaise);
  // Compare the PARSED paise, not the raw strings: "2929" and "2929.00" are the
  // same price, and a gate that rejects the second would just teach the operator
  // to copy-paste the first.
  const magnitudeParsed = parseRupees(magnitudeInput);
  const gateSatisfied =
    !gateNeeded || (magnitudeParsed.ok && pricePaise !== null && magnitudeParsed.paise === pricePaise);

  // Waiting on the catalog is NOT the same as the catalog being unable to help.
  // While it is in flight `match` is null for every id, so an operator who has
  // just changed the id would be asked to assert a type we are two seconds away
  // from knowing. Blocking on "we are still looking" is honest; blocking on
  // "we looked and found nothing" would be the catalog acting as a validator,
  // which this module refuses to do (COMHECHPA). `down` therefore does NOT block.
  const catalogInFlight = catalog.status === "loading" || catalog.status === "idle";
  const idMoved = norm(skuId) !== norm(pkg.thyrocareSkuId);

  const blockedReason: string | null =
    !parsedPrice.ok ? parsedPrice.reason
    : skuId.trim() === "" ? "Enter the Thyrocare SKU id."
    : catalogInFlight && idMoved && effectiveSkuType === null
      ? "Still reading Thyrocare's catalog — one moment."
    : effectiveSkuType === null ? "Choose the SKU type — it is not something we can guess."
    : !Number.isInteger(fastingHoursNum) || fastingHoursNum < 0 || fastingHoursNum > 24
      ? "Fasting hours must be a whole number from 0 to 24."
    : !changed ? "Nothing has changed yet."
    : null;

  // ── Build the wire body ───────────────────────────────────────────────────
  const buildBody = useCallback((): PackagePatchBody | null => {
    if (pricePaise === null || effectiveSkuType === null || skuId.trim() === "") return null;
    // The seven-field identity block. skuType is present BECAUSE thyrocareSkuId
    // is present — the SkuPair union makes any other shape a compile error, so
    // the half-sent identity that Thyrocare rejects post-payment cannot be
    // expressed here.
    //
    // pricePaise, NOT price. The handoff doc's example says "price"; the Zod
    // schema is z.object() and would DROP it silently with a 200, leaving the
    // old price live under the new SKU. Do not "correct" this toward the doc.
    const body: PackagePatchBody = {
      displayName: displayName.trim(),
      description: description.trim(),
      thyrocareSkuId: skuId.trim(),
      skuType: effectiveSkuType,
      pricePaise: pricePaise as Paise,
      requiresFasting: effectiveFasting,
      fastingHours: fastingHoursNum,
    };
    // isActive rides along ONLY when the operator asked for it on the edit
    // stage, which is a value this callback can actually see. We never send
    // isActive:false from here — deactivating does not stop bookings, it hands
    // the price to env config this screen cannot read.
    if (willActivate) body.isActive = true;
    return body;
  }, [
    displayName, description, skuId, effectiveSkuType, pricePaise, effectiveFasting,
    fastingHoursNum, willActivate,
  ]);

  // ── Open the confirm (with a best-effort staleness re-read) ───────────────
  const openConfirm = async () => {
    const body = buildBody();
    if (!body) return;
    setFormError("");
    setBusy(true);
    try {
      // Best-effort optimistic-concurrency check. There is no If-Match on this
      // API, so this is a re-read and nothing stronger — a change landing in the
      // gap between this GET and the PATCH is still possible. Labelled as
      // best-effort wherever it is surfaced.
      const live = await fetchPackage(pkg.testType);
      if (live.updatedAt !== pkg.updatedAt) {
        setStale(live);
        setBusy(false);
        return;
      }
    } catch {
      // A failed pre-check must not block the operator — it is an extra safety
      // net, not a prerequisite. Silence is correct here.
    }
    setBusy(false);
    setFrozenBody(body);
    setStage("confirm");
  };

  // ── Commit ────────────────────────────────────────────────────────────────
  const commit = async () => {
    if (busyRef.current || !frozenBody) return;
    busyRef.current = true;
    setBusy(true);
    setFormError("");

    const before: PanelIdentity & { isActive: boolean } = {
      displayName: pkg.displayName,
      description: pkg.description ?? "",
      thyrocareSkuId: pkg.thyrocareSkuId,
      // The RAW stored value, never a substituted plausible one. Falling back to
      // "OFFER" here would write a fabricated fact into the only record of the
      // previous panel, and a later restore would replay it as if the server had
      // said so. If the value isn't one of the three, the restore dialog's
      // isSkuType() check turns it into "choose the type" instead — which is the
      // honest outcome. (Unreachable while the backend's Zod enum holds; it is
      // recorded truthfully anyway because this is the only copy.)
      skuType: pkg.skuType as SkuType,
      pricePaise: pkg.pricePaise,
      requiresFasting: pkg.requiresFasting,
      fastingHours: pkg.fastingHours,
      isActive: pkg.isActive,
    };
    const after: PanelIdentity & { isActive: boolean } = {
      displayName: frozenBody.displayName!,
      description: frozenBody.description ?? "",
      thyrocareSkuId: frozenBody.thyrocareSkuId!,
      skuType: frozenBody.skuType!,
      pricePaise: frozenBody.pricePaise!,
      requiresFasting: frozenBody.requiresFasting!,
      fastingHours: frozenBody.fastingHours!,
      isActive: frozenBody.isActive ?? pkg.isActive,
    };

    // WRITE-AHEAD: recorded BEFORE the request goes out, so a dead tab or a lost
    // response still leaves the previous panel recoverable. The server keeps no
    // history of it — this is the only copy.
    const entry = journal.beginSwitch(pkg.testType, before, after, pkg.updatedAt);

    try {
      const result = await patchPackage(pkg.testType, frozenBody, pkg);
      setOutcome(result);

      if (result.kind === "switched") {
        journal.setStatus(entry.id, "confirmed");
        toast.success(`${result.row.displayName} → ${result.row.thyrocareSkuId} · ${rupeesExact(result.row.pricePaise)}`);
        onDone(result.row);
      } else if (result.kind === "noOp") {
        // Not history — there is nothing to restore to, because nothing moved.
        journal.discard(entry.id);
        onDone(result.row);
      } else {
        // partial: the write landed, but not all of it. The journal entry stays
        // as `unresolved` rather than `failed` — half of it IS live.
        journal.setStatus(entry.id, "unresolved");
        onDone(result.row);
      }
    } catch (err) {
      if (isNoResponse(err)) {
        // A TIMEOUT IS NOT PROOF THE WRITE DIDN'T LAND. The request may have
        // been applied and only the response lost. So the entry stays `pending`
        // for the reconciler, and the offered action is a re-read, never a
        // blind retry that could apply the change twice.
        setFormError(
          "We didn't hear back, so we don't know whether that applied. Nothing has been retried. Re-read the package to see what's live right now.",
        );
      } else if (statusOf(err) === 403) {
        journal.setStatus(entry.id, "failed");
        setFormError(
          "Your login can view this page but can't change packages — that needs an admin role.",
        );
      } else {
        journal.setStatus(entry.id, "failed");
        setFormError(serverMessage(err, "The server refused that change."));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const reread = async () => {
    setBusy(true);
    try {
      const live = await fetchPackage(pkg.testType);
      onDone(live);
      setFormError("");
      toast.info(`Re-read from the server: ${live.thyrocareSkuId} · ${rupeesExact(live.pricePaise)}`);
      onOpenChange(false);
    } catch (err) {
      setFormError(serverMessage(err, "Couldn't re-read the package."));
    } finally {
      setBusy(false);
    }
  };

  // Every gate below fires on something we POSITIVELY KNOW: the new panel
  // provably can't do bio-age; today's panel provably can and we can't tell
  // about the new one; the catalog's id for this SKU is a different string from
  // the one on the wire; the price moves by ×10 or more. None of them fires on
  // an absence, and none of them is on by default — a gate that fires on every
  // save is muscle memory in a week.
  const confirmBlocked: string | null =
    busy ? null
    : destroysBioAge && !ackNoBioAge ? "Tick the bio-age acknowledgement to continue."
    : losesKnownBioAge && !ackNoBioAge ? "Tick the bio-age acknowledgement to continue."
    : wrongIdString && !ackWrongIdString
      ? "Tick the acknowledgement — you're sending a name, not the catalog's id."
    : !gateSatisfied ? "Re-type the new price to confirm a change this large."
    : null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className={cn(stage === "confirm" && !isRestore && "text-destructive")}>
            {stage === "edit"
              ? isRestore
                ? "Put the previous panel back?"
                : `Change the SKU for ${pkg.displayName}`
              : isRestore
                ? "Put the previous panel back?"
                : pkg.testType === "primary"
                  ? "Change the panel every customer books?"
                  : "Change the SKU customers get?"}
          </DialogTitle>
          <DialogDescription>
            Everyone who books from the next minute onward gets this SKU, at this price. Bookings
            already made keep the price and SKU they were created with — this does not reprice or
            refund anything.
          </DialogDescription>
        </DialogHeader>

        {outcome ? (
          <Outcome
            outcome={outcome}
            pkg={pkg}
            onClose={() => onOpenChange(false)}
            onRevert={() => { setOutcome(null); setStage("edit"); }}
          />
        ) : stale ? (
          <StaleConflict
            live={stale}
            onUseLive={() => { onDone(stale); setStale(null); onOpenChange(false); }}
            // ADOPT the live row as the baseline. Dismissing used to clear only
            // `stale`, leaving pkg (and page.tsx's dialog `key`) pinned to the
            // old updatedAt — so the next "Review the change" re-read, found the
            // same mismatch and re-fired the same conflict, forever. The only
            // exit was "use the new values", which discards the draft. That
            // stranded the operator after a partial write, i.e. exactly when
            // they most need to correct one. Adopting resolves the conflict,
            // keeps the draft, AND makes the diff and the journal's `before`
            // snapshot describe the row that is actually live.
            onDismiss={() => { setPkg(stale); setStale(null); }}
          />
        ) : stage === "edit" ? (
          <div className="flex flex-col gap-4">
            {isRestore && (
              <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
                Nothing here was typed — these are the exact values the server held before the
                switch. Bookings made since keep the amount they were created with; restoring does
                not refund them.
              </p>
            )}

            <SkuPicker
              skuId={skuId}
              onSkuIdChange={changeSkuId}
              skuType={effectiveSkuType}
              onSkuTypeChange={setSkuType}
              onPick={pickSku}
              catalog={catalog}
              match={match}
            />

            <PriceField
              value={priceInput}
              onChange={setPriceInput}
              parsed={parsedPrice}
              currentPaise={pkg.pricePaise}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="switch-name">Display name</Label>
                <Input
                  id="switch-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="switch-desc">Description</Label>
                <Input
                  id="switch-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={effectiveFasting}
                  disabled={catalogForcesFasting}
                  onChange={(e) => setRequiresFasting(e.target.checked)}
                />
                <span className="text-sm">Requires fasting</span>
              </label>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="switch-fh" className="text-xs">
                  Fasting hours
                </Label>
                <Input
                  id="switch-fh"
                  type="number"
                  min={0}
                  max={24}
                  value={fastingHours}
                  onChange={(e) => setFastingHours(e.target.value)}
                  className="h-9 w-24"
                />
              </div>
            </div>
            {catalogForcesFasting && (
              <p className="-mt-2 text-[11px] text-muted-foreground">
                Thyrocare&rsquo;s catalog marks this SKU as fasting-required, so we&rsquo;ve set it
                and locked it. Glucose is one of the nine bio-age markers and a non-fasting draw
                makes it unusable.
              </p>
            )}

            {/* Switching a dormant row on is a SEPARATE decision from correcting
                it, and it belongs here where buildBody() can see the answer —
                not as a mandatory tick on the confirm screen that arrived after
                the body was frozen. Unticked by default; nothing is blocked on
                it either way. */}
            {willActivateBase && (
              <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-2.5 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-amber-500"
                  checked={activateNow}
                  onChange={(e) => setActivateNow(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-foreground">
                    Also switch this row on
                  </span>{" "}
                  — it is currently off. Leave it unticked to correct the SKU or price without
                  making the row live.
                  <InfoTip label={ACTIVE_EXPLAINER} />
                </span>
              </label>
            )}

            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                Bio-age coverage
                <InfoTip label={BIO_AGE_EXPLAINER} />
              </span>
              <BioAgeVerdict
                coverage={coverage}
                skuId={skuId}
                loading={catalog.status === "loading" || catalog.status === "idle"}
              />
              {/* WHAT WE ARE GIVING UP, next to what we are getting. Rendering
                  only the new side lets a proven 9/9 panel vanish into an
                  UNKNOWN without the comparison ever being drawn. */}
              {currentCoverage && norm(skuId) !== norm(pkg.thyrocareSkuId) && (
                <p className="text-[11px] text-muted-foreground">
                  Today&rsquo;s panel (<span className="font-mono">{pkg.thyrocareSkuId}</span>):{" "}
                  <span className="font-medium text-foreground">
                    {currentCoverage.kind === "full"
                      ? "matches all nine markers"
                      : currentCoverage.kind === "none"
                        ? `misses ${currentCoverage.missing.length} of the nine`
                        : "unknown"}
                  </span>
                </p>
              )}
            </div>

            {formError && <p className="text-sm text-destructive">{formError}</p>}

            <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={openConfirm} disabled={!!blockedReason || busy}>
                {busy && <Loader2 size={13} className="mr-1.5 animate-spin" />}
                Review the change
              </Button>
            </div>
            {/* BUILD-CHECKLIST #4 — a disabled button always says why. */}
            {blockedReason && (
              <p className="-mt-1 text-right text-[11px] text-muted-foreground">{blockedReason}</p>
            )}
          </div>
        ) : (
          <ConfirmStage
            body={frozenBody!}
            pkg={pkg}
            coverage={coverage}
            currentCoverage={currentCoverage}
            match={match}
            catalog={catalog}
            isRestore={isRestore}
            destroysBioAge={destroysBioAge}
            losesKnownBioAge={losesKnownBioAge}
            ackNoBioAge={ackNoBioAge}
            setAckNoBioAge={setAckNoBioAge}
            wrongIdString={wrongIdString}
            ackWrongIdString={ackWrongIdString}
            setAckWrongIdString={setAckWrongIdString}
            gateNeeded={gateNeeded}
            magnitudeInput={magnitudeInput}
            setMagnitudeInput={setMagnitudeInput}
            blocked={confirmBlocked}
            busy={busy}
            formError={formError}
            showJson={showJson}
            setShowJson={setShowJson}
            onBack={() => setStage("edit")}
            onCommit={commit}
            onReread={reread}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Price field, with the always-visible dual echo ───────────────────────────

function PriceField({
  value,
  onChange,
  parsed,
  currentPaise,
}: {
  value: string;
  onChange: (v: string) => void;
  parsed: ReturnType<typeof parseRupees>;
  currentPaise: number;
}) {
  const ratio = parsed.ok ? priceRatio(currentPaise, parsed.paise) : null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-sm font-medium">
        Price customers pay
        <InfoTip label={PAISE_ECHO_EXPLAINER} />
      </span>
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-muted-foreground">₹</span>
        {/* type="text" + inputMode="decimal", NEVER type="number": a number input
            accepts exponent notation ("1e5" → ₹100,000), and its scroll wheel and
            step arrows can change a price by accident on a laptop. */}
        <Input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-40 tabular-nums"
        />
      </div>
      {parsed.ok ? (
        <p className="text-[11px] text-muted-foreground">
          Customers pay{" "}
          <span className="font-medium text-foreground">{rupeesExact(parsed.paise)}</span> · sent as
          pricePaise <span className="font-mono text-foreground">{parsed.paise}</span>
          {ratio !== null && ratio !== 1 && (
            <>
              {" "}
              · <span className="font-medium text-foreground">×{ratio.toFixed(2)}</span> of today
            </>
          )}
        </p>
      ) : (
        <p className="text-[11px] text-destructive">{parsed.reason}</p>
      )}
    </div>
  );
}

// ── Confirm stage ────────────────────────────────────────────────────────────

interface ConfirmProps {
  body: PackagePatchBody;
  pkg: Package;
  coverage: ReturnType<typeof coverageForSku>;
  currentCoverage: ReturnType<typeof coverageForSku> | null;
  match: ReturnType<typeof matchSku>;
  catalog: CatalogState;
  isRestore: boolean;
  destroysBioAge: boolean;
  losesKnownBioAge: boolean;
  ackNoBioAge: boolean;
  setAckNoBioAge: (v: boolean) => void;
  wrongIdString: boolean;
  ackWrongIdString: boolean;
  setAckWrongIdString: (v: boolean) => void;
  gateNeeded: boolean;
  magnitudeInput: string;
  setMagnitudeInput: (v: string) => void;
  blocked: string | null;
  busy: boolean;
  formError: string;
  showJson: boolean;
  setShowJson: (v: boolean) => void;
  onBack: () => void;
  onCommit: () => void;
  onReread: () => void;
}

function ConfirmStage(p: ConfirmProps) {
  const { body, pkg } = p;
  // EVERY value below is read out of `body` — the object axios receives — so
  // this panel disagrees with a body-construction bug instead of echoing it.
  const newPaise = body.pricePaise!;
  const ratio = priceRatio(pkg.pricePaise, newPaise);
  const delta = newPaise - pkg.pricePaise;
  const priceMoved = newPaise !== pkg.pricePaise;
  const skuMoved = body.thyrocareSkuId !== pkg.thyrocareSkuId;

  // What the LAB charges us for the panel we are switching to, in RUPEES as a
  // string (Thyrocare's units). parseRupees strips the commas and the symbol and
  // hands back paise, which is the only form it may be compared against ours in.
  // Unparseable → null, and we say nothing rather than guess.
  const labCost = p.match?.sku.sellingPriceRupees ?? null;
  const labParsed = labCost ? parseRupees(labCost) : null;
  const labPaise = labParsed?.ok ? labParsed.paise : null;

  const unchanged: string[] = [];
  // PRICE BELONGS IN THIS LIST. A switch is fully committable with the price
  // untouched — `changed` goes true the moment the SKU differs — and the Price
  // row below renders ₹999 → ₹999 with the ratio badge suppressed, so the one
  // row that LOOKS like a diff was the one that was silently identical. Moving
  // to a panel the lab bills at ₹2,929 while still charging ₹999 produces no
  // error anywhere, forever, on every booking.
  if (!priceMoved) unchanged.push(`price ${rupeesExact(pkg.pricePaise)}`);
  if (body.requiresFasting === pkg.requiresFasting && body.fastingHours === pkg.fastingHours)
    unchanged.push(`fasting ${pkg.requiresFasting ? `${pkg.fastingHours}h` : "not required"}`);
  if (body.isActive === undefined) unchanged.push(pkg.isActive ? "active" : "inactive");
  unchanged.push(`position ${pkg.displayOrder}`);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <DiffRow label="Price">
          {priceMoved ? (
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-muted-foreground line-through">
                {rupeesExact(pkg.pricePaise)}
              </span>
              <ArrowRight size={12} className="text-muted-foreground" />
              <span className="font-semibold">{rupeesExact(newPaise)}</span>
              <span
                className={cn(
                  "text-xs font-medium",
                  ratio === null || ratio > 1
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground",
                )}
              >
                {/* The delta renders even when the ratio can't be computed
                    (old price 0). Suppressing both left the largest possible
                    move as the quietest thing on the screen. */}
                {ratio !== null && `×${ratio.toFixed(2)} `}({delta > 0 ? "+" : "−"}
                {rupeesExact(Math.abs(delta))})
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground">
              {rupeesExact(pkg.pricePaise)} — unchanged
            </span>
          )}
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            sent as pricePaise <span className="font-mono">{newPaise}</span>
          </div>
        </DiffRow>

        <DiffRow label="SKU">
          <Change from={pkg.thyrocareSkuId} to={body.thyrocareSkuId!} mono />
        </DiffRow>

        <DiffRow label="Type">
          <div className="flex flex-wrap items-center gap-2">
            <Change from={pkg.skuType} to={body.skuType!} mono />
            {/* GREEN ONLY WHEN THE STRING ON THE WIRE IS THE ROW'S OWN ID. A
                name match reads the type off a row whose id is something else,
                so the id was never verified against anything — see
                catalog.ts:typedIsNotTheId. */}
            {p.match && !p.match.typedIsNotTheId && p.match.sku.type === body.skuType ? (
              <span className="text-[11px] text-green-600 dark:text-green-400">
                ✓ from Thyrocare&rsquo;s catalog
              </span>
            ) : p.match ? (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">
                ⚠ read off {p.match.sku.id}, which is not what we&rsquo;re sending
              </span>
            ) : (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">
                ⚠ you set this — not from the catalog
              </span>
            )}
          </div>
        </DiffRow>

        <DiffRow label="Name">
          <Change from={pkg.displayName} to={body.displayName!} />
        </DiffRow>

        {unchanged.length > 0 && (
          <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
            Not changing: {unchanged.join(" · ")}
          </p>
        )}
      </div>

      {/* The screen already HAS this number — SkuPicker prints "lab charges us
          ₹2929" one stage earlier and then drops it before the stage where the
          decision is actually made. */}
      {skuMoved && !priceMoved && (
        <Alert tone="amber" title="The panel changes; the price does not.">
          Customers keep paying{" "}
          <span className="font-medium text-foreground">{rupeesExact(pkg.pricePaise)}</span> for the
          new panel.{" "}
          {labPaise !== null
            ? labPaise > newPaise
              ? `Thyrocare bills us ₹${labCost} for it — more than we charge.`
              : `Thyrocare bills us ₹${labCost} for it.`
            : "We don't know what the lab bills us for it, so we can't tell you whether that covers it."}{" "}
          If the price should move, go back and change it.
        </Alert>
      )}

      {/* Alert stack — only what fires. Red, then amber, then grey. */}
      {p.destroysBioAge && (
        <Alert tone="red" title="Bio-age stops working.">
          Today&rsquo;s panel matches all nine markers. This one does not. The calculation needs all
          nine or it returns nothing — every customer who books this gets an apology instead of a
          biological age.
        </Alert>
      )}
      {p.losesKnownBioAge && (
        <Alert tone="amber" title="You are giving up a panel we know works.">
          Today&rsquo;s panel (<span className="font-mono">{pkg.thyrocareSkuId}</span>) matches all
          nine markers — we checked. We <span className="font-medium">cannot tell</span> whether this
          one does, because it isn&rsquo;t in Thyrocare&rsquo;s catalog under that id. That is not
          evidence it fails; it means nobody can check until a real result comes back.
        </Alert>
      )}
      {p.wrongIdString && p.match && (
        <Alert tone="amber" title="That is the SKU's name, not its id.">
          We send <span className="font-mono">{body.thyrocareSkuId}</span> to the lab as the
          order&rsquo;s id and its name (thyrocare.service.ts sends the one string as both).
          Thyrocare&rsquo;s catalog lists this SKU as{" "}
          <span className="font-mono text-foreground">{p.match.sku.id}</span>. If the lab does not
          accept the name in the id field, every order rejects{" "}
          <span className="font-medium">after the customer has paid</span>. Go back and tap
          &ldquo;Use {p.match.sku.id}&rdquo; unless you were told in writing to send this string.
          {p.match.ambiguousCount > 1 && (
            <>
              {" "}
              {p.match.ambiguousCount} different SKUs share that name, so we can&rsquo;t even be sure
              which one the type and markers above describe.
            </>
          )}
        </Alert>
      )}
      {!p.match && p.catalog.status === "ready" && (
        <Alert tone="amber" title="You are asserting this SKU's type.">
          <span className="font-mono">{body.thyrocareSkuId}</span> isn&rsquo;t in Thyrocare&rsquo;s
          catalog, so we couldn&rsquo;t read it. If the type is wrong, the lab rejects the order{" "}
          <span className="font-medium">after the customer has paid</span>. We send this string to
          the lab as both the id and the name.
        </Alert>
      )}
      {p.catalog.status === "down" && (
        <Alert tone="grey" title="We couldn't check this SKU.">
          Thyrocare&rsquo;s catalog is unreachable, so nothing here was verified against it —
          neither the type nor the bio-age markers. That is not evidence anything is wrong; it means
          nobody checked.
        </Alert>
      )}

      <BioAgeVerdict coverage={p.coverage} skuId={body.thyrocareSkuId} compact />
      {/* currentCoverage was computed, threaded in here, and never rendered —
          so the moment the new side became UNKNOWN, the one thing we knew for
          certain (that today's panel produces a biological age for every
          customer) silently left the comparison. */}
      {p.currentCoverage && skuMoved && (
        <p className="-mt-1.5 text-[11px] text-muted-foreground">
          Today&rsquo;s panel <span className="font-mono">{pkg.thyrocareSkuId}</span>:{" "}
          <span className="font-medium text-foreground">
            {p.currentCoverage.kind === "full"
              ? "all nine markers"
              : p.currentCoverage.kind === "none"
                ? `missing ${p.currentCoverage.missing.map((m) => m).join(", ")}`
                : "unknown"}
          </span>
        </p>
      )}

      {/* The way back, always, as the last block before the buttons. */}
      <p className="flex items-start gap-1.5 rounded-lg border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
        <RotateCcw size={13} className="mt-0.5 shrink-0" />
        <span>
          Going back is one tap. We&rsquo;re saving{" "}
          <span className="font-medium text-foreground">{pkg.displayName}</span> /{" "}
          <span className="font-mono text-foreground">{pkg.thyrocareSkuId}</span> / {pkg.skuType} /{" "}
          {rupeesExact(pkg.pricePaise)} in this browser before we change anything, so you never have
          to remember it.
        </span>
      </p>

      {(p.destroysBioAge || p.losesKnownBioAge) && (
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            className={cn("mt-0.5", p.destroysBioAge ? "accent-destructive" : "accent-amber-500")}
            checked={p.ackNoBioAge}
            onChange={(e) => p.setAckNoBioAge(e.target.checked)}
          />
          <span>
            {p.destroysBioAge ? (
              <>
                I understand customers will get <span className="font-medium">no bio-age</span> from
                this panel.
              </>
            ) : (
              <>
                I understand we are giving up a panel that{" "}
                <span className="font-medium">provably</span> produces a bio-age, for one nobody can
                check.
              </>
            )}
          </span>
        </label>
      )}
      {p.wrongIdString && p.match && (
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            className="mt-0.5 accent-amber-500"
            checked={p.ackWrongIdString}
            onChange={(e) => p.setAckWrongIdString(e.target.checked)}
          />
          <span>
            I mean to send <span className="font-mono">{body.thyrocareSkuId}</span> and not{" "}
            <span className="font-mono">{p.match.sku.id}</span>.
          </span>
        </label>
      )}
      {/* Stated, never asked for — the decision was made on the edit stage and
          this is the receipt for it. `body.isActive` is the wire value. */}
      {body.isActive === true && (
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          This also switches the row <span className="font-medium">on</span> — it is off right now.
        </p>
      )}

      {p.gateNeeded && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
          <p className="text-xs font-medium text-destructive">
            {ratio === null
              ? "This is a very large change."
              : ratio >= MAGNITUDE_GATE_FACTOR
                ? `This multiplies the price by ${ratio.toFixed(0)}.`
                : `This cuts the price to a ${(1 / ratio).toFixed(0)}th of what it was.`}{" "}
            Type the new price to confirm:
          </p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="text-sm text-muted-foreground">₹</span>
            <Input
              type="text"
              inputMode="decimal"
              value={p.magnitudeInput}
              onChange={(e) => p.setMagnitudeInput(e.target.value)}
              className="h-8 w-40 tabular-nums"
              placeholder={rupeeInputFromPaise(newPaise)}
            />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => p.setShowJson(!p.showJson)}
        className="w-fit text-[11px] text-muted-foreground underline underline-offset-2"
      >
        {p.showJson ? "▾" : "▸"} Show the exact request
      </button>
      {p.showJson && (
        <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-2.5 text-[11px]">
          PATCH /packages/{pkg.testType}
          {"\n"}
          {JSON.stringify(body, null, 2)}
        </pre>
      )}

      {p.formError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {p.formError}
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={p.onReread} disabled={p.busy}>
              Re-read the package
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={p.onBack} disabled={p.busy}>
          Back
        </Button>
        <Button
          variant={p.isRestore ? "default" : "destructive"}
          onClick={p.onCommit}
          disabled={!!p.blocked || p.busy}
        >
          {p.busy && <Loader2 size={13} className="mr-1.5 animate-spin" />}
          {p.isRestore ? "Put it back" : `Switch to ${rupeesExact(newPaise)}`}
        </Button>
      </div>
      {p.blocked && (
        <p className="-mt-1 text-right text-[11px] text-muted-foreground">{p.blocked}</p>
      )}
    </div>
  );
}

function DiffRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:gap-3">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex-1 text-sm">{children}</div>
    </div>
  );
}

/** Vertical before→after stack on mobile, inline above. Never a 2-col table. */
function Change({ from, to, mono }: { from: string; to: string; mono?: boolean }) {
  if (from === to) {
    return <span className={cn("text-muted-foreground", mono && "font-mono text-xs")}>{to}</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className={cn("text-muted-foreground line-through", mono && "font-mono text-xs")}>
        {from}
      </span>
      <ArrowRight size={12} className="text-muted-foreground" />
      <span className={cn("font-medium", mono && "font-mono text-xs")}>{to}</span>
    </span>
  );
}

function Alert({
  tone,
  title,
  children,
}: {
  tone: "red" | "amber" | "grey";
  title: string;
  children: React.ReactNode;
}) {
  const cls =
    tone === "red"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : tone === "amber"
        ? "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400"
        : "border-border bg-muted/40 text-muted-foreground";
  return (
    <div className={cn("rounded-lg border p-3 text-xs", cls)}>
      <div className="font-semibold">{title}</div>
      <div className="mt-1 text-muted-foreground">{children}</div>
    </div>
  );
}

// ── Post-write outcomes ──────────────────────────────────────────────────────

function Outcome({
  outcome,
  pkg,
  onClose,
  onRevert,
}: {
  outcome: WriteOutcome;
  pkg: Package;
  onClose: () => void;
  onRevert: () => void;
}) {
  if (outcome.kind === "switched") {
    // "Live now" is a claim about isActive, so it is read off the SERVER'S row
    // rather than assumed from the fact that the write succeeded. A saved change
    // on a switched-off package is saved and NOT live, and saying otherwise sent
    // the operator away believing a dormant row was selling.
    const live = outcome.row.isActive;
    return (
      <div className="flex flex-col gap-3">
        <div
          className={cn(
            "rounded-lg border p-3 text-sm",
            live ? "border-green-500/30 bg-green-500/5" : "border-border bg-muted/40",
          )}
        >
          <div
            className={cn(
              "flex items-center gap-1.5 font-medium",
              live ? "text-green-600 dark:text-green-400" : "text-foreground",
            )}
          >
            <Check size={15} /> {live ? "Saved — live now" : "Saved — this row is still switched off"}
          </div>
          <p className="mt-1">
            {outcome.row.displayName} ·{" "}
            <span className="font-mono">{outcome.row.thyrocareSkuId}</span> · {outcome.row.skuType} ·{" "}
            {rupeesExact(outcome.row.pricePaise)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Verified field-by-field against the server&rsquo;s own response — not just a 200.
            {!live && " Customers can't book this package until it is switched on."}
          </p>
        </div>
        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    );
  }

  if (outcome.kind === "noOp") {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <div className="font-medium">The server accepted the request and changed nothing.</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Your package is exactly as it was. This usually means the values you sent were already
            live.
          </p>
        </div>
        <div className="flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    );
  }

  // PARTIAL — loud, red, per-field. The write DID land, in part, so this is not
  // an error toast: the operator needs to know exactly which half is live.
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
          <AlertTriangle size={15} /> The server took part of your change and not the rest.
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          This is live right now. Customers are being charged whatever the stored price says.
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {outcome.drift.map((d) => (
            <li key={d.field} className="text-xs">
              <span className="font-mono">{d.field}</span>: asked for{" "}
              <span className="font-medium text-foreground">{String(d.sent)}</span>, stored{" "}
              <span className="font-medium text-destructive">{String(d.stored)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button variant="destructive" onClick={onRevert}>
          Fix it — back to the form
        </Button>
      </div>
      <p className="text-right text-[11px] text-muted-foreground">
        Current live row: {pkg.testType}
      </p>
    </div>
  );
}

function StaleConflict({
  live,
  onUseLive,
  onDismiss,
}: {
  live: Package;
  onUseLive: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        <div className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
          <AlertTriangle size={15} /> This package changed while you had the form open.
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          It is now <span className="font-mono text-foreground">{live.thyrocareSkuId}</span> /{" "}
          {live.skuType} / {rupeesExact(live.pricePaise)}, last updated{" "}
          {new Date(live.updatedAt).toLocaleString()}. Your draft is kept.
        </p>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          This is a best-effort check — the API has no If-Match, so a change landing in the last
          second still can&rsquo;t be caught.
        </p>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Keeping your draft compares it against the row as it is now — so the change summary and the
        saved &ldquo;previous panel&rdquo; will both describe what is actually live, not what you
        opened.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onDismiss}>
          Keep my draft anyway
        </Button>
        <Button onClick={onUseLive}>Use the new values as my starting point</Button>
      </div>
    </div>
  );
}
