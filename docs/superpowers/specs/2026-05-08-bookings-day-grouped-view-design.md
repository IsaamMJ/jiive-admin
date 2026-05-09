# Bookings — Day-Grouped View (Admin)

**Date:** 2026-05-08
**Page:** `/bookings` (enhancement of existing page)
**Status:** Design approved, ready for implementation planning

## Goal

Let an admin scan upcoming bookings day-by-day at a glance: Today first, Tomorrow next, Day-after, and so on. Each day section lists its bookings sorted by appointment time. Clicking a booking expands it inline to show full details.

## Scope

- Enhance the existing `/bookings` page (do not create a new route).
- Add a view toggle: **By day** (default, new) and **All** (existing flat paginated table).
- The flat-table view is preserved unchanged for ops/search use cases.

## Default view: "By day"

### Layout

A vertical stack of day sections in chronological order, starting today:

```
┌─ Today · Fri, 8 May 2026 · 4 bookings ──────────────────┐
│  [collapsed row]                                         │
│  [collapsed row]                                         │
│  ...                                                     │
└──────────────────────────────────────────────────────────┘

┌─ Tomorrow · Sat, 9 May 2026 · 2 bookings ───────────────┐
│  ...                                                     │
└──────────────────────────────────────────────────────────┘

┌─ Sun, 10 May 2026 · 6 bookings ─────────────────────────┐
│  ...                                                     │
└──────────────────────────────────────────────────────────┘

           [ Load next 7 days ]
```

- Initial load: today + next 6 days (7 days total).
- "Load more" button appends the next 7 days; repeats indefinitely.
- Empty days (no bookings) are still shown with a muted "No bookings" line — gives confidence the day was checked, not skipped.
- Day header label: "Today" / "Tomorrow" for the first two; otherwise weekday + date.

### Grouping & sort

- **Group by:** `appointmentDate` (the slot date), not `createdAt`.
- **Sort within day:** `appointmentTime` ascending (earliest slot first).
- Backend already returns rows in this order when `appointmentFrom` is provided, so the client only has to bucket by date.

### Collapsed row (one-liner)

Left → right:

```
09:30 AM   Rahul Sharma   +91 98xxxxxx12   TC-A1B2C3   ● Confirmed   Bangalore   Booked 2d ago
```

| Slot | Source field | Notes |
|------|--------------|-------|
| Time | `appointmentTime` | 12-hour with AM/PM |
| Patient name | `patientName` | bold |
| Phone | `user.whatsappPhone` | mono, muted |
| Thyrocare order ID | `thyrocareOrderId` | mono; `—` if `null` |
| Status | `status` | existing `<StatusBadge>` |
| City | `address.city` | small, muted |
| Booked relative | `createdAt` | "Booked 2d ago" / "Booked 3h ago" |

Responsive: on narrow widths, drop city first, then "Booked X ago".

### Expanded panel (read-only)

Clicking a row expands an in-place panel below it. Click again to collapse. Only one row expanded at a time per day section (closing other expansions in the same day on open keeps the page compact). Sections:

- **Customer** — `user.name`, `user.whatsappPhone`, `user.email` (if present), link to `/users/[user.id]`.
- **Patient** — `patientName` (and any patient-specific fields the booking carries; if same as customer, show "(same as customer)").
- **Appointment** — full date + time, full address: `addressLine1`, `addressLine2`, `landmark`, `city`, `state`, `pincode`.
- **Test** — `testType`, `amount` (formatted as ₹).
- **Order tracking** — Thyrocare Order ID, Thyrocare Lead ID, internal Booking ID (UUID, copyable), `source`. If `refundStatus !== 'none'`, show a small refund chip.
- **Timeline** — `createdAt` (full timestamp), `updatedAt`.

No actions in this panel. (Re-trigger Thyrocare order remains on the `/thyrocare` page only.)

## "All" view (existing)

The current flat paginated table at `/bookings` becomes the secondary view, accessed via the toggle. Behavior unchanged: status filter, pagination, columns. Optionally surface the new `thyrocareOrderId` column here too — small win, same data.

## View toggle

Top of the page, near the existing status filter:

```
[ By day  |  All ]   ── (current "Filter by status" select stays for All view)
```

- Toggle state can live in the URL (`?view=day` / `?view=all`) so the choice survives reload and is shareable.
- Default: `view=day`.

## Data fetching

### Endpoint

`GET /admin/bookings` — already enhanced by backend (admin.controller.ts:983-1071).

### "By day" view request

```
GET /admin/bookings?appointmentFrom=2026-05-08&appointmentTo=2026-05-14&limit=500
```

- `appointmentFrom` = today (local date, YYYY-MM-DD)
- `appointmentTo` = today + 6 days
- `limit=500` — generous; a week of bookings is well under this. If `total > limit` we'll add proper paging within a window, but defer until needed.
- No `status` filter by default in day view (we want to see everything that's scheduled).
- "Load more" issues a follow-up request for the next 7-day window and appends.

### "All" view request

Unchanged from current implementation: `?limit=50&offset=…&status=…`.

### Client grouping

After fetch, bucket the returned `bookings[]` by `appointmentDate` into a `Map<string, Booking[]>`. Render keys in date order; insert empty buckets for any missing day in the requested window so empty days still appear.

## Type updates (frontend)

Extend the existing `Booking` interface in `app/bookings/page.tsx` (or move to a shared `lib/types.ts` if convenient):

```ts
interface Booking {
  id: string;
  patientName: string;
  testType: string;
  appointmentDate: string;   // ISO date
  appointmentTime: string;
  status: string;
  amount: number;
  source: string;
  createdAt: string;
  updatedAt: string;          // new
  refundStatus: string;       // new (use only when !== 'none')
  thyrocareOrderId: string | null;  // new
  thyrocareLeadId: string | null;   // new
  user: {
    id: string;
    name: string;
    whatsappPhone: string;
    email?: string;           // new (optional)
  };
  address: {
    addressLine1: string;
    addressLine2?: string;
    landmark?: string;
    city: string;
    state: string;
    pincode: number;
  };
}
```

## File structure

To keep the page focused, split the new view into small, well-bounded units:

```
app/bookings/
  page.tsx                          # view toggle + routing between Day and All
  components/
    DayGroupedView.tsx              # owns 7-day window state + load-more
    DaySection.tsx                  # header + list of rows for one date
    BookingRow.tsx                  # collapsed row + expansion state
    BookingExpandedPanel.tsx        # read-only detail panel
    AllBookingsView.tsx             # (extracted from current page.tsx, unchanged)
  lib/
    groupByDay.ts                   # pure: (Booking[], from, to) => DayBucket[]
    formatRelativeTime.ts           # pure: (ISO) => "2d ago"
```

Each component has one job. `groupByDay` and `formatRelativeTime` are pure and trivially unit-testable.

## Edge cases

- **Empty day:** show "No bookings" muted line under the day header.
- **Booking with no Thyrocare order yet:** render `—` in the order ID slot.
- **Address missing fields:** skip blanks in the expanded panel; never render "undefined".
- **Backend returns more than `limit`:** show a small warning at the bottom of the window ("Showing first 500 of N — narrow the date range to see all"). Unlikely in practice; safety net only.
- **Timezone:** "Today" is computed in the browser's local timezone. `appointmentDate` from backend is treated as a calendar date (no TZ conversion).
- **Slow network:** initial skeleton matches the existing loading pattern (rows of `<Skeleton>` per anticipated day).

## Out of scope

- No bulk actions, no inline status edits, no re-trigger button.
- No filter UI in the day view (status, search). If needed later, add a top-bar filter that applies across all visible days.
- No print/export view.
- No real-time updates; refresh requires reload.

## Testing notes

- `groupByDay` — unit tests covering: empty input, single day, gaps (empty days inserted), out-of-window items dropped.
- `formatRelativeTime` — unit tests for "just now", minutes, hours, days, weeks.
- Manual: load page → confirm Today is first, ordering correct within day, Load more appends correctly, expand/collapse works, empty days render placeholder, narrow viewport drops city then booked-relative.
