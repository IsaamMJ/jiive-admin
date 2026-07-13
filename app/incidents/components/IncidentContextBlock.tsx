"use client";

import Link from "next/link";
import { AlertTriangle, MapPinOff, UserX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InfoTip } from "@/components/InfoTip";
import { StatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";
import type { IncidentAddress, IncidentBooking, IncidentContext } from "../types";

/** Roughly three vials per package — the vendor's own arithmetic on the June 21 order. */
const VIALS_PER_ORDER = 3;

function formatAddress(a: IncidentAddress): string {
  return [a.addressLine1, a.addressLine2, a.landmark, a.city, a.state, a.pincode]
    .filter((p) => p !== null && String(p).trim() !== "")
    .join(", ");
}

/**
 * "Nagarcoil + pincode" is what reached a live order on June 21. An address is
 * suspect when a line, the city, the state or the pincode is missing — or when
 * the street line is too short to be a real one.
 */
function addressGaps(a: IncidentAddress | null): string[] {
  if (!a) return ["No address on the booking at all."];
  const gaps: string[] = [];
  if (!a.addressLine1?.trim()) gaps.push("no street address");
  else if (a.addressLine1.trim().length < 10) gaps.push("street address is suspiciously short");
  if (!a.city?.trim()) gaps.push("no city");
  if (!a.state?.trim()) gaps.push("no state");
  if (!a.pincode) gaps.push("no pincode");
  return gaps;
}

function Warning({
  icon: Icon,
  tone,
  children,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tone: "red" | "amber";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        tone === "red"
          ? "border-red-500/40 bg-red-500/10 text-red-300"
          : "border-amber-500/40 bg-amber-500/10 text-amber-300"
      )}
    >
      <Icon size={15} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function BookingRow({ b, isSibling }: { b: IncidentBooking; isSibling: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-xs">
      <span className="font-mono font-semibold">{b.thyrocareOrderId ?? "no order ID"}</span>
      {isSibling && (
        <Badge variant="outline" className="text-[10px] text-muted-foreground">same payment batch</Badge>
      )}
      <span className="capitalize">{b.testType?.replace(/_/g, " ") ?? "—"}</span>
      <span className="text-muted-foreground">
        {b.appointmentDate ?? "—"} {b.appointmentTime ?? ""}
      </span>
      {b.status && <StatusBadge status={b.status} />}
      {b.amount !== null && <span className="ml-auto tabular-nums">₹{(b.amount / 100).toLocaleString()}</span>}
    </div>
  );
}

export function IncidentContextBlock({ context }: { context: IncidentContext }) {
  const { customer, address, bookings, batchSiblings, unresolvedOrderIds } = context;

  // The batch is the real unit of harm: one person, six orders, eighteen vials.
  const byId = new Map<string, IncidentBooking>();
  for (const b of [...bookings, ...batchSiblings]) byId.set(b.id, b);
  const allBookings = [...byId.values()];
  const linkedIds = new Set(bookings.map((b) => b.id));

  const orderCount = allBookings.length;
  const vials = orderCount * VIALS_PER_ORDER;
  const gaps = addressGaps(address);

  // Phlebo details live on the booking; take the first one that has them.
  const phleboName = allBookings.find((b) => b.phleboName)?.phleboName ?? null;
  const phleboPhone = allBookings.find((b) => b.phleboPhone)?.phleboPhone ?? null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-base">
          Context
          <InfoTip label="Resolved automatically from the order IDs — the customer, the slot, the phlebo, the address, and every other order paid for in the same batch. You never type any of this." />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Warnings the data itself supports — the three failures behind June 21. */}
        {(orderCount >= 2 || gaps.length > 0 || !phleboName) && (
          <div className="flex flex-col gap-2">
            {orderCount >= 2 && (
              <Warning icon={AlertTriangle} tone={orderCount >= 4 ? "red" : "amber"}>
                <strong>{orderCount} orders for one person</strong> — roughly {vials} vials of blood in a single
                visit. Very few customers accept that, and it is a booking-model defect, not a vendor one.
              </Warning>
            )}
            {gaps.length > 0 && (
              <Warning icon={MapPinOff} tone="red">
                <strong>Address looks incomplete</strong> — {gaps.join(", ")}. An incomplete address reaching a
                live order is its own incident.
              </Warning>
            )}
            {!phleboName && (
              <Warning icon={UserX} tone="amber">
                <strong>No phlebo recorded</strong> on any of these orders — so there is no name to hold anyone to.
              </Warning>
            )}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer</span>
            {customer ? (
              <>
                <Link href={`/users/${customer.id}`} className="text-sm font-medium text-primary hover:underline">
                  {customer.name ?? "Unnamed"}
                </Link>
                {customer.whatsappPhone && (
                  <a href={`tel:${customer.whatsappPhone}`} className="font-mono text-xs text-muted-foreground hover:underline">
                    {customer.whatsappPhone}
                  </a>
                )}
              </>
            ) : (
              <span className="text-sm text-muted-foreground">Not resolved from the order IDs.</span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Phlebo</span>
            {phleboName ? (
              <>
                <span className="text-sm font-medium">{phleboName}</span>
                {phleboPhone && (
                  <a href={`tel:${phleboPhone}`} className="font-mono text-xs text-muted-foreground hover:underline">
                    {phleboPhone}
                  </a>
                )}
              </>
            ) : (
              <span className="text-sm text-muted-foreground">Never assigned, or the vendor never told us.</span>
            )}
          </div>

          <div className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Address</span>
            <span className="text-sm">
              {address && formatAddress(address) ? formatAddress(address) : "—"}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Orders ({orderCount})
            <InfoTip label="Everything paid for in the same payment batch, not just the IDs that were typed in. This is how “six orders for one person” shows up as one event instead of six unrelated ones." />
          </span>
          {allBookings.length === 0 ? (
            <span className="text-sm text-muted-foreground">No bookings resolved.</span>
          ) : (
            <div className="flex flex-col gap-1.5">
              {allBookings.map((b) => (
                <BookingRow key={b.id} b={b} isSibling={!linkedIds.has(b.id)} />
              ))}
            </div>
          )}
        </div>

        {unresolvedOrderIds.length > 0 && (
          <Warning icon={AlertTriangle} tone="red">
            <strong>Unresolved order IDs:</strong>{" "}
            <span className="font-mono">{unresolvedOrderIds.join(", ")}</span> — these matched no booking. Check
            for a typo; nothing about them could be looked up.
          </Warning>
        )}
      </CardContent>
    </Card>
  );
}
