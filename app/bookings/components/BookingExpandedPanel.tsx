"use client";

import Link from "next/link";
import { User2, MapPin, Beaker, ExternalLink, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CopyableId } from "./CopyableId";
import type { Booking } from "../lib/types";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/80 font-medium">{label}</span>
      <span className="text-sm text-foreground/90">{value}</span>
    </div>
  );
}

function SectionCard({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/40 p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 pb-1 border-b border-border/40">
        <Icon size={13} className="text-muted-foreground" />
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
      </div>
      {children}
    </div>
  );
}

function fmtDateTime(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function BookingExpandedPanel({ booking }: { booking: Booking }) {
  const a = booking.address;
  const addressLines = [a.addressLine1, a.addressLine2, a.landmark].filter(Boolean).join(", ");
  const cityLine = [a.city, a.state, a.pincode].filter(Boolean).join(" · ");

  return (
    <div className="border-t border-border/60 px-4 sm:px-6 py-5 bg-gradient-to-b from-muted/20 to-transparent">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SectionCard icon={User2} title="Customer">
          <Field label="Name" value={booking.user.name} />
          <Field label="Phone" value={<span className="font-mono text-xs">{booking.user.whatsappPhone}</span>} />
          {booking.user.email && <Field label="Email" value={<span className="text-xs">{booking.user.email}</span>} />}
          <Link
            href={`/users/${booking.user.id}`}
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline w-fit"
          >
            Open user profile
            <ExternalLink size={11} />
          </Link>
        </SectionCard>

        <SectionCard icon={MapPin} title="Patient & Appointment">
          <Field label="Patient" value={booking.patientName} />
          <Field
            label="When"
            value={
              <span>
                {new Date(booking.appointmentDate).toLocaleDateString(undefined, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}{" "}
                · <span className="font-medium">{booking.appointmentTime}</span>
              </span>
            }
          />
          <Field label="Address" value={addressLines || <span className="text-muted-foreground">—</span>} />
          <Field label="Locality" value={cityLine || <span className="text-muted-foreground">—</span>} />
        </SectionCard>

        <SectionCard icon={Beaker} title="Order Tracking">
          <div className="flex items-baseline justify-between gap-3">
            <Field label="Test" value={<span className="capitalize">{booking.testType.replace(/_/g, " ")}</span>} />
            <span className="text-base font-semibold tabular-nums whitespace-nowrap">
              ₹{(booking.amount / 100).toLocaleString()}
            </span>
          </div>
          <Field
            label="Thyrocare Order ID"
            value={
              booking.thyrocareOrderId ? (
                <CopyableId value={booking.thyrocareOrderId} />
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
          />
          <Field
            label="Thyrocare Lead ID"
            value={
              booking.thyrocareLeadId ? (
                <CopyableId value={booking.thyrocareLeadId} />
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
          />
          <Field
            label="Booking ID"
            value={<CopyableId value={booking.id} className="text-[10px]" />}
          />
          <Field label="Source" value={<span className="capitalize">{booking.source}</span>} />
          {booking.refundStatus && booking.refundStatus !== "none" && (
            <Badge
              variant="outline"
              className="w-fit gap-1 bg-orange-500/10 text-orange-400 border-orange-500/30"
            >
              <RotateCcw size={10} />
              Refund: {booking.refundStatus}
            </Badge>
          )}
          <div className="grid grid-cols-2 gap-3 pt-1 mt-1 border-t border-border/40">
            <Field label="Created" value={<span className="text-xs">{fmtDateTime(booking.createdAt)}</span>} />
            <Field label="Updated" value={<span className="text-xs">{fmtDateTime(booking.updatedAt)}</span>} />
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
