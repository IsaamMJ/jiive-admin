"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, CalendarClock, XCircle } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { RescheduleDialog } from "./RescheduleDialog";
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
  | null;

export default function StuckBookingsPage() {
  const [bookings, setBookings] = useState<StuckBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [reschedule, setReschedule] = useState<StuckBooking | null>(null);
  const confirmRef = useRef<Confirm>(null);
  confirmRef.current = confirm;

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

  const runConfirm = async () => {
    const c = confirm;
    if (!c) return;
    setConfirm(null);
    if (c.type === "retry") await doRetry(c.booking);
    else await doCancel(c.booking);
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
                  {confirm.type === "retry" ? "Retry placement?" : "Cancel booking?"}
                </DialogTitle>
                <DialogDescription>
                  {confirm.type === "retry" ? (
                    <>Places a real Thyrocare order for{" "}
                      <span className="font-medium text-foreground">{confirm.booking.patientName}</span>{" "}
                      and debits the prepaid wallet. Only do this after the wallet has balance.</>
                  ) : (
                    <>Cancels{" "}
                      <span className="font-medium text-foreground">{confirm.booking.patientName}</span>’s{" "}
                      booking and stops the reconciliation cron from retrying it. This cannot be undone here.</>
                  )}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)}>Keep</Button>
                <Button
                  variant={confirm.type === "cancel" ? "destructive" : "default"}
                  onClick={runConfirm}
                >
                  {confirm.type === "retry" ? "Place order" : "Cancel booking"}
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
