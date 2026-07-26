"use client";

import { useEffect, useState, Fragment } from "react";
import { ChevronDown } from "lucide-react";
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
import { BookingExpandedPanel } from "./BookingExpandedPanel";
import { normalizeBookings } from "../lib/normalizeBooking";
import { cn } from "@/lib/utils";
import { SortableHead } from "./SortableHead";
import { SORT_FIELD, nextSort, type SortKey, type SortState } from "../lib/sort";

const PAGE_SIZE = 50;
const STATUS_OPTIONS = ["all", "pending_payment", "confirmed", "cancelled", "completed"];
// The backend's cancelledBy filter values (verified live). `admin` matches any
// admin actor (stored as admin:<uuid>). No "unknown" — every cancellation now
// carries a real source.
const CANCEL_SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All sources" },
  { value: "user", label: "User-cancelled" },
  { value: "thyrocare", label: "Lab-cancelled" },
  { value: "system", label: "System" },
  { value: "admin", label: "Admin" },
];

export function AllBookingsView() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("all");
  const [cancelSource, setCancelSource] = useState("all");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState | null>(null);

  const fetch = (s: string, src: string, o: number, srt: SortState | null) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(o) });
    if (s !== "all") params.set("status", s);
    // Cancellation source now filters server-side (across the whole list, not just
    // the page). Only meaningful within cancelled, so it's scoped to that status.
    if (s === "cancelled" && src !== "all") params.set("cancelledBy", src);
    if (srt) {
      params.set("sortBy", SORT_FIELD[srt.key]);
      params.set("sortDir", srt.dir);
    }
    api.get(`/bookings?${params}`).then((r) => {
      setBookings(normalizeBookings(r.data.bookings));
      setTotal(r.data.total);
      setLoading(false);
    });
  };

  useEffect(() => { fetch(status, cancelSource, offset, sort); }, [status, cancelSource, offset, sort]);

  const handleSort = (key: SortKey) => {
    setSort(nextSort(sort, key));
    setExpandedId(null);
    // Re-sorting reshuffles the whole list, so page 3 of the old order is
    // meaningless in the new one — go back to the start.
    setOffset(0);
  };

  const handleStatus = (v: string | null) => {
    setStatus(v ?? "all");
    setCancelSource("all");
    setOffset(0);
    setExpandedId(null);
  };
  const handleCancelSource = (v: string | null) => {
    setCancelSource(v ?? "all");
    setOffset(0);
    setExpandedId(null);
  };
  const toggleRow = (id: string) => {
    setExpandedId((cur) => (cur === id ? null : id));
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

        {sort !== null && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => { setSort(null); setExpandedId(null); }}
          >
            Clear sort
          </Button>
        )}
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
                <TableHead className="w-8"></TableHead>
                <SortableHead label="Patient" sortKey="patient" sort={sort} onSort={handleSort} />
                <SortableHead label="Phone" sortKey="phone" sort={sort} onSort={handleSort} />
                <SortableHead label="Test" sortKey="test" sort={sort} onSort={handleSort} />
                <SortableHead label="Date" sortKey="date" sort={sort} onSort={handleSort} />
                <SortableHead label="Time" sortKey="time" sort={sort} onSort={handleSort} />
                <SortableHead label="Status" sortKey="status" sort={sort} onSort={handleSort} />
                <SortableHead label="Amount" sortKey="amount" sort={sort} onSort={handleSort} align="right" />
                <SortableHead label="City" sortKey="city" sort={sort} onSort={handleSort} />
                <SortableHead label="Thyrocare ID" sortKey="thyrocareId" sort={sort} onSort={handleSort} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((b) => {
                const expanded = expandedId === b.id;
                return (
                  <Fragment key={b.id}>
                    <TableRow
                      onClick={() => toggleRow(b.id)}
                      className={cn("cursor-pointer", expanded && "bg-accent/40")}
                    >
                      <TableCell>
                        <ChevronDown
                          size={14}
                          className={cn(
                            "text-muted-foreground/60 transition-transform duration-200",
                            !expanded && "-rotate-90"
                          )}
                        />
                      </TableCell>
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
                    {expanded && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={10} className="p-0">
                          <BookingExpandedPanel booking={b} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
              {bookings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-8">No bookings found</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => { setOffset(Math.max(0, offset - PAGE_SIZE)); setExpandedId(null); }}>
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
        </span>
        <Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= total} onClick={() => { setOffset(offset + PAGE_SIZE); setExpandedId(null); }}>
          Next
        </Button>
      </div>
    </div>
  );
}
