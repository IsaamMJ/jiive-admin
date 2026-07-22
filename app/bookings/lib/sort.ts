import type { Booking } from "./types";

/**
 * Column sorting for the All-bookings table.
 *
 * ── Where the sort actually happens ──────────────────────────────────────────
 * The list is paginated (50/page), so sorting only tells the truth if the SERVER
 * does it — a client-side sort reorders the rows you can see and quietly leaves
 * the rest of the list out of order.
 *
 * `SERVER_SORT` is that switch. It is OFF until the backend accepts `sortBy` +
 * `sortDir` on `GET /bookings` — it 400s on unknown query params, so turning this
 * on early takes the whole page down rather than degrading. Spec handed over in
 * `docs/handoff-backend-bookings-sort.md`.
 *
 * While it is OFF the table sorts the loaded page client-side, and the UI says so
 * out loud whenever there is more than one page. Flipping this one constant to
 * `true` is the entire upgrade.
 */
export const SERVER_SORT = false;

export type SortKey =
  | "patient" | "phone" | "test" | "date" | "time"
  | "status" | "amount" | "city" | "thyrocareId";

export type SortDir = "asc" | "desc";

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

/**
 * Frontend column → the field name the backend sorts on. Kept in one place so a
 * rename on their side is a one-line change here, not a hunt through the table.
 */
export const SORT_FIELD: Record<SortKey, string> = {
  patient: "patientName",
  phone: "whatsappPhone",
  test: "testType",
  date: "appointmentDate",
  time: "appointmentTime",
  status: "status",
  amount: "amount",
  city: "city",
  thyrocareId: "thyrocareOrderId",
};

/** The value each column sorts on. `null` means "no value" and always sinks to the bottom. */
function sortValue(b: Booking, key: SortKey): string | number | null {
  switch (key) {
    case "patient": return b.patientName?.toLowerCase() ?? null;
    case "phone": return b.user?.whatsappPhone ?? null;
    case "test": return b.testType?.toLowerCase() ?? null;
    case "date": return b.appointmentDate || null;      // YYYY-MM-DD sorts lexically
    case "time": return b.appointmentTime || null;      // HH:MM sorts lexically
    case "status": return b.status?.toLowerCase() ?? null;
    case "amount": return typeof b.amount === "number" ? b.amount : null;
    case "city": return b.address?.city?.toLowerCase() ?? null;
    case "thyrocareId": return b.thyrocareOrderId || null;
  }
}

/**
 * Sort a page of bookings. Rows with no value for the column stay at the bottom in
 * BOTH directions — a booking with no Thyrocare ID isn't "the smallest ID", it has
 * none, and burying the real IDs under a wall of dashes helps nobody.
 */
export function sortBookings(bookings: Booking[], sort: SortState | null): Booking[] {
  if (!sort) return bookings;
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...bookings].sort((x, y) => {
    const a = sortValue(x, sort.key);
    const b = sortValue(y, sort.key);
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    if (typeof a === "number" && typeof b === "number") return (a - b) * factor;
    return String(a).localeCompare(String(b)) * factor;
  });
}

/**
 * Click cycle: unsorted → ascending → descending → unsorted. The third click
 * matters — without it there is no way back to the backend's own order once you
 * have touched a column.
 */
export function nextSort(current: SortState | null, key: SortKey): SortState | null {
  if (current?.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return null;
}
