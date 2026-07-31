"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, CalendarClock, XCircle, AlertTriangle, ChevronDown } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { RescheduleDialog } from "./RescheduleDialog";
import { OrphanReports } from "./OrphanReports";
import {
  type StuckBooking, type StuckBookingsResponse,
  whyStuck, rupees, toYmd, RETRY_CAP,
} from "./types";

const POLL_MS = 45_000;

interface Group {
  key: string;
  batchId: string | null;
  bookings: StuckBooking[];
}

/** Group by paymentBatchId; single bookings each get their own group. Earliest-first. */
function groupByBatch(bookings: StuckBooking[]): Group[] {
  const map = new Map<string, StuckBooking[]>();
  for (const b of bookings) {
    const key = b.paymentBatchId ?? `single:${b.id}`;
    const arr = map.get(key);
    if (arr) arr.push(b);
    else map.set(key, [b]);
  }
  return [...map.entries()]
    .map(([key, bs]) => ({
      key,
      batchId: bs[0].paymentBatchId,
      bookings: bs.slice().sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime)),
    }))
    .sort((a, b) =>
      a.bookings[0].createdAt.localeCompare(b.bookings[0].createdAt));
}

type Confirm =
  | { type: "retry"; booking: StuckBooking }
  | { type: "cancel"; booking: StuckBooking }
  | { type: "manual"; bookingId: string }
  | null;

/** The manual-order endpoint's response (the old standalone Thyrocare page's shape). */
interface ManualOrderResult {
  success: boolean;
  thyrocareOrderId?: string;
  thyrocareLeadId?: string;
  error?: string;
  details?: unknown;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function StuckBookingsPage() {
  const [bookings, setBookings] = useState<StuckBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [reschedule, setReschedule] = useState<StuckBooking | null>(null);
  const confirmRef = useRef<Confirm>(null);
  confirmRef.current = confirm;

  // Manual order-by-ID tool (the old standalone Thyrocare page, folded in here
  // behind a caution gate). Collapsed by default — it's the escape hatch, not
  // the everyday path.
  const [manualOpen, setManualOpen] = useState(false);
  const [manualBookingId, setManualBookingId] = useState("");
  const [manualLoading, setManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<ManualOrderResult | null>(null);

  const load = useCallback((opts?: { silent?: boolean }) => {
    if (opts?.silent) setRefreshing(true);
    else setLoading(true);
    return api
      .get<StuckBookingsResponse>("/bookings/stuck")
      .then((r) => setBookings(r.data.bookings ?? []))
      .catch(() => {
        if (!opts?.silent) toast.error("Could not load stuck bookings");
      })
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => {
      // Don't yank the list out from under an open action dialog.
      if (!confirmRef.current && !document.hidden) load({ silent: true });
    }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const doRetry = async (b: StuckBooking) => {
    setBusyId(b.id);
    try {
      const { data } = await api.post(`/bookings/${b.id}/retry-order`, {});
      if (data.success) {
        toast.success(`${b.patientName}: order placed (${data.orderId ?? "ok"})`);
      } else if (data.error) {
        toast.error(`${b.patientName}: ${data.error}`);
      } else {
        toast.warning(`${b.patientName}: ${data.message ?? data.reason ?? "still failing"}`);
      }
    } catch (err: unknown) {
      toast.error(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          "Retry failed",
      );
    } finally {
      setBusyId(null);
      load({ silent: true });
    }
  };

  const doCancel = async (b: StuckBooking) => {
    setBusyId(b.id);
    try {
      await api.post(`/bookings/${b.id}/patch`, { status: "cancelled" });
      toast.success(`${b.patientName}: booking cancelled`);
      // Drop it locally for instant feedback; poll will reconcile.
      setBookings((prev) => prev.filter((x) => x.id !== b.id));
    } catch (err: unknown) {
      toast.error(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          "Cancel failed",
      );
      load({ silent: true });
    } finally {
      setBusyId(null);
    }
  };

  const doManualOrder = async (bookingId: string) => {
    setManualLoading(true);
    setManualResult(null);
    try {
      const { data } = await api.post<ManualOrderResult>("/thyrocare/test-order", { bookingId });
      setManualResult(data);
      if (data.success) toast.success(`Order placed (${data.thyrocareOrderId ?? "ok"})`);
      else toast.error(data.error ?? "Order failed");
      // A newly-placed order may clear a stuck row; refresh the list.
      load({ silent: true });
    } catch (err: unknown) {
      const data = (err as { response?: { data?: ManualOrderResult } })?.response?.data;
      setManualResult(data ?? { success: false, error: "Network error" });
      toast.error(data?.error ?? "Order failed");
    } finally {
      setManualLoading(false);
    }
  };

  const runConfirm = async () => {
    const c = confirm;
    if (!c) return;
    setConfirm(null);
    if (c.type === "retry") await doRetry(c.booking);
    else if (c.type === "cancel") await doCancel(c.booking);
    else await doManualOrder(c.bookingId);
  };

  const groups = groupByBatch(bookings);

  return (
    <AdminLayout title="Stuck Bookings">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Paid bookings with no Thyrocare lab order placed. Retry after a wallet top-up,
            reschedule into an open slot, or cancel. Retry &amp; Reschedule place real orders
            and debit the prepaid wallet — they are audited server-side.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={loading || refreshing}
            onClick={() => load({ silent: true })}
          >
            <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {/* Unlinked lab reports — a different defect with a different fix, so it
            gets its own section rather than being merged into the table below. A
            stuck booking HAS a booking row and needs a retry; these have none,
            and need an operator to supply the missing identity. Renders only when
            something is stranded. */}
        <OrphanReports onLinked={() => load({ silent: true })} />

        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : bookings.length === 0 ? (
          <div className="rounded-lg border border-border bg-card py-16 text-center">
            <p className="text-sm font-medium">Nothing stuck 🎉</p>
            <p className="mt-1 text-xs text-muted-foreground">
              All paid bookings have a lab order. This refreshes every 45s.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Test</TableHead>
                  <TableHead>Slot</TableHead>
                  <TableHead>Why stuck</TableHead>
                  <TableHead className="text-center">Tries</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <GroupRows
                    key={g.key}
                    group={g}
                    busyId={busyId}
                    onRetry={(b) => setConfirm({ type: "retry", booking: b })}
                    onReschedule={(b) => setReschedule(b)}
                    onCancel={(b) => setConfirm({ type: "cancel", booking: b })}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Manual order-by-ID — the escape hatch, gated behind a caution panel */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5">
          <button
            type="button"
            onClick={() => setManualOpen((o) => !o)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left"
          >
            <AlertTriangle size={15} className="shrink-0 text-amber-500" />
            <span className="text-sm font-medium">Manual order by booking ID</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              — advanced escape hatch, use only when a booking isn&apos;t listed above
            </span>
            <ChevronDown size={15} className={cn("ml-auto shrink-0 text-muted-foreground transition-transform", manualOpen && "rotate-180")} />
          </button>

          {manualOpen && (
            <div className="flex flex-col gap-3 border-t border-amber-500/20 px-4 py-4">
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">What it does:</span> places a{" "}
                  <span className="font-medium text-foreground">real</span> Thyrocare order for a booking by
                  its ID, bypassing the Razorpay payment step. Same action as{" "}
                  <span className="font-medium text-foreground">Retry</span> above, but without the safety of
                  seeing the booking, its history, or why it&apos;s stuck first.
                </p>
                <p className="font-medium text-foreground">When to use it:</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  <li>A booking needs an order but does <span className="font-medium text-foreground">not</span> appear in the list above (the reconciliation cron hasn&apos;t flagged it, or its state is unusual) and you have the exact booking ID from support or logs.</li>
                  <li>Backend or support explicitly asked you to force-place a specific order.</li>
                </ul>
                <p>
                  <span className="font-medium text-foreground">When NOT to:</span> if the booking is already
                  in the list above, use its Retry button — it&apos;s safer. Never paste an ID you&apos;re
                  unsure of: a wrong ID places a real, unpaid order and dispatches a phlebotomist.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="manualBookingId" className="text-xs">Booking ID (UUID)</Label>
                <Input
                  id="manualBookingId"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={manualBookingId}
                  onChange={(e) => setManualBookingId(e.target.value)}
                  className="max-w-md font-mono text-sm"
                />
              </div>

              <Button
                variant="outline"
                size="sm"
                className="self-start border-amber-500/40 hover:bg-amber-500/10"
                disabled={!UUID_RE.test(manualBookingId.trim()) || manualLoading}
                onClick={() => setConfirm({ type: "manual", bookingId: manualBookingId.trim() })}
              >
                {manualLoading ? <Loader2 size={13} className="animate-spin" /> : <AlertTriangle size={13} />}
                {manualLoading ? "Placing…" : "Place order"}
              </Button>

              {manualResult && (
                <div className={cn("rounded-lg border p-3 text-sm", manualResult.success ? "border-green-500/20 bg-green-500/10" : "border-red-500/20 bg-red-500/10")}>
                  {manualResult.success ? (
                    <div className="flex flex-col gap-0.5">
                      <p className="font-semibold text-green-400">Order placed</p>
                      <p className="text-xs text-muted-foreground">Order ID: <span className="font-mono">{manualResult.thyrocareOrderId}</span></p>
                      <p className="text-xs text-muted-foreground">Lead ID: <span className="font-mono">{manualResult.thyrocareLeadId}</span></p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <p className="font-semibold text-red-400">Order failed</p>
                      <p className="text-xs text-muted-foreground">{manualResult.error}</p>
                      {manualResult.details != null && (
                        <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
                          {JSON.stringify(manualResult.details, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Reschedule slot picker */}
      <RescheduleDialog
        booking={reschedule}
        onClose={() => setReschedule(null)}
        onPlaced={() => load({ silent: true })}
      />

      {/* Retry / Cancel confirmation */}
      <Dialog open={confirm !== null} onOpenChange={(v) => { if (!v) setConfirm(null); }}>
        <DialogContent className="sm:max-w-md">
          {confirm && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {confirm.type === "retry" ? "Retry placement?"
                    : confirm.type === "cancel" ? "Cancel booking?"
                    : "Place a manual order?"}
                </DialogTitle>
                <DialogDescription>
                  {confirm.type === "retry" ? (
                    <>Places a real Thyrocare order for{" "}
                      <span className="font-medium text-foreground">{confirm.booking.patientName}</span>{" "}
                      and debits the prepaid wallet. Only do this after the wallet has balance.</>
                  ) : confirm.type === "cancel" ? (
                    <>Cancels{" "}
                      <span className="font-medium text-foreground">{confirm.booking.patientName}</span>’s{" "}
                      booking and stops the reconciliation cron from retrying it. This cannot be undone here.</>
                  ) : (
                    <>Places a <span className="font-medium text-foreground">real</span> Thyrocare order for
                      booking{" "}
                      <span className="font-mono text-foreground">{confirm.bookingId.slice(0, 8)}…</span>,
                      bypassing payment. Double-check this is the right booking — a wrong ID dispatches a
                      phlebotomist for an unpaid order.</>
                  )}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)}>Keep</Button>
                <Button
                  variant={confirm.type === "cancel" ? "destructive" : "default"}
                  onClick={runConfirm}
                >
                  {confirm.type === "retry" ? "Place order"
                    : confirm.type === "cancel" ? "Cancel booking"
                    : "Place order"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

function GroupRows({
  group, busyId, onRetry, onReschedule, onCancel,
}: {
  group: Group;
  busyId: string | null;
  onRetry: (b: StuckBooking) => void;
  onReschedule: (b: StuckBooking) => void;
  onCancel: (b: StuckBooking) => void;
}) {
  const isCart = group.bookings.length > 1;
  return (
    <>
      {isCart && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={7} className="bg-muted/40 py-1.5 text-xs text-muted-foreground">
            Cart · {group.bookings.length} stuck tests · batch{" "}
            <span className="font-mono">{group.batchId?.slice(0, 8)}</span>
          </TableCell>
        </TableRow>
      )}
      {group.bookings.map((b) => {
        const why = whyStuck(b.lastOrderError);
        const busy = busyId === b.id;
        const exhausted = b.thyrocareCreateAttempts >= RETRY_CAP;
        return (
          <TableRow key={b.id} className={cn(isCart && "bg-muted/10")}>
            <TableCell>
              <div className="font-medium">{b.patientName}</div>
              <div className="font-mono text-xs text-muted-foreground">{b.user.whatsappPhone}</div>
            </TableCell>
            <TableCell className="capitalize">{b.testType.replace(/_/g, " ")}</TableCell>
            <TableCell className="text-xs">
              {toYmd(b.appointmentDate)} · {b.appointmentTime}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", why.dotClass)} />
                <span className="text-xs">{why.label}</span>
              </div>
            </TableCell>
            <TableCell className="text-center">
              <span className={cn("text-xs tabular-nums", exhausted ? "text-destructive" : "text-muted-foreground")}>
                {b.thyrocareCreateAttempts}/{RETRY_CAP}
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums">{rupees(b.amount)}</TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-1">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onRetry(b)}>
                  {busy ? <Loader2 className="animate-spin" size={13} /> : <RefreshCw size={13} />}
                  Retry
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onReschedule(b)}>
                  <CalendarClock size={13} />
                  Reschedule
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onCancel(b)}>
                  <XCircle size={13} />
                  Cancel
                </Button>
              </div>
            </TableCell>
          </TableRow>
        );
      })}
    </>
  );
}
