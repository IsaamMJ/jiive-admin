"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import api from "@/lib/api";
import type { Booking } from "../lib/types";
import { CancellationBadge } from "./CancellationBadge";

const PAGE_SIZE = 50;
const STATUS_OPTIONS = ["all", "pending_payment", "confirmed", "cancelled", "completed"];
const CANCEL_SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All sources" },
  { value: "user", label: "User-cancelled" },
  { value: "thyrocare", label: "Lab-cancelled" },
  { value: "unknown", label: "Unknown source" },
];

export function AllBookingsView() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("all");
  const [cancelSource, setCancelSource] = useState("all");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetch = (s: string, src: string, o: number) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(o) });
    if (s !== "all") params.set("status", s);
    if (s === "cancelled" && src !== "all") {
      // Backend expects cancelledBy=null for unknown; spec says this is queryable.
      params.set("cancelledBy", src === "unknown" ? "null" : src);
    }
    api.get(`/bookings?${params}`).then((r) => {
      setBookings(r.data.bookings);
      setTotal(r.data.total);
      setLoading(false);
    });
  };

  useEffect(() => { fetch(status, cancelSource, offset); }, [status, cancelSource, offset]);

  const handleStatus = (v: string | null) => {
    setStatus(v ?? "all");
    setCancelSource("all");
    setOffset(0);
  };
  const handleCancelSource = (v: string | null) => {
    setCancelSource(v ?? "all");
    setOffset(0);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={status} onValueChange={handleStatus}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {status === "cancelled" && (
          <Select value={cancelSource} onValueChange={handleCancelSource}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Cancellation source" />
            </SelectTrigger>
            <SelectContent>
              {CANCEL_SOURCE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <span className="text-sm text-muted-foreground">{total} total</span>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Test</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Thyrocare ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.patientName}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">{b.user.whatsappPhone}</TableCell>
                  <TableCell className="capitalize">{b.testType.replace(/_/g, " ")}</TableCell>
                  <TableCell className="text-xs">{new Date(b.appointmentDate).toLocaleDateString()}</TableCell>
                  <TableCell className="text-xs">{b.appointmentTime}</TableCell>
                  <TableCell>
                    {b.status === "cancelled"
                      ? <CancellationBadge cancelledBy={b.cancelledBy} />
                      : <StatusBadge status={b.status} />}
                  </TableCell>
                  <TableCell className="text-right">₹{(b.amount / 100).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{b.address?.city ?? "—"}</TableCell>
                  <TableCell className="text-xs font-mono">{b.thyrocareOrderId ?? "—"}</TableCell>
                </TableRow>
              ))}
              {bookings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">No bookings found</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
        </span>
        <Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
          Next
        </Button>
      </div>
    </div>
  );
}
