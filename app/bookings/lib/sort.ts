/**
 * Column sorting for the All-bookings table.
 *
 * The sort happens SERVER-SIDE — `GET /bookings` takes `sortBy` + `sortDir` and
 * orders the whole result before paginating it. That's the only version that tells
 * the truth: the list pages at 50, so sorting in the browser would reorder the rows
 * on screen and quietly leave the rest of the list alone.
 *
 * Backend guarantees we rely on (verified live against 396 bookings):
 *   - sorted before pagination, so limit/offset page through the sorted result
 *   - a stable total order (ties break on id) — paging can't repeat or skip a row
 *   - nulls last in both directions
 *   - both params omitted → the default order, unchanged
 *   - an unsupported sortBy/sortDir 400s listing the supported values, rather than
 *     silently returning an unsorted list that looks sorted
 */

export type SortKey =
  | "patient" | "phone" | "test" | "date" | "time"
  | "status" | "amount" | "city" | "thyrocareId";

export type SortDir = "asc" | "desc";

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

/**
 * Frontend column → the `sortBy` value the API takes. Deliberately FLAT names:
 * phone and city are nested on the response, but the backend maps them itself so
 * the API doesn't expose its relation layout. One place to change if they rename.
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
