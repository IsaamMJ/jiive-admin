"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { Booking } from "../lib/types";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function fmtDateTime(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString();
}

export function BookingExpandedPanel({ booking }: { booking: Booking }) {
  const a = booking.address;
  const addressLines = [a.addressLine1, a.addressLine2, a.landmark].filter(Boolean).join(", ");
  const cityLine = [a.city, a.state, a.pincode].filter(Boolean).join(", ");

  return (
    <div className="bg-muted/30 border-t border-border px-6 py-4 grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Customer */}
      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer</h4>
        <Field label="Name" value={booking.user.name} />
        <Field label="Phone" value={<span className="font-mono">{booking.user.whatsappPhone}</span>} />
        {booking.user.email && <Field label="Email" value={booking.user.email} />}
        <Link
          href={`/users/${booking.user.id}`}
          className="text-xs text-primary hover:underline w-fit"
        >
          Open user profile →
        </Link>
      </div>

      {/* Patient + Appointment */}
      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Patient & Appointment</h4>
        <Field label="Patient" value={booking.patientName} />
        <Field
          label="When"
          value={`${new Date(booking.appointmentDate).toLocaleDateString()} · ${booking.appointmentTime}`}
        />
        <Field label="Address" value={addressLines || "—"} />
        <Field label="City / State / PIN" value={cityLine || "—"} />
      </div>

      {/* Order tracking */}
      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Order Tracking</h4>
        <Field label="Test" value={<span className="capitalize">{booking.testType.replace(/_/g, " ")}</span>} />
        <Field label="Amount" value={`₹${(booking.amount / 100).toLocaleString()}`} />
        <Field
          label="Thyrocare Order ID"
          value={booking.thyrocareOrderId ? <span className="font-mono">{booking.thyrocareOrderId}</span> : "—"}
        />
        <Field
          label="Thyrocare Lead ID"
          value={booking.thyrocareLeadId ? <span className="font-mono">{booking.thyrocareLeadId}</span> : "—"}
        />
        <Field label="Booking ID" value={<span className="font-mono text-xs">{booking.id}</span>} />
        <Field label="Source" value={booking.source} />
        {booking.refundStatus && booking.refundStatus !== "none" && (
          <Badge variant="outline" className="w-fit">Refund: {booking.refundStatus}</Badge>
        )}
        <Field label="Created" value={fmtDateTime(booking.createdAt)} />
        <Field label="Updated" value={fmtDateTime(booking.updatedAt)} />
      </div>
    </div>
  );
}
