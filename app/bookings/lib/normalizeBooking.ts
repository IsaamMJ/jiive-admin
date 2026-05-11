import type { Booking } from "./types";

// Backend may return cancellation fields as either camelCase (cancelledBy)
// or snake_case (cancelled_by). Normalize both into the camelCase shape
// the UI expects. Same defensive treatment for cancellationReason.
//
// Also accepts a few variations: cancelled_by_user_id is sometimes used
// to denote a user-initiated cancel even when the source string is null.
export function normalizeBooking(raw: Record<string, unknown>): Booking {
  const cancelledByRaw =
    (raw.cancelledBy as string | null | undefined) ??
    (raw.cancelled_by as string | null | undefined) ??
    null;

  let cancelledBy: Booking["cancelledBy"] = null;
  if (cancelledByRaw === "user" || cancelledByRaw === "thyrocare") {
    cancelledBy = cancelledByRaw;
  }

  const cancellationReason =
    (raw.cancellationReason as string | null | undefined) ??
    (raw.cancellation_reason as string | null | undefined) ??
    null;

  return {
    ...(raw as unknown as Booking),
    cancelledBy,
    cancellationReason,
  };
}

export function normalizeBookings(rawList: unknown): Booking[] {
  if (!Array.isArray(rawList)) return [];
  return rawList.map((b) => normalizeBooking(b as Record<string, unknown>));
}
