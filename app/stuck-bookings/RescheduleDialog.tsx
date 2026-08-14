"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import api from "@/lib/api";
import { type StuckBooking, type Slot, type SlotsResponse, toYmd } from "./types";

interface Props {
  booking: StuckBooking | null;
  onClose: () => void;
  onPlaced: () => void;
}

export function RescheduleDialog({ booking, onClose, onPlaced }: Props) {
  const open = booking !== null;
  const pincode = booking?.address?.pincode ?? null;

  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState("");
  const [selected, setSelected] = useState<Slot | null>(null);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState("");

  // (Re)initialise whenever a new booking opens the dialog.
  useEffect(() => {
    if (!booking) return;
    setDate(toYmd(booking.appointmentDate));
    setSelected(null);
    setPlaceError("");
  }, [booking]);

  // Fetch slots whenever the target date (or booking) changes.
  useEffect(() => {
    if (!booking || !date || pincode == null) return;
    let cancelled = false;
    setLoadingSlots(true);
    setSlotsError("");
    setSelected(null);
    api
      .get<SlotsResponse>(`/thyrocare/slots?pincode=${pincode}&date=${date}`)
      .then((r) => {
        if (cancelled) return;
        setSlots(r.data.slots ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSlots([]);
        setSlotsError(
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
            "Could not load slots",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });
    return () => { cancelled = true; };
  }, [booking, date, pincode]);

  const place = async () => {
    if (!booking || !selected) return;
    setPlacing(true);
    setPlaceError("");
    try {
      const { data } = await api.post(`/bookings/${booking.id}/reschedule-slot`, {
        date,
        time: selected.time,
        slotId: selected.id,
      });
      if (data.success) {
        toast.success(
          `Rescheduled to ${date} ${selected.time} — order ${data.orderId ?? "placed"}`,
        );
        onPlaced();
        onClose();
      } else {
        setPlaceError(data.message ?? data.reason ?? "Reschedule failed");
      }
    } catch (err: unknown) {
      setPlaceError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          "Reschedule failed",
      );
    } finally {
      setPlacing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !placing) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reschedule &amp; place order</DialogTitle>
          <DialogDescription>
            {booking
              ? <>Moves <span className="font-medium text-foreground">{booking.patientName}</span>’s{" "}
                  {booking.testType.replace(/_/g, " ")} test to a new slot and places the
                  Thyrocare order there. This debits the prepaid wallet.</>
              : null}
          </DialogDescription>
        </DialogHeader>

        {pincode == null ? (
          <p className="text-sm text-destructive">
            No address pincode on file for this booking — fix the customer profile before rescheduling.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reschedule-date">Date</Label>
                <Input
                  id="reschedule-date"
                  type="date"
                  className="w-44"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  disabled={placing}
                />
              </div>
              <span className="pb-2 text-xs text-muted-foreground">
                pincode {String(pincode)}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Available slots</Label>
              {loadingSlots ? (
                <div className="grid grid-cols-3 gap-2">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)}
                </div>
              ) : slotsError ? (
                <p className="text-sm text-destructive">{slotsError}</p>
              ) : slots.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open slots for this date — try another.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2 max-h-56 overflow-auto">
                  {slots.map((s) => {
                    const active = selected?.id === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelected(s)}
                        disabled={placing}
                        className={cn(
                          "rounded-lg border px-2 py-1.5 text-xs transition-colors disabled:opacity-50",
                          active
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:bg-accent",
                        )}
                      >
                        <span className="font-medium">{s.time}</span>
                        {s.recommended && (
                          <span className="ml-1 text-[10px] text-green-500">★</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {placeError && <p className="text-sm text-destructive">{placeError}</p>}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={placing} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={placing || !selected || pincode == null}
            onClick={place}
          >
            {placing && <Loader2 className="animate-spin" size={15} />}
            {placing ? "Placing…" : "Reschedule & place"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
