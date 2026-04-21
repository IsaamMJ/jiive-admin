"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/AdminLayout";
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

interface Booking {
  id: string;
  patientName: string;
  testType: string;
  appointmentDate: string;
  appointmentTime: string;
  status: string;
  amount: number;
  source: string;
  createdAt: string;
  user: { id: string; whatsappPhone: string; name: string };
  address: { city: string; pincode: number };
}

const PAGE_SIZE = 50;
const STATUS_OPTIONS = ["all", "pending_payment", "confirmed", "cancelled", "completed"];

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("all");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetch = (s: string, o: number) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(o) });
    if (s !== "all") params.set("status", s);
    api.get(`/bookings?${params}`).then((r) => {
      setBookings(r.data.bookings);
      setTotal(r.data.total);
      setLoading(false);
    });
  };

  useEffect(() => { fetch(status, offset); }, [status, offset]);

  const handleStatus = (v: string | null) => { setStatus(v ?? "all"); setOffset(0); };

  return (
    <AdminLayout title="Bookings">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
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
                    <TableCell><StatusBadge status={b.status} /></TableCell>
                    <TableCell className="text-right">₹{(b.amount / 100).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{b.address?.city ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {bookings.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">No bookings found</TableCell>
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
    </AdminLayout>
  );
}
