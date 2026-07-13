// ─────────────────────────────────────────────────────────────────────────────
// Suspected incidents — derived on the CLIENT from the existing /bookings API.
//
// This is a DERIVED VIEW, not a record. Nothing here is stored, and nothing here
// is an incident until a human files one. It exists because it works today with
// zero new backend, and because the June 21 no-show would have shown up in it.
// ─────────────────────────────────────────────────────────────────────────────

import type { Booking } from "@/app/bookings/lib/types";
import { normalizeDate } from "@/app/bookings/lib/groupByDay";
import type { SuspectedIncident, SuspicionKind } from "../types";

/** The booked collection window is 60 minutes (the SLA the June 21 incident breached). */
const SLOT_MINUTES = 60;

/**
 * Statuses that mean "this collection was supposed to happen and was never marked
 * done" — i.e. the booking is paid and pre-collection, and the slot has elapsed.
 *
 * Taken verbatim from the backend's canonical `BookingStatus` enum
 * (jiive-backend src/modules/booking/booking-status.enum.ts), which is the single
 * source of truth. Do NOT guess these strings: raw status strings "were the root
 * cause of the 9 booking bugs shipped 2026-04-29" (that file's own words), and a
 * status missing from this set is a no-show we silently fail to detect.
 *
 * Excluded on purpose:
 *  - `pending_payment` — an unpaid booking that lapsed is not a phlebo no-show.
 *  - `sample_collected` / `sample_imported` / `completed` — the draw happened.
 *  - `cancelled` — has its own signal below (cancelledBy === 'thyrocare').
 *
 * Included, non-obviously:
 *  - `phlebo_arrived` — the phlebo arrived and no sample was ever recorded. That's
 *    a failed collection, not a success.
 *  - `rescheduled` — the booking carries its NEW slot; if that one has also
 *    elapsed with nothing collected, it's a no-show on the second attempt.
 */
const LIVE_STATUSES = new Set([
  "payment_completed",
  "awaiting_reschedule_choice", // paid, but the Thyrocare order never got placed
  "booking_confirmed",
  "rescheduled",
  "phlebo_assigned",
  "phlebo_started",
  "phlebo_arrived",
]);

/**
 * Parses a booking's slot into a local Date.
 *
 * Timezone: `appointmentDate` may arrive as "YYYY-MM-DD" or as a full ISO string,
 * so we run it through the same `normalizeDate` the bookings day-grouping uses —
 * which takes the leading 10 chars. `appointmentTime` is a bare wall-clock "HH:MM".
 * Combining them as a LOCAL datetime is exactly the assumption the rest of the
 * bookings UI already makes (DaySection buckets by the sliced date and prints the
 * raw time string). Doing anything cleverer here — e.g. re-interpreting the ISO
 * date in UTC — would put this panel a day out of step with the Bookings screen.
 *
 * Returns null when either field is missing or unparseable, so a malformed row is
 * skipped rather than silently treated as "in the past".
 */
export function parseSlotStart(booking: Booking): Date | null {
  if (!booking.appointmentDate || !booking.appointmentTime) return null;

  const date = normalizeDate(booking.appointmentDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const m = /^(\d{1,2}):(\d{2})/.exec(booking.appointmentTime.trim());
  if (!m) return null;
  const hh = String(m[1]).padStart(2, "0");
  const mm = m[2];
  if (Number(hh) > 23 || Number(mm) > 59) return null;

  const d = new Date(`${date}T${hh}:${mm}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The slot has fully elapsed — start + the 60-minute collection window is behind us. */
function slotHasPassed(booking: Booking, now: Date): boolean {
  const start = parseSlotStart(booking);
  if (!start) return false;
  return start.getTime() + SLOT_MINUTES * 60_000 < now.getTime();
}

/** refundStatus is a free-ish string; anything that isn't "none"/empty means money moved. */
function hasRefund(booking: Booking): boolean {
  const s = (booking.refundStatus ?? "").trim().toLowerCase();
  return s !== "" && s !== "none" && s !== "null" && s !== "not_applicable";
}

function slotLabel(booking: Booking): string {
  const date = normalizeDate(booking.appointmentDate ?? "");
  return `${date} ${booking.appointmentTime ?? ""}`.trim();
}

/**
 * One row per booking, carrying the highest-priority signal we detected.
 * Priority: no-show > vendor cancellation > refund. A booking that was both
 * cancelled by the vendor and refunded is one thing that went wrong, not two —
 * the secondary signal is mentioned in the text instead of spawning a second row.
 */
export function deriveSuspectedIncidents(bookings: Booking[], now: Date = new Date()): SuspectedIncident[] {
  const out: SuspectedIncident[] = [];

  for (const b of bookings) {
    const refunded = hasRefund(b);
    const cancelledByVendor = b.status === "cancelled" && b.cancelledBy === "thyrocare";
    const noShow = LIVE_STATUSES.has(b.status) && slotHasPassed(b, now);

    let kind: SuspicionKind;
    if (noShow) kind = "possible_no_show";
    else if (cancelledByVendor) kind = "cancelled_by_vendor";
    else if (refunded) kind = "refund_issued";
    else continue;

    const customerName = b.patientName || b.user?.name || "Unknown customer";
    const slot = slotLabel(b);
    const orderId = b.thyrocareOrderId;
    const alsoRefunded = refunded && kind !== "refund_issued" ? " Money was also refunded." : "";

    out.push({
      bookingId: b.id,
      kind,
      detected: {
        possible_no_show: `Slot ${slot} has passed but the booking is still "${b.status}" — never marked completed.`,
        cancelled_by_vendor: `Thyrocare cancelled this booking${b.cancellationReason ? `: "${b.cancellationReason}"` : "."}`,
        refund_issued: `A refund was issued (refundStatus: ${b.refundStatus}).`,
      }[kind] + alsoRefunded,
      customerName,
      orderId,
      appointmentDate: normalizeDate(b.appointmentDate ?? ""),
      appointmentTime: b.appointmentTime ?? "",
      // Prefills, not verdicts. The operator can change any of them in the form.
      // `cancelled_by_vendor` deliberately prefills `other` rather than guessing a
      // cause — a wrong category silently pollutes the counts this whole system exists to produce.
      suggestedCategory: {
        possible_no_show: "phlebo_no_show" as const,
        cancelled_by_vendor: "other" as const,
        refund_issued: "billing_refund" as const,
      }[kind],
      suggestedSeverity: {
        // "Unsure? pick the higher one and move on" — severity is re-assignable later.
        possible_no_show: "S2" as const,
        cancelled_by_vendor: "S3" as const,
        refund_issued: "S3" as const,
      }[kind],
      suggestedWhatHappened: [
        `Detected automatically from the booking record — please replace this with what actually happened.`,
        ``,
        `Customer: ${customerName}`,
        `Slot: ${slot}`,
        orderId ? `Order: ${orderId}` : `Order: (no Thyrocare order ID on this booking)`,
        `Booking status: ${b.status}`,
        b.cancelledBy ? `Cancelled by: ${b.cancelledBy}` : null,
        b.cancellationReason ? `Cancellation reason: ${b.cancellationReason}` : null,
        refunded ? `Refund status: ${b.refundStatus}` : null,
      ]
        .filter((l) => l !== null)
        .join("\n"),
    });
  }

  // Most recent slot first — the fresh ones are the ones still worth acting on.
  return out.sort((a, b) =>
    `${b.appointmentDate} ${b.appointmentTime}`.localeCompare(`${a.appointmentDate} ${a.appointmentTime}`)
  );
}

export const SUSPICION_LABEL: Record<SuspicionKind, string> = {
  possible_no_show: "Possible no-show",
  cancelled_by_vendor: "Cancelled by vendor",
  refund_issued: "Refund issued",
};

export const SUSPICION_CLASS: Record<SuspicionKind, string> = {
  possible_no_show: "bg-red-500/15 text-red-400 border-red-500/30",
  cancelled_by_vendor: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  refund_issued: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};
