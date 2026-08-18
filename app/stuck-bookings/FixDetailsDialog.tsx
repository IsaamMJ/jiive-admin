"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, CalendarClock } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import api from "@/lib/api";
import {
  type StuckBooking, type FixDetailsRequest, type FixDetailsResponse,
  type FixDetailsSuccess, type FixDetailsPartial,
  isFixDetailsSuccess, isFixDetailsPartial,
  stuckBookingStoredDob, stuckBookingStoredGender, stuckBookingStoredGenderRaw, stuckBookingPatientTarget,
  rupees, whyStuck,
} from "./types";

interface Props {
  booking: StuckBooking | null;
  onClose: () => void;
  /**
   * Silent list reload — safe to call while this dialog stays open (see
   * RescheduleDialog / OrphanReports). `affectedBookingIds` is passed through
   * from a successful save's response (see FixDetailsSuccess) so the page can
   * gate the plain Retry button on every booking sharing the shared Address
   * row, not just this one.
   */
  onSaved: (affectedBookingIds?: string[]) => void;
  /**
   * Reuses the page's existing retry-order call so this dialog never
   * duplicates that logic. Resolves `true` only on an actual placed order —
   * a business refusal (wallet empty, slot gone, ...) resolves `false` so
   * this dialog can stay open on the outcome view instead of vanishing on a
   * failure the operator never got a durable look at.
   */
  onRetry: (booking: StuckBooking) => Promise<boolean>;
  /** Hands off to the page's existing RescheduleDialog rather than rebuilding a slot picker here. */
  onOpenReschedule: (booking: StuckBooking) => void;
}

/** UTF-8 byte length — matches the backend's `byteLength` (address-budget.ts). */
function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

interface Snapshot {
  address: string;
  pincode: string;
  patientName: string;
  dob: string;
  gender: "male" | "female" | "";
  /** Trimmed/lowercased raw stored gender — see stuckBookingStoredGenderRaw. */
  genderRaw: string;
}

function snapshotOf(b: StuckBooking): Snapshot {
  return {
    address: b.addressText ?? "",
    pincode: b.address ? String(b.address.pincode) : "",
    patientName: b.patientName ?? "",
    dob: stuckBookingStoredDob(b) ?? "",
    gender: stuckBookingStoredGender(b),
    genderRaw: stuckBookingStoredGenderRaw(b),
  };
}

/**
 * "Fix & Retry" — edit the four fields a real stuck booking has actually needed
 * (address, pincode, patient name, dob/gender), then save and retry, all from
 * this page. Exists because of the Khalam incident (2026-08-17): two paid
 * bookings sat stuck with no way to fix the rejected address short of a raw SQL
 * UPDATE against prod RDS.
 *
 * All three guards live on the backend (G1 address budget, G2 pincode
 * serviceability, G3 already-placed-order refusal) — this dialog never
 * duplicates that logic, it just sends the diff and renders whatever the
 * backend decides. A business refusal keeps the form open with input intact;
 * only a genuine success or partial-write locks it into an outcome view.
 */
export function FixDetailsDialog({ booking, onClose, onSaved, onRetry, onOpenReschedule }: Props) {
  const open = booking !== null;

  const [address, setAddress] = useState("");
  const [pincode, setPincode] = useState("");
  const [patientName, setPatientName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "">("");
  const [confirmAck, setConfirmAck] = useState(false);
  const [nameOverrideAck, setNameOverrideAck] = useState(false);
  const [initial, setInitial] = useState<Snapshot | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [outcome, setOutcome] = useState<FixDetailsSuccess | FixDetailsPartial | null>(null);
  const [retrying, setRetrying] = useState(false);

  // (Re)initialise whenever a new booking opens the dialog.
  useEffect(() => {
    if (!booking) return;
    const snap = snapshotOf(booking);
    setAddress(snap.address);
    setPincode(snap.pincode);
    setPatientName(snap.patientName);
    setDob(snap.dob);
    setGender(snap.gender);
    setInitial(snap);
    setConfirmAck(false);
    setNameOverrideAck(false);
    setSaveError("");
    setOutcome(null);
  }, [booking]);

  const alreadyPlaced = !!booking?.thyrocareOrderId;

  // G7, mirrored client-side purely so the confirm checkbox can appear before
  // the round trip — the backend re-checks this itself and is the real guard.
  const dobDiffers = !!initial && initial.dob !== "" && dob.trim() !== "" && dob !== initial.dob;
  // Compares against the RAW stored value, not the male/female-normalised one
  // used to prefill the Select — a legacy row holding something else entirely
  // must still trip this, exactly like the backend's own G7 check does.
  const genderDiffers = !!initial && initial.genderRaw !== "" && gender !== "" && gender !== initial.genderRaw;
  // The client-side check is a SNAPSHOT taken when the dialog opened — if the
  // stored dob/gender changed concurrently (another admin, or the customer via
  // Lumi) between then and Save, this can under-detect while the backend's own
  // fresh-read G7 correctly refuses. Rather than leave that a dead end, also
  // trust the backend's own refusal text: it can only ever ask for
  // confirmIdentityOverwrite when a real overwrite is happening, so treat that
  // response as authoritative and show the checkbox retroactively.
  const backendFlaggedIdentityOverwrite = /confirmIdentityOverwrite/i.test(saveError);
  const needsConfirm = dobDiffers || genderDiffers || backendFlaggedIdentityOverwrite;

  // Same pattern for G4 (name plausibility) — the backend's confirmNameOverride
  // ask is the one place this escape hatch is reachable from the console.
  const backendFlaggedNameOverride = /confirmNameOverride/i.test(saveError);

  function buildBody(): FixDetailsRequest {
    if (!initial) return {};
    const body: FixDetailsRequest = {};
    if (address.trim() !== initial.address.trim()) body.address = address.trim();
    if (pincode.trim() !== initial.pincode.trim()) body.pincode = pincode.trim();
    if (patientName.trim() !== initial.patientName.trim()) body.patientName = patientName.trim();
    if (dob !== initial.dob && dob.trim() !== "") body.patientDob = dob;
    if (gender !== initial.gender && gender !== "") body.patientGender = gender;
    if (needsConfirm) body.confirmIdentityOverwrite = confirmAck;
    if (backendFlaggedNameOverride) body.confirmNameOverride = nameOverrideAck;
    return body;
  }

  const pendingBody = buildBody();
  const hasChanges = Object.keys(pendingBody).some(
    (k) => k !== "confirmIdentityOverwrite" && k !== "confirmNameOverride",
  );
  const canSave =
    !alreadyPlaced &&
    !outcome &&
    hasChanges &&
    (!needsConfirm || confirmAck) &&
    (!backendFlaggedNameOverride || nameOverrideAck) &&
    !saving;

  async function handleSave() {
    if (!booking) return;
    setSaving(true);
    setSaveError("");
    try {
      const { data } = await api.post<FixDetailsResponse>(
        `/bookings/${booking.id}/fix-details`,
        buildBody(),
      );
      if (isFixDetailsSuccess(data) || isFixDetailsPartial(data)) {
        setOutcome(data);
        onSaved(isFixDetailsSuccess(data) ? data.affectedBookingIds : undefined);
        if (!isFixDetailsSuccess(data)) {
          toast.warning(`${booking.patientName}: some fields saved, then a write failed — see the dialog.`);
        }
      } else {
        setSaveError(data.error + (data.orderId ? ` (order ${data.orderId})` : ""));
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string | string[]; error?: string } } };
      const msg = e.response?.data?.message;
      setSaveError(
        (Array.isArray(msg) ? msg.join("; ") : msg) ?? e.response?.data?.error ?? "Could not save these changes.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRetry() {
    if (!booking) return;
    setRetrying(true);
    try {
      const placed = await onRetry(booking);
      // Close ONLY on an actual placed order. A business refusal (wallet
      // empty, slot gone, some rejection G1/G2 don't model) already showed a
      // toast, but a toast is dismissable and not a durable record — closing
      // the dialog anyway would make the booking look handled while it is
      // still stuck, with nothing left on screen to say so. Stay on the
      // outcome view instead, where Reschedule/Retry are still one click away.
      if (placed) onClose();
    } finally {
      setRetrying(false);
    }
  }

  function handleReschedule() {
    if (!booking) return;
    // Pre-save only: post-save, `outcome` is set and there is nothing pending
    // to lose (the edit already landed) — don't ask.
    if (
      !outcome &&
      hasChanges &&
      !window.confirm(
        "This booking has unsaved edits — opening Reschedule now will discard them without saving. Continue?",
      )
    ) {
      return;
    }
    // Hand off with the address the save just resolved (pincode/city/state) so
    // the slot picker checks the RIGHT area — the row in `bookings` may not
    // have refreshed from onSaved() yet by the time this is clicked.
    const merged: StuckBooking =
      outcome && isFixDetailsSuccess(outcome) && outcome.address && booking.address
        ? {
            ...booking,
            address: {
              ...booking.address,
              pincode: outcome.address.pincode,
              city: outcome.address.city,
              state: outcome.address.state,
            },
          }
        : booking;
    onClose();
    onOpenReschedule(merged);
  }

  const target = booking ? stuckBookingPatientTarget(booking) : "account_holder";
  const attemptsExhausted = !!booking && booking.thyrocareCreateAttempts >= 6;
  const budget = booking?.addressBudget ?? null;
  const addressAlreadyBroken = !!budget && (budget.aboveCap || budget.belowFloor || budget.trims.length > 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !saving && !retrying) onClose(); }}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Fix &amp; Retry</DialogTitle>
          <DialogDescription>
            {booking ? (
              <>
                Edits{" "}
                <span className="font-medium text-foreground">{booking.patientName}</span>
                {"'"}s address and identity, then retries the Thyrocare order —{" "}
                {target === "family_member" ? "a family member on this account." : "the account holder."}
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {!booking ? null : outcome ? (
          <OutcomeView
            outcome={outcome}
            amount={booking.amount}
            retrying={retrying}
            onRetry={handleRetry}
            onReschedule={handleReschedule}
            onClose={onClose}
          />
        ) : alreadyPlaced ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            This booking already has a Thyrocare order ({booking.thyrocareOrderId}). Editing it here would
            place a second order for the same customer — use the Thyrocare reschedule flow instead. Nothing
            can be changed from this dialog.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Why it's stuck — the reason this dialog exists, shown first. */}
            {booking.lastOrderError && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                  <AlertTriangle size={14} /> Why it{"'"}s stuck
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{whyStuck(booking.lastOrderError).label}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {booking.thyrocareCreateAttempts} of 6 retry attempts already used
                  {attemptsExhausted && " — the cap is exhausted, this save is what unblocks it"}.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={handleReschedule}
              className="flex items-center gap-1.5 self-start text-xs text-primary hover:underline"
            >
              <CalendarClock size={13} /> Or open Reschedule to pick a new date/slot instead
            </button>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fd-address">Address</Label>
              <textarea
                id="fd-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                disabled={saving}
                rows={3}
                className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-base leading-relaxed transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm dark:bg-input/30"
              />
              {budget && (() => {
                // LIVE as the operator types — recomputed from the textarea on
                // every render, not the one-time server snapshot from when the
                // dialog opened. A pincode edit changes the budget itself
                // (city/state length), which this cannot know without a round
                // trip, so it is called out rather than shown as if exact.
                const liveUsedBytes = utf8ByteLength(address);
                const pincodeEdited = pincode.trim() !== (initial?.pincode.trim() ?? "");
                const overBudget = !pincodeEdited && liveUsedBytes > budget.budgetBytes;
                return (
                  <p className={cn("text-[11px]", (addressAlreadyBroken || overBudget) ? "text-destructive" : "text-muted-foreground")}>
                    {liveUsedBytes} bytes typed
                    {pincodeEdited ? (
                      <> — the budget itself will shift with the new pincode; re-checked for real on Save.</>
                    ) : (
                      <>
                        {" "}of a {budget.budgetBytes}-byte budget for{" "}
                        {booking.address?.city}, {booking.address?.state} {booking.address?.pincode}
                        {overBudget && ` — ${liveUsedBytes - budget.budgetBytes} over`}
                        {!overBudget && addressAlreadyBroken && " — the SAVED address is already over budget, which is very likely why the order was rejected"}.
                        {" "}Saving re-checks this for real; it will refuse rather than trim silently.
                      </>
                    )}
                  </p>
                );
              })()}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fd-pincode">Pincode</Label>
              <Input
                id="fd-pincode"
                value={pincode}
                onChange={(e) => setPincode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
                disabled={saving}
                inputMode="numeric"
                className="w-32"
              />
              <p className="text-[11px] text-muted-foreground">
                Changing this re-checks Thyrocare serviceability before saving, and clears the saved locality —
                a wrong slot for the old area is a common way this booking got stuck in the first place.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fd-name">Patient name</Label>
              <Input id="fd-name" value={patientName} onChange={(e) => setPatientName(e.target.value)} disabled={saving} />
              <p className="text-[11px] text-muted-foreground">This is what prints on the lab report.</p>
              {backendFlaggedNameOverride && (
                <div className="mt-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    This name doesn{"'"}t match the usual pattern (too many words, or a stray digit) — the
                    guard that catches an accidental sentence pasted into this field. Only override it if this
                    genuinely IS the patient{"'"}s full name.
                  </p>
                  <label className="mt-2 flex items-start gap-2 text-xs font-medium">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3.5 w-3.5 accent-amber-500"
                      checked={nameOverrideAck}
                      onChange={(e) => setNameOverrideAck(e.target.checked)}
                    />
                    I{"'"}ve checked this against the customer/ID — save it anyway.
                  </label>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fd-dob">Date of birth</Label>
                <Input
                  id="fd-dob"
                  type="date"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  disabled={saving}
                  max={new Date().toISOString().slice(0, 10)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Gender</Label>
                <Select value={gender} onValueChange={(v) => setGender((v ?? "") as "male" | "female" | "")}>
                  <SelectTrigger className="w-full" disabled={saving}><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {needsConfirm && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  This replaces the stored date of birth / gender with a different value. The lab{"'"}s
                  reference ranges and the bio-age are computed from it — only change this if you{"'"}ve
                  verified the new value with the customer.
                </p>
                <label className="mt-2 flex items-start gap-2 text-xs font-medium">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 accent-amber-500"
                    checked={confirmAck}
                    onChange={(e) => setConfirmAck(e.target.checked)}
                  />
                  I{"'"}ve verified this with the customer — overwrite it.
                </label>
              </div>
            )}

            {saveError && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {saveError}
              </div>
            )}
          </div>
        )}

        {!outcome && !alreadyPlaced && booking && (
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
            <Button type="button" disabled={!canSave} onClick={handleSave}>
              {saving && <Loader2 className="animate-spin" size={15} />}
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OutcomeView({
  outcome, amount, retrying, onRetry, onReschedule, onClose,
}: {
  outcome: FixDetailsSuccess | FixDetailsPartial;
  amount: number;
  retrying: boolean;
  onRetry: () => void;
  onReschedule: () => void;
  onClose: () => void;
}) {
  if (!isFixDetailsSuccess(outcome)) {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
          <p className="text-xs font-semibold text-destructive">Some fields saved, then a write failed</p>
          <p className="mt-1 text-xs text-muted-foreground">{outcome.error}</p>
          {outcome.changed.length > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Already applied: <span className="font-mono">{outcome.changed.join(", ")}</span>
            </p>
          )}
        </div>
        <DialogFooter><Button onClick={onClose}>Close</Button></DialogFooter>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-green-600 dark:text-green-400">
          <CheckCircle2 size={14} /> Saved
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Changed: <span className="font-mono text-foreground">{outcome.changed.join(", ") || "nothing"}</span>
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {outcome.attempts.used} of {outcome.attempts.cap} retry attempts used · {rupees(amount)}
        </p>
      </div>

      {outcome.warnings.map((w, i) => (
        <div key={i} className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
          {w}
        </div>
      ))}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        {outcome.nextStep === "reschedule" ? (
          <Button type="button" onClick={onReschedule}>
            <CalendarClock size={14} /> Reschedule now
          </Button>
        ) : (
          <Button type="button" disabled={retrying} onClick={onRetry}>
            {retrying ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={14} />}
            {retrying ? "Placing…" : "Retry now"}
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}
