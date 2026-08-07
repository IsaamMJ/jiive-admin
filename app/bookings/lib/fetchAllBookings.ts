// ─────────────────────────────────────────────────────────────────────────────
// The ONE place anything in this app pages through GET /bookings.
//
// WHY THIS FILE EXISTS
// --------------------
// `GET /bookings` CLAMPS `limit` — it does not reject it:
//
//     const take = Math.min(parseInt(limit || '50', 10), 200);   // admin.controller.ts:2032
//     const skip = parseInt(offset || '0', 10);                  // admin.controller.ts:2033
//     ...
//     return { bookings, total, take, skip };                    // admin.controller.ts:2205
//
// So `limit=500` returns 200 rows and HTTP 200. No error, no header, no flag.
// Three separate callers asked for 500 and quietly rendered two-fifths of the
// truth. Measured live on dev, 2026-08-07:
//
//     /bookings?limit=500                                          -> 200 rows, total 494  (294 lost)
//     /bookings?appointmentFrom=2026-02-08&appointmentTo=2026-09-06&limit=500
//                                                                  -> 200 rows, total 493  (293 lost)
//
// The response has always carried a real `total`. Nothing read it.
//
// Offset paging is verified complete on the same data: offset=0/200/400 returned
// 200 + 200 + 94 = 494 unique ids, zero overlap, exactly matching `total`. It is
// safe because the handler applies a total order — every `orderBy` branch ends in
// `{ id: 'asc' }` as a tie-break (admin.controller.ts:2158-2162), so equal sort
// keys cannot shuffle between pages.
//
// GOVERNING RULE: an absent signal is never a positive assurance. This function
// never returns a page count dressed up as a total. `complete` is stated, not
// inferred by the caller from `bookings.length`, and when it is false the caller
// is expected to SAY SO in the UI rather than silently render a short list.
// ─────────────────────────────────────────────────────────────────────────────

import api from "@/lib/api";
import { normalizeBookings } from "./normalizeBooking";
import type { Booking } from "./types";

/**
 * The server's hard ceiling (admin.controller.ts:2032). Never send more than this.
 * Asking for 500 is asking to be lied to — the clamp is silent, so a bigger number
 * buys nothing and costs you the ability to notice you were truncated.
 */
export const BOOKINGS_MAX_PAGE_SIZE = 200;

/**
 * Round-trip ceiling, so a runaway `total` (or a server that keeps handing back
 * full pages) can never spin forever in a browser tab. 15 × 200 = 3,000 rows,
 * comfortably above any window this app asks for — dev's ENTIRE booking table is
 * 494 rows. Hitting this cap is a real signal, and it is reported, not hidden.
 */
const DEFAULT_MAX_PAGES = 15;

/**
 * Why we stopped paging.
 * - `complete`        — we hold every row the filter matches.
 * - `page-cap`        — we hit DEFAULT_MAX_PAGES. Rows are missing.
 * - `total-mismatch`  — the server ran out of rows before reaching its own
 *                       `total` (rows deleted mid-page, or `total` counts
 *                       something the page query doesn't). Treated as INCOMPLETE
 *                       because we cannot prove otherwise.
 */
export type BookingsFetchStop = "complete" | "page-cap" | "total-mismatch";

/**
 * Query params for GET /bookings. Deliberately does NOT include `limit` or
 * `offset` — those belong to the pager, not the caller. The backend 400s on an
 * unknown `status` / `cancelledBy` / `sortBy` / `sortDir` value rather than
 * silently ignoring it (admin.controller.ts:2057, :2091, :2142, :2147), so a
 * typo here surfaces as an error the caller can show, not an empty list.
 */
export interface BookingsQuery {
  appointmentFrom?: string; // YYYY-MM-DD
  appointmentTo?: string; // YYYY-MM-DD
  status?: string;
  cancelledBy?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export interface AllBookings {
  bookings: Booking[];
  /**
   * The server's own count for this filter, or null if it didn't send a usable
   * one. NOT `bookings.length` — those are only the same thing when `complete`.
   */
  total: number | null;
  /** True only when we can prove we hold every matching row. */
  complete: boolean;
  stop: BookingsFetchStop;
  /** Round trips made. Useful when a window is unexpectedly slow. */
  pages: number;
}

/**
 * Fetch EVERY booking matching `query`, paging by offset at the server's real
 * page size.
 *
 * Terminates on any of: the server's `total` reached, a short page (fewer rows
 * than we asked for means the result set is exhausted), or the page cap. `offset`
 * always advances by at least one row before the next request, so there is no
 * path that loops without progress.
 */
export async function fetchAllBookings(
  query: BookingsQuery = {},
  opts: { maxPages?: number } = {}
): Promise<AllBookings> {
  const maxPages = Math.max(1, opts.maxPages ?? DEFAULT_MAX_PAGES);

  const bookings: Booking[] = [];
  // Dedupe by id. Rows are ordered by appointment date/time, so a booking created
  // WHILE we are paging can shift later rows down by one and make us fetch the
  // same row twice. Duplicated bookings would double-count in the stat tiles and
  // show the same order twice in the picker.
  const seen = new Set<string>();

  let total: number | null = null;
  let offset = 0;
  let pages = 0;

  for (;;) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      params.set(k, String(v));
    }
    params.set("limit", String(BOOKINGS_MAX_PAGE_SIZE));
    params.set("offset", String(offset));

    const r = await api.get<{ bookings?: unknown; total?: unknown }>(`/bookings?${params}`);
    pages += 1;

    const page = normalizeBookings(r.data?.bookings);

    // A `total` we don't recognise is treated as ABSENT, never as zero and never
    // as "we're done" — a bad count must not be able to end paging early.
    const rawTotal = r.data?.total;
    total =
      typeof rawTotal === "number" && Number.isFinite(rawTotal) && rawTotal >= 0
        ? rawTotal
        : null;

    for (const b of page) {
      if (typeof b.id === "string" && b.id !== "") {
        if (seen.has(b.id)) continue;
        seen.add(b.id);
      }
      bookings.push(b);
    }

    // Advance by rows RETURNED, not rows kept — `offset` is the server's cursor
    // into its own result set, and dropping a duplicate here would make us skip a
    // real row on the next page.
    offset += page.length;

    if (total !== null && bookings.length >= total) {
      return { bookings, total, complete: true, stop: "complete", pages };
    }

    // Short page = the server has nothing left at this offset. That IS a positive
    // signal (Prisma take/skip returns fewer rows only at the end of the set), so
    // an exhausted set with no usable `total` still counts as complete — but if
    // the server DID state a total and we're short of it, we cannot prove we have
    // everything, so we say so.
    if (page.length < BOOKINGS_MAX_PAGE_SIZE) {
      return total === null
        ? { bookings, total: null, complete: true, stop: "complete", pages }
        : { bookings, total, complete: false, stop: "total-mismatch", pages };
    }

    if (pages >= maxPages) {
      return { bookings, total, complete: false, stop: "page-cap", pages };
    }
  }
}

/**
 * One sentence an operator can act on when a fetch came back short, or null when
 * it didn't. Shared so that all three call sites word the same failure the same
 * way — three hand-written warnings is how they drift into disagreeing.
 */
export function bookingsCoverageNote(r: AllBookings): string | null {
  if (r.complete) return null;
  const of = r.total !== null ? ` of ${r.total}` : "";
  switch (r.stop) {
    case "page-cap":
      return `Only the first ${r.bookings.length}${of} bookings in this range could be loaded — narrow the dates to see the rest.`;
    case "total-mismatch":
      return `Loaded ${r.bookings.length}${of} bookings — the server stopped sending rows before reaching its own count. Reload to retry.`;
    default:
      return `Loaded ${r.bookings.length}${of} bookings — this may not be all of them.`;
  }
}
