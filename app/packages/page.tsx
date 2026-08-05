"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InfoTip } from "@/components/InfoTip";
import { Check, X, Pencil, Plus, Repeat, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import {
  createPackage, fetchPackage, fetchPackages, isNoResponse, patchPackage,
  serverMessage, statusOf,
} from "./api";
import {
  MAGNITUDE_GATE_FACTOR, needsMagnitudeGate, parseRupees, priceRatio,
  rupeeInputFromPaise, rupees, rupeesExact,
} from "./money";
import * as journal from "./journal";
import {
  ACTIVE_EXPLAINER, SKU_TYPES, SWITCH_PANEL_EXPLAINER,
  type Package, type PanelIdentity, type SkuType,
} from "./types";
import { SwitchPanelDialog } from "./components/SwitchPanelDialog";
import { PreviousPanelBar, ReconcileBanner } from "./components/PreviousPanelBar";

// ─────────────────────────────────────────────────────────────────────────────
// The customer-facing price and panel for every bookable Thyrocare package.
//
// Before this change the only editable field on an existing row was the price —
// there was no way at all to change thyrocareSkuId or skuType, which is the
// action this screen most needed. The "switch panel" affordance below is exactly
// that missing action, and it deliberately lives on THIS page rather than a new
// Settings sub-route: two screens editing the same row is how a verified switch
// gets undone by a stray tap on the other one.
//
// What grades the ceremony is not testType but ISACTIVE — an active row is what
// customers are being charged right now.
//
// All axios lives in ./api.ts. Nothing here imports @/lib/api, which is what
// makes the wire guards there (the unknown-key allowlist, the id/type pairing
// assert, the read-back diff) impossible to route around from inside this page.
// ─────────────────────────────────────────────────────────────────────────────

type LoadState =
  | { status: "loading" }
  | { status: "ready" }
  /** Today this state did not exist: load() had no .catch and the page spun
   *  forever on any failure. A blank spinner is the worst possible answer here,
   *  because the packages are still LIVE while we can't see them. */
  | { status: "error"; message: string };

export default function PackagesPage() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });

  const [editingType, setEditingType] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [priceError, setPriceError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  /** Re-typed confirmation for a ×10-or-more price move. See savePrice(). */
  const [priceGateInput, setPriceGateInput] = useState("");

  /**
   * Rows whose live value we NO LONGER KNOW, because a write to them never came
   * back. Keyed by testType, holding what we asked for.
   *
   * A lost response is not a failed write. lib/api.ts sets no axios timeout and
   * nothing here re-read the row, so the old catch showed a red "Update failed"
   * with the table cell behind it still displaying the PRE-WRITE price — two
   * independent surfaces both asserting the old price is live, when the PATCH
   * may well have committed. That is the governing-rule violation (an absent
   * signal rendered as a positive assurance) on the customer price itself.
   */
  const [unknownRows, setUnknownRows] = useState<Record<string, string>>({});
  const markUnknown = (testType: string, asked: string) =>
    setUnknownRows((prev) => ({ ...prev, [testType]: asked }));
  const clearUnknown = (testType: string) =>
    setUnknownRows((prev) => {
      if (!(testType in prev)) return prev;
      const next = { ...prev };
      delete next[testType];
      return next;
    });

  const [switchFor, setSwitchFor] = useState<Package | null>(null);
  const [restoreSnapshot, setRestoreSnapshot] = useState<(PanelIdentity & { isActive: boolean }) | null>(null);

  const [deactivate, setDeactivate] = useState<Package | null>(null);
  const [togglingType, setTogglingType] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    testType: "", displayName: "", thyrocareSkuId: "", price: "",
    // NOT "OFFER". Defaulting a SKU type on a form that creates real bookable
    // rows is the same hazard as trap 1: the operator ships whatever was
    // pre-selected, and a wrong type makes Thyrocare reject the order after the
    // customer has paid. Empty, and submit is blocked until it's chosen.
    skuType: "" as SkuType | "",
    description: "", requiresFasting: true,
    fastingHours: "12", displayOrder: "", isActive: false,
  });
  const [addError, setAddError] = useState("");
  const [creating, setCreating] = useState(false);

  const [restorePoints, setRestorePoints] = useState<journal.JournalEntry[]>([]);
  /**
   * Bumped by anything that writes the journal. Without it the restore-point
   * effect (declared first, deps [packages]) ran BEFORE the reconcile effect
   * flipped a pending entry to `confirmed`, and nothing recomputed afterwards —
   * so the load that resolved a lost write rendered "Your change did land"
   * directly above "No switch history in this browser yet", with no way back
   * until a full reload.
   */
  const [journalTick, setJournalTick] = useState(0);
  const [reconcile, setReconcile] = useState<
    { entry: journal.JournalEntry; verdict: "confirmed" | "failed" | "unresolved" } | null
  >(null);

  const refresh = useCallback(async () => {
    try {
      const list = await fetchPackages();
      setPackages(list);
      setLoad({ status: "ready" });
      return list;
    } catch (err) {
      setLoad({
        status: "error",
        message: serverMessage(err, (err as Error)?.message || "Couldn't read the packages."),
      });
      return null;
    }
  }, []);

  // Deferred out of the effect body so no setState runs synchronously inside it
  // (react-hooks/set-state-in-effect is an error in this repo).
  useEffect(() => {
    const t = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(t);
  }, [refresh]);

  // The restore point renders from localStorage IMMEDIATELY — undo must not wait
  // on a network round-trip, since the moment you most want it is the moment the
  // last request went wrong.
  useEffect(() => {
    const t = setTimeout(() => {
      // EVERY row, not the string "primary". The switch affordance is on every
      // row in the table, so hardcoding one testType meant a confirmed switch on
      // cardiac/kidney/brain wrote a restore point that was never read while the
      // bar claimed there was no history at all.
      setRestorePoints(journal.allRestorePoints());
    }, 0);
    return () => clearTimeout(t);
  }, [packages, journalTick]);

  // Resolve any write we never saw the end of, against the row as it is now.
  useEffect(() => {
    if (load.status !== "ready") return;
    const t = setTimeout(() => {
      // Take the first pending entry WE CAN ACTUALLY RESOLVE. Taking [0] blindly
      // meant one entry for a row that no longer exists parked the reconciler
      // forever and hid every other pending write behind it.
      const entry = journal
        .pendingEntries()
        .find((e) => packages.some((p) => p.testType === e.testType));
      if (!entry) return;
      const live = packages.find((p) => p.testType === entry.testType);
      if (!live) return;
      const verdict = journal.reconcile(entry, {
        displayName: live.displayName,
        description: live.description,
        thyrocareSkuId: live.thyrocareSkuId,
        skuType: live.skuType,
        pricePaise: live.pricePaise,
        requiresFasting: live.requiresFasting,
        fastingHours: live.fastingHours,
        isActive: live.isActive,
      });
      journal.setStatus(entry.id, verdict);
      setReconcile({ entry, verdict });
      // The journal just moved. Recompute the restore points off it.
      setJournalTick((n) => n + 1);
    }, 0);
    return () => clearTimeout(t);
  }, [load.status, packages]);

  const applyRow = (row: Package) => {
    setPackages((prev) => prev.map((p) => (p.testType === row.testType ? row : p)));
    // A row we just read back from the server is a row we know again.
    clearUnknown(row.testType);
    setRestorePoints(journal.allRestorePoints());
  };

  // ── Inline price edit (unchanged behaviour, one conversion) ───────────────
  const openEdit = (p: Package) => {
    setEditingType(p.testType);
    setPriceInput(rupeeInputFromPaise(p.pricePaise));
    setPriceError("");
    setPriceGateInput("");
  };
  const cancelEdit = () => {
    setEditingType(null);
    setPriceInput("");
    setPriceError("");
    setPriceGateInput("");
  };

  // ── The pencil is a price-change path, so it carries the price-change guards ─
  //
  // THIS IS WHERE THE MONEY ACTUALLY MOVES. The switch dialog had the magnitude
  // gate, the write-ahead journal and the lost-response handling; this cell —
  // the shortest and most obvious way to reprice the live package, two taps from
  // the table — had none of them. The identical keystroke was stopped dead at
  // ×130 inside the dialog and waved straight through here, and the screen spends
  // the whole session printing "sent as pricePaise 129900" under every price
  // field, which is precisely the number an operator then types.
  const parsedPrice = parseRupees(priceInput);
  const editingRow = packages.find((p) => p.testType === editingType) ?? null;
  const priceGateNeeded =
    !!editingRow && parsedPrice.ok && needsMagnitudeGate(editingRow.pricePaise, parsedPrice.paise);
  const priceGateParsed = parseRupees(priceGateInput);
  // Compare PARSED paise, not raw strings: "2929" and "2929.00" are one price.
  const priceGateSatisfied =
    !priceGateNeeded ||
    (priceGateParsed.ok && parsedPrice.ok && priceGateParsed.paise === parsedPrice.paise);

  const savePrice = async (p: Package) => {
    if (savingRef.current) return;
    setPriceError("");
    // ONE conversion for the whole module. parseRupees rejects rather than
    // rounds — see money.ts for why parseFloat was wrong three separate ways.
    const parsed = parseRupees(priceInput);
    if (!parsed.ok) {
      setPriceError(parsed.reason);
      return;
    }
    // No-op guard, preserved from the original.
    if (parsed.paise === p.pricePaise) {
      cancelEdit();
      return;
    }
    if (needsMagnitudeGate(p.pricePaise, parsed.paise)) {
      const g = parseRupees(priceGateInput);
      if (!g.ok || g.paise !== parsed.paise) {
        setPriceError("Re-type the new price below to confirm a change this large.");
        return;
      }
    }
    savingRef.current = true;
    setSaving(true);

    // WRITE-AHEAD, same as the switch dialog. Recorded BEFORE the request so a
    // dead tab or a lost response still leaves the previous price recoverable —
    // the server keeps no history of it. A 100× typo committed from this cell
    // used to be unrecoverable as well as ungated.
    const identity = {
      displayName: p.displayName,
      description: p.description ?? "",
      thyrocareSkuId: p.thyrocareSkuId,
      skuType: p.skuType as SkuType,
      requiresFasting: p.requiresFasting,
      fastingHours: p.fastingHours,
      isActive: p.isActive,
    };
    const entry = journal.beginSwitch(
      p.testType,
      { ...identity, pricePaise: p.pricePaise },
      { ...identity, pricePaise: parsed.paise },
      p.updatedAt,
    );

    try {
      // pricePaise, NEVER price. The backend's Zod schema is z.object() and not
      // .strict(), so a "price" key would be dropped in silence and still return
      // 200 with the OLD price live. Do not "correct" this toward the handoff doc.
      const result = await patchPackage(p.testType, { pricePaise: parsed.paise }, p);
      if (result.kind === "partial") {
        // A 200 alone is never a success. Say what actually stored.
        journal.setStatus(entry.id, "unresolved");
        setPriceError(
          `The server stored ${rupeesExact(result.row.pricePaise)}, not ${rupeesExact(parsed.paise)}. That is what customers are being charged.`,
        );
        applyRow(result.row);
      } else if (result.kind === "noOp") {
        journal.discard(entry.id);
        toast.info("The server accepted the request and changed nothing.");
        applyRow(result.row);
        cancelEdit();
      } else {
        journal.setStatus(entry.id, "confirmed");
        toast.success(`${result.row.displayName} → ${rupees(result.row.pricePaise)}`);
        applyRow(result.row);
        cancelEdit();
      }
      setJournalTick((n) => n + 1);
    } catch (err) {
      if (isNoResponse(err)) {
        // A TIMEOUT IS NOT PROOF THE WRITE DIDN'T LAND. Leave the entry pending
        // for the reconciler, and stop the table asserting the old price — we do
        // not know it any more.
        markUnknown(p.testType, rupeesExact(parsed.paise));
        setPriceError(
          `We didn't hear back, so we don't know whether ${rupeesExact(parsed.paise)} applied. Nothing was retried. Re-read the package to see what customers are being charged.`,
        );
      } else {
        journal.setStatus(entry.id, "failed");
        setPriceError(serverMessage(err, "Update failed"));
      }
      setJournalTick((n) => n + 1);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  /** Re-read one row from the server. The ONLY offered action after a lost
   *  response — a blind retry could apply the same change twice. */
  const rereadRow = async (testType: string) => {
    try {
      const live = await fetchPackage(testType);
      applyRow(live);
      setPriceError("");
      toast.info(`${live.displayName} is ${rupees(live.pricePaise)} on the server.`);
    } catch (err) {
      toast.error(serverMessage(err, "Couldn't re-read that package."));
    }
  };

  // ── Active toggle ─────────────────────────────────────────────────────────
  const setActive = async (p: Package, next: boolean) => {
    setTogglingType(p.testType);
    setDeactivate(null);
    try {
      // NO OPTIMISTIC FLIP. The previous version painted the new state first and
      // reverted on failure; the row now moves only when the server says so.
      const result = await patchPackage(p.testType, { isActive: next }, p);
      applyRow(result.row);
      if (result.kind === "noOp") {
        toast.info(`${p.displayName} was already ${next ? "active" : "inactive"}.`);
      } else if (result.kind === "partial") {
        toast.error(`The server did not apply that — ${p.displayName} is still ${result.row.isActive ? "active" : "inactive"}.`);
      } else {
        toast.success(`${p.displayName} ${next ? "activated" : "deactivated"}`);
      }
    } catch (err) {
      if (isNoResponse(err)) {
        // Same rule as the price. Per ACTIVE_EXPLAINER a landed deactivate hands
        // pricing to env config this screen cannot read, so a bare "Update
        // failed" here is also a false all-clear about money.
        markUnknown(p.testType, next ? "active" : "inactive");
        toast.error(
          `We didn't hear back — we don't know whether ${p.displayName} is ${next ? "active" : "inactive"} now. Re-read it.`,
        );
      } else {
        toast.error(serverMessage(err, "Update failed"));
      }
    } finally {
      setTogglingType(null);
    }
  };

  // ── Add package ───────────────────────────────────────────────────────────
  const openAdd = () => {
    setAddForm({
      testType: "", displayName: "", thyrocareSkuId: "", price: "",
      skuType: "", description: "", requiresFasting: true,
      fastingHours: "12", displayOrder: String(packages.length), isActive: false,
    });
    setAddError("");
    setAddOpen(true);
  };

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError("");
    const fail = (msg: string) => setAddError(msg);

    const testType = addForm.testType.trim().toLowerCase();
    if (!/^[a-z0-9_]+$/.test(testType)) return fail("testType must be lowercase letters, digits, or underscores");
    if (!addForm.displayName.trim()) return fail("Display name required");
    if (!addForm.thyrocareSkuId.trim()) return fail("Thyrocare SKU required");
    // The Zod create schema defaults skuType to 'OFFER' when omitted
    // (admin.controller.ts:3725), so an unanswered select would quietly create an
    // OFFER row. Refuse instead of guessing.
    if (addForm.skuType === "") return fail("Choose the SKU type — it is not something we can guess.");

    const parsed = parseRupees(addForm.price);
    if (!parsed.ok) return fail(parsed.reason);

    const fastingHours = parseInt(addForm.fastingHours, 10);
    if (!Number.isInteger(fastingHours) || fastingHours < 0 || fastingHours > 24) return fail("Fasting hours must be 0–24");

    const displayOrder = parseInt(addForm.displayOrder, 10);
    if (!Number.isInteger(displayOrder) || displayOrder < 0) return fail("Display order must be ≥ 0");

    setCreating(true);
    try {
      await createPackage({
        testType,
        displayName: addForm.displayName.trim(),
        thyrocareSkuId: addForm.thyrocareSkuId.trim(),
        pricePaise: parsed.paise,
        skuType: addForm.skuType,
        description: addForm.description.trim() || undefined,
        requiresFasting: addForm.requiresFasting,
        fastingHours,
        displayOrder,
        isActive: addForm.isActive,
      });
      toast.success(`Created ${addForm.displayName.trim()}${addForm.isActive ? "" : " (inactive)"}`);
      setAddOpen(false);
      void refresh();
    } catch (err) {
      if (statusOf(err) === 409) return fail(`A package with testType "${testType}" already exists`);
      setAddError(serverMessage(err, "Create failed"));
    } finally {
      setCreating(false);
    }
  };

  /**
   * Open the restore dialog ON THE ROW THE SNAPSHOT CAME FROM.
   *
   * This used to ignore the entry's testType entirely and unconditionally do
   * `setSwitchFor(primary)`. The journal records testType correctly and
   * reconcile() resolves against the right row — then the identity was thrown
   * away at the handoff. Since the SKU affordance is on every row (prod has 6,
   * dev 8), an unresolved kidney/cardiac switch offered "Restore what it was",
   * and two taps later PRIMARY — the only live, customer-facing package — was
   * wearing another panel's SKU and price, under a dialog captioned "these are
   * the exact values the server held before the switch", which was a false
   * statement about that row. The ×2 price move slid under the magnitude gate.
   *
   * Refuses LOUDLY when the row is gone rather than falling back to anything.
   */
  const openRestore = (
    testType: string,
    snapshot: PanelIdentity & { isActive: boolean },
  ) => {
    const target = packages.find((p) => p.testType === testType);
    if (!target) {
      toast.error(
        `Can't restore: there is no "${testType}" package on this server any more. Nothing was changed.`,
      );
      return;
    }
    setRestoreSnapshot(snapshot);
    setSwitchFor(target);
    setReconcile(null);
  };

  return (
    <AdminLayout title="Packages">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Customer-facing price and Thyrocare panel for each bookable package. Changes affect new
            bookings only — existing bookings keep the amount and SKU they were created with.
          </p>
          <Button size="sm" className="shrink-0" onClick={openAdd}>
            <Plus size={15} /> Add package
          </Button>
        </div>

        {reconcile && (
          <ReconcileBanner
            entry={reconcile.entry}
            verdict={reconcile.verdict}
            onRestore={openRestore}
            onDismiss={() => setReconcile(null)}
          />
        )}

        <PreviousPanelBar entries={restorePoints} onRestore={openRestore} />

        {load.status === "loading" ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : load.status === "error" ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <div className="flex items-center gap-1.5 font-medium">
              <AlertTriangle size={15} /> We can&rsquo;t read the packages.
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              They&rsquo;re still live and customers are still being charged — we just can&rsquo;t
              see what. The server said: {load.message}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2.5"
              onClick={() => { setLoad({ status: "loading" }); void refresh(); }}
            >
              Try again
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Package</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Fasting</TableHead>
                  <TableHead>
                    <span className="flex items-center gap-1.5">
                      Active <InfoTip label={ACTIVE_EXPLAINER} />
                    </span>
                  </TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packages.length === 0 ? (
                  // NOT "no packages configured". A well-formed empty list is
                  // the server telling us it has none to show — which is not the
                  // same as none existing, and customers may still be charged
                  // from the env fallback (see ACTIVE_EXPLAINER).
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                    The server returned no packages. That is not the same as there being none —
                    bookings can still be priced from environment config this screen can&rsquo;t read.
                  </TableCell></TableRow>
                ) : packages.map((p) => {
                  const editing = editingType === p.testType;
                  return (
                    <TableRow key={p.testType} className={cn(!p.isActive && "opacity-60")}>
                      <TableCell className="text-muted-foreground tabular-nums">{p.displayOrder}</TableCell>
                      <TableCell>
                        <div className="font-medium">{p.displayName}</div>
                        <div className="font-mono text-xs text-muted-foreground">{p.testType}</div>
                      </TableCell>
                      <TableCell>
                        {/* The SKU cell is now the entry point for the switch —
                            mirroring the pencil affordance the price cell has. A
                            live row whose id isn't in Thyrocare's catalog renders
                            calmly here: the table never accuses an existing row
                            of being invalid. */}
                        <button
                          type="button"
                          onClick={() => { setRestoreSnapshot(null); setSwitchFor(p); }}
                          className="group inline-flex items-start gap-1.5 text-left hover:text-primary transition-colors"
                        >
                          <span>
                            <span className="block font-mono text-xs">{p.thyrocareSkuId}</span>
                            <span className="block text-xs text-muted-foreground">{p.skuType}</span>
                          </span>
                          <Repeat size={13} className="mt-0.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                        </button>
                      </TableCell>
                      <TableCell className="text-sm">
                        {p.requiresFasting ? `${p.fastingHours}h` : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={p.isActive}
                            aria-label={`${p.isActive ? "Deactivate" : "Activate"} ${p.displayName}`}
                            disabled={togglingType === p.testType}
                            onClick={() => (p.isActive ? setDeactivate(p) : setActive(p, true))}
                            className={cn(
                              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                              p.isActive ? "bg-primary" : "bg-muted-foreground/30"
                            )}
                          >
                            <span
                              className={cn(
                                "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                                p.isActive ? "translate-x-[18px]" : "translate-x-0.5"
                              )}
                            />
                          </button>
                          <span className={cn("text-xs", p.isActive ? "text-foreground" : "text-muted-foreground")}>
                            {togglingType === p.testType ? "…" : p.isActive ? "Active" : "Inactive"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {editing ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1">
                              <span className="text-sm text-muted-foreground">₹</span>
                              {/* text + inputMode, never type="number" — see PriceField. */}
                              <Input
                                type="text"
                                inputMode="decimal"
                                autoFocus
                                className="h-8 w-28 tabular-nums"
                                value={priceInput}
                                onChange={(e) => setPriceInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") savePrice(p);
                                  if (e.key === "Escape") cancelEdit();
                                }}
                                disabled={saving}
                              />
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                disabled={saving || !priceGateSatisfied}
                                onClick={() => savePrice(p)}
                              >
                                {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                              </Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8" disabled={saving} onClick={cancelEdit}>
                                <X size={15} />
                              </Button>
                            </div>
                            <PaiseEcho raw={priceInput} />

                            {/* The ×10 gate, on the path where the money actually
                                moves. Same rule and same copy as the dialog, so
                                the two can't drift apart. */}
                            {priceGateNeeded && parsedPrice.ok && (
                              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2">
                                <p className="text-[11px] font-medium text-destructive">
                                  {(() => {
                                    const r = priceRatio(p.pricePaise, parsedPrice.paise);
                                    if (r === null) return "This is a very large change.";
                                    return r >= MAGNITUDE_GATE_FACTOR
                                      ? `This multiplies the price by ${r.toFixed(0)}.`
                                      : `This cuts the price to a ${(1 / r).toFixed(0)}th of what it was.`;
                                  })()}{" "}
                                  Re-type it to confirm:
                                </p>
                                <div className="mt-1 flex items-center gap-1">
                                  <span className="text-xs text-muted-foreground">₹</span>
                                  <Input
                                    type="text"
                                    inputMode="decimal"
                                    value={priceGateInput}
                                    onChange={(e) => setPriceGateInput(e.target.value)}
                                    className="h-7 w-28 tabular-nums"
                                    placeholder={rupeeInputFromPaise(parsedPrice.paise)}
                                    disabled={saving}
                                  />
                                </div>
                              </div>
                            )}

                            {priceError && <span className="text-xs text-destructive">{priceError}</span>}
                            {unknownRows[p.testType] !== undefined && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 w-fit"
                                onClick={() => rereadRow(p.testType)}
                              >
                                Re-read the package
                              </Button>
                            )}
                          </div>
                        ) : unknownRows[p.testType] !== undefined ? (
                          // WE DO NOT KNOW THIS PRICE. Showing the pre-write
                          // value here is the assurance the governing rule
                          // forbids — the write may well have landed.
                          <div className="flex flex-col items-start gap-1">
                            <span className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                              <AlertTriangle size={13} /> Unknown
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              Last shown {rupees(p.pricePaise)}; we asked for {unknownRows[p.testType]} and
                              never heard back.
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7"
                              onClick={() => rereadRow(p.testType)}
                            >
                              Re-read
                            </Button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openEdit(p)}
                            className="group inline-flex items-center gap-1.5 font-medium tabular-nums hover:text-primary transition-colors"
                          >
                            {rupees(p.pricePaise)}
                            <Pencil size={13} className="opacity-0 group-hover:opacity-60 transition-opacity" />
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(p.updatedAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          </div>
        )}

        {load.status === "ready" && packages.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Tap a SKU to switch which Thyrocare panel customers get.{" "}
            <InfoTip label={SWITCH_PANEL_EXPLAINER} />
          </p>
        )}
      </div>

      {switchFor && (
        <SwitchPanelDialog
          // Keyed so each opening is a FRESH MOUNT. The dialog seeds its draft
          // from useState initialisers, so without this a second open would
          // still be showing the first row's values.
          key={`${switchFor.testType}:${restoreSnapshot ? "restore" : "edit"}:${switchFor.updatedAt}`}
          open={!!switchFor}
          onOpenChange={(v) => { if (!v) { setSwitchFor(null); setRestoreSnapshot(null); } }}
          pkg={switchFor}
          restoreFrom={restoreSnapshot}
          onDone={applyRow}
        />
      )}

      {/* Deactivation used to be a single optimistic tap with no confirmation at
          all. It now says what switching a row off actually does — which is not
          what the word "inactive" implies. */}
      <Dialog open={!!deactivate} onOpenChange={(v) => { if (!v) setDeactivate(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Switch {deactivate?.displayName} off?</DialogTitle>
            <DialogDescription>
              This does <span className="font-medium text-foreground">not</span> stop bookings.
              The server falls back to environment config this screen can&rsquo;t read, so customers
              keep being charged — we just stop knowing how much. To change what a customer pays,
              change the price or the SKU instead.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setDeactivate(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={togglingType === deactivate?.testType}
              onClick={() => deactivate && setActive(deactivate, false)}
            >
              Switch it off anyway
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={(v) => { if (!creating) setAddOpen(v); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add package</DialogTitle>
            <DialogDescription>
              Creates a new bookable package. Only add a Thyrocare SKU confirmed live by Adhish — a wrong/inactive SKU makes orders fail at Thyrocare. New packages start inactive.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitAdd} className="flex flex-col gap-3 mt-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="testType">testType (slug)</Label>
                <Input id="testType" placeholder="liver" value={addForm.testType}
                  onChange={(e) => setAddForm({ ...addForm, testType: e.target.value })} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="displayName">Display name</Label>
                <Input id="displayName" placeholder="LIVER HEALTH" value={addForm.displayName}
                  onChange={(e) => setAddForm({ ...addForm, displayName: e.target.value })} required />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="thyrocareSkuId">Thyrocare SKU</Label>
                <Input id="thyrocareSkuId" placeholder="PROJ10628XX" value={addForm.thyrocareSkuId}
                  onChange={(e) => setAddForm({ ...addForm, thyrocareSkuId: e.target.value })} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="skuType" className="flex items-center gap-1.5">
                  SKU type <InfoTip label="Thyrocare has three: OFFER, SSKU and PSKU. There is no safe default — if the type doesn't match the SKU, the lab rejects the order after the customer has paid, so you have to say which it is." />
                </Label>
                <select id="skuType" value={addForm.skuType} required
                  onChange={(e) => setAddForm({ ...addForm, skuType: e.target.value as SkuType | "" })}
                  className={cn(
                    "h-9 rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                    addForm.skuType === "" ? "border-amber-500/50" : "border-input",
                  )}>
                  <option value="" disabled>Choose…</option>
                  {SKU_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="price">Price (₹)</Label>
                <Input id="price" type="text" inputMode="decimal" placeholder="1999" value={addForm.price}
                  onChange={(e) => setAddForm({ ...addForm, price: e.target.value })} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fastingHours">Fasting (h)</Label>
                <Input id="fastingHours" type="number" min={0} max={24} value={addForm.fastingHours}
                  onChange={(e) => setAddForm({ ...addForm, fastingHours: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="displayOrder">Order</Label>
                <Input id="displayOrder" type="number" min={0} value={addForm.displayOrder}
                  onChange={(e) => setAddForm({ ...addForm, displayOrder: e.target.value })} />
              </div>
            </div>
            <PaiseEcho raw={addForm.price} />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="description">Description (optional)</Label>
              <Input id="description" value={addForm.description}
                onChange={(e) => setAddForm({ ...addForm, description: e.target.value })} />
            </div>

            <div className="flex items-center gap-6">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={addForm.requiresFasting}
                  onChange={(e) => setAddForm({ ...addForm, requiresFasting: e.target.checked })} />
                <span className="text-sm">Requires fasting</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={addForm.isActive}
                  onChange={(e) => setAddForm({ ...addForm, isActive: e.target.checked })} />
                <span className="text-sm">Active immediately</span>
              </label>
            </div>

            {addError && <p className="text-sm text-destructive">{addError}</p>}
            <div className="flex justify-end gap-2 mt-1">
              <Button type="button" variant="ghost" disabled={creating} onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={creating}>{creating ? "Creating…" : "Create package"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

/**
 * The raw integer that goes on the wire, echoed under every rupee input.
 *
 * A misplaced decimal point is invisible in rupees (₹99900 vs ₹9990.0 read the
 * same at a glance) and unmissable as a digit count in a monospaced integer.
 * Renders nothing while the field is empty — an absent price is not a price of
 * zero, and showing "0" would be exactly that claim.
 */
function PaiseEcho({ raw }: { raw: string }) {
  if (raw.trim() === "") return null;
  const parsed = parseRupees(raw);
  if (!parsed.ok) return <span className="text-[11px] text-destructive">{parsed.reason}</span>;
  return (
    <span className="text-[11px] text-muted-foreground">
      Customers pay <span className="font-medium text-foreground">{rupeesExact(parsed.paise)}</span>{" "}
      · sent as pricePaise <span className="font-mono text-foreground">{parsed.paise}</span>
    </span>
  );
}
