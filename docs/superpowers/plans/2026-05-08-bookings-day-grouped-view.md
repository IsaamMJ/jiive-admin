# Bookings Day-Grouped View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance `/bookings` with a default day-grouped view (Today, Tomorrow, …) that lists bookings sorted by appointment time, with expandable read-only detail panels and a toggle back to the existing flat table.

**Architecture:** Single `/bookings` route, view toggle controlled via `?view=day|all` URL param. Day view fetches a 7-day window from `GET /bookings?appointmentFrom&appointmentTo`, groups client-side, supports "Load next 7 days". Each component has one responsibility; pure helpers (`groupByDay`, `formatRelativeTime`) live under `app/bookings/lib/`.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, axios via `lib/api.ts`, shadcn/ui (Table, Card, Button, Badge, Skeleton, Tabs), Tailwind v4, lucide-react.

**Testing note:** This project has no test framework configured (no jest/vitest in package.json). Plan uses **manual verification steps + isolated pure-function checks via temporary scratch script** instead of formal unit tests. Adding a test framework is out of scope.

**Spec:** `docs/superpowers/specs/2026-05-08-bookings-day-grouped-view-design.md`

---

## File Structure

**Create:**
- `app/bookings/lib/types.ts` — shared `Booking`, `DayBucket` types
- `app/bookings/lib/groupByDay.ts` — pure: bucket bookings into ordered day windows
- `app/bookings/lib/formatRelativeTime.ts` — pure: ISO timestamp → "2d ago"
- `app/bookings/lib/dayLabels.ts` — pure: date → "Today" / "Tomorrow" / "Sun, 10 May 2026"
- `app/bookings/components/AllBookingsView.tsx` — current flat table extracted unchanged
- `app/bookings/components/DayGroupedView.tsx` — owns 7-day window state + load-more
- `app/bookings/components/DaySection.tsx` — header + list of rows for one date
- `app/bookings/components/BookingRow.tsx` — collapsed row + expansion toggle
- `app/bookings/components/BookingExpandedPanel.tsx` — read-only detail panel

**Modify:**
- `app/bookings/page.tsx` — becomes a thin shell: reads `?view=`, renders toggle + chosen view

---

## Task 1: Add shared types

**Files:**
- Create: `app/bookings/lib/types.ts`

- [ ] **Step 1: Create `app/bookings/lib/types.ts`**

```ts
export interface BookingUser {
  id: string;
  name: string;
  whatsappPhone: string;
  email?: string;
}

export interface BookingAddress {
  addressLine1: string;
  addressLine2?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: number;
}

export interface Booking {
  id: string;
  patientName: string;
  testType: string;
  appointmentDate: string;   // YYYY-MM-DD
  appointmentTime: string;   // e.g. "09:30"
  status: string;
  amount: number;            // paise
  source: string;
  createdAt: string;         // ISO
  updatedAt: string;         // ISO
  refundStatus: string;      // 'none' | 'requested' | 'processed' | …
  thyrocareOrderId: string | null;
  thyrocareLeadId: string | null;
  user: BookingUser;
  address: BookingAddress;
}

export interface DayBucket {
  date: string;        // YYYY-MM-DD
  bookings: Booking[]; // already sorted by appointmentTime ASC
}
```

- [ ] **Step 2: Type-check**

Run: `npm run build` (or just verify no TS errors via your IDE)
Expected: PASS — file is referenced by future tasks; no errors yet.

- [ ] **Step 3: Commit**

```bash
git add app/bookings/lib/types.ts
git commit -m "feat(bookings): add shared Booking and DayBucket types"
```

---

## Task 2: `formatRelativeTime` helper

**Files:**
- Create: `app/bookings/lib/formatRelativeTime.ts`

- [ ] **Step 1: Implement**

```ts
// Returns short relative phrases like "Just now", "5m ago", "3h ago", "2d ago", "3w ago".
// `now` parameter is injectable for deterministic checks.
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const diffMs = now.getTime() - then;
  if (diffMs < 0) return "Just now";

  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "Just now";

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;

  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;

  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;

  const mo = Math.floor(day / 30);
  return `${mo}mo ago`;
}
```

- [ ] **Step 2: Sanity-check via scratch script**

Create a throwaway file `app/bookings/lib/__scratch.ts`:

```ts
import { formatRelativeTime } from "./formatRelativeTime";

const now = new Date("2026-05-08T12:00:00Z");
const cases: Array<[string, string]> = [
  ["2026-05-08T11:59:30Z", "Just now"],
  ["2026-05-08T11:55:00Z", "5m ago"],
  ["2026-05-08T09:00:00Z", "3h ago"],
  ["2026-05-06T12:00:00Z", "2d ago"],
  ["2026-04-24T12:00:00Z", "2w ago"],
];
for (const [iso, expected] of cases) {
  const got = formatRelativeTime(iso, now);
  console.log(got === expected ? "OK" : "FAIL", iso, "->", got, "expected", expected);
}
```

Run: `npx tsx app/bookings/lib/__scratch.ts` (install tsx first if needed: `npm i -D tsx`)
Expected: all `OK`.

- [ ] **Step 3: Delete the scratch file**

```bash
rm app/bookings/lib/__scratch.ts
```

- [ ] **Step 4: Commit**

```bash
git add app/bookings/lib/formatRelativeTime.ts
git commit -m "feat(bookings): add formatRelativeTime helper"
```

---

## Task 3: `dayLabels` helper

**Files:**
- Create: `app/bookings/lib/dayLabels.ts`

- [ ] **Step 1: Implement**

```ts
// Returns a date in YYYY-MM-DD form for the local day, n days from `base`.
export function localDateNDaysFrom(base: Date, n: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Human label for a YYYY-MM-DD date string, relative to `today` (also YYYY-MM-DD).
// "Today" / "Tomorrow" for the first two; otherwise "Sun, 10 May 2026".
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";

  const tomorrow = localDateNDaysFrom(new Date(`${today}T00:00:00`), 1);
  if (date === tomorrow) return "Tomorrow";

  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
```

- [ ] **Step 2: Sanity-check via scratch script**

`app/bookings/lib/__scratch.ts`:

```ts
import { dayLabel, localDateNDaysFrom } from "./dayLabels";

console.log(localDateNDaysFrom(new Date("2026-05-08T00:00:00"), 0)); // 2026-05-08
console.log(localDateNDaysFrom(new Date("2026-05-08T00:00:00"), 6)); // 2026-05-14
console.log(dayLabel("2026-05-08", "2026-05-08")); // Today
console.log(dayLabel("2026-05-09", "2026-05-08")); // Tomorrow
console.log(dayLabel("2026-05-10", "2026-05-08")); // e.g. "Sun, 10 May 2026"
```

Run: `npx tsx app/bookings/lib/__scratch.ts`
Expected: matches comments.

- [ ] **Step 3: Delete the scratch file**

```bash
rm app/bookings/lib/__scratch.ts
```

- [ ] **Step 4: Commit**

```bash
git add app/bookings/lib/dayLabels.ts
git commit -m "feat(bookings): add dayLabel + localDateNDaysFrom helpers"
```

---

## Task 4: `groupByDay` helper

**Files:**
- Create: `app/bookings/lib/groupByDay.ts`

- [ ] **Step 1: Implement**

```ts
import type { Booking, DayBucket } from "./types";
import { localDateNDaysFrom } from "./dayLabels";

// Sort helper: "09:30" < "10:00" — string sort works for HH:MM.
function byTime(a: Booking, b: Booking): number {
  return a.appointmentTime.localeCompare(b.appointmentTime);
}

// Buckets `bookings` by `appointmentDate` over the inclusive window [from, from+days-1].
// Empty days are kept (with empty arrays). Bookings outside the window are dropped.
// Each bucket's `bookings` is sorted by appointmentTime ASC.
export function groupByDay(bookings: Booking[], from: string, days: number): DayBucket[] {
  const base = new Date(`${from}T00:00:00`);
  const buckets = new Map<string, Booking[]>();
  for (let i = 0; i < days; i++) {
    buckets.set(localDateNDaysFrom(base, i), []);
  }

  for (const b of bookings) {
    const list = buckets.get(b.appointmentDate);
    if (list) list.push(b);
  }

  const result: DayBucket[] = [];
  for (const [date, list] of buckets) {
    result.push({ date, bookings: list.sort(byTime) });
  }
  return result;
}
```

- [ ] **Step 2: Sanity-check via scratch script**

`app/bookings/lib/__scratch.ts`:

```ts
import { groupByDay } from "./groupByDay";
import type { Booking } from "./types";

const mk = (id: string, date: string, time: string): Booking => ({
  id, patientName: id, testType: "x", appointmentDate: date, appointmentTime: time,
  status: "confirmed", amount: 0, source: "app", createdAt: "", updatedAt: "",
  refundStatus: "none", thyrocareOrderId: null, thyrocareLeadId: null,
  user: { id: "u", name: "n", whatsappPhone: "" },
  address: { addressLine1: "", city: "", state: "", pincode: 0 },
});

const out = groupByDay(
  [mk("a", "2026-05-09", "10:00"), mk("b", "2026-05-08", "09:30"), mk("c", "2026-05-08", "08:00"), mk("z", "2026-06-01", "10:00")],
  "2026-05-08",
  3,
);

console.log(JSON.stringify(out.map(d => ({ date: d.date, ids: d.bookings.map(x => x.id) })), null, 2));
// Expect:
// [{ date: "2026-05-08", ids: ["c", "a"... wait no — c then b
// [{ "date": "2026-05-08", "ids": ["c", "b"] }, { "date": "2026-05-09", "ids": ["a"] }, { "date": "2026-05-10", "ids": [] }]
```

Run: `npx tsx app/bookings/lib/__scratch.ts`
Expected:
- 3 buckets (2026-05-08, 2026-05-09, 2026-05-10)
- 2026-05-08 contains `["c", "b"]` (08:00 before 09:30)
- 2026-05-09 contains `["a"]`
- 2026-05-10 is empty
- `z` (out of window) is dropped

- [ ] **Step 3: Delete the scratch file**

```bash
rm app/bookings/lib/__scratch.ts
```

- [ ] **Step 4: Commit**

```bash
git add app/bookings/lib/groupByDay.ts
git commit -m "feat(bookings): add groupByDay helper"
```

---

## Task 5: Extract current flat table into `AllBookingsView`

**Files:**
- Create: `app/bookings/components/AllBookingsView.tsx`
- Modify: `app/bookings/page.tsx`

- [ ] **Step 1: Create `AllBookingsView.tsx` containing the current page body**

```tsx
"use client";

import { useEffect, useState } from "react";
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
import type { Booking } from "../lib/types";

const PAGE_SIZE = 50;
const STATUS_OPTIONS = ["all", "pending_payment", "confirmed", "cancelled", "completed"];

export function AllBookingsView() {
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
                <TableHead>Thyrocare ID</TableHead>
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
                  <TableCell className="text-xs font-mono">{b.thyrocareOrderId ?? "—"}</TableCell>
                </TableRow>
              ))}
              {bookings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">No bookings found</TableCell>
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
  );
}
```

- [ ] **Step 2: Replace `app/bookings/page.tsx` with a thin shell that renders `AllBookingsView`**

(Day view comes in Task 9; for now, only the All view exists, with no toggle yet — keeps each task small.)

```tsx
"use client";

export const dynamic = "force-dynamic";

import { AdminLayout } from "@/components/AdminLayout";
import { AllBookingsView } from "./components/AllBookingsView";

export default function BookingsPage() {
  return (
    <AdminLayout title="Bookings">
      <AllBookingsView />
    </AdminLayout>
  );
}
```

- [ ] **Step 3: Build to verify**

Run: `npm run build`
Expected: PASS, no type errors.

- [ ] **Step 4: Manual verify**

Run: `npm run dev`, open `/bookings`, confirm the existing table still works (filter, paginate). New "Thyrocare ID" column shows IDs or `—`.

- [ ] **Step 5: Commit**

```bash
git add app/bookings/page.tsx app/bookings/components/AllBookingsView.tsx
git commit -m "refactor(bookings): extract flat table into AllBookingsView, add thyrocare column"
```

---

## Task 6: `BookingExpandedPanel` (read-only detail panel)

**Files:**
- Create: `app/bookings/components/BookingExpandedPanel.tsx`

- [ ] **Step 1: Implement**

```tsx
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
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/bookings/components/BookingExpandedPanel.tsx
git commit -m "feat(bookings): add read-only BookingExpandedPanel"
```

---

## Task 7: `BookingRow` (collapsed row + expansion)

**Files:**
- Create: `app/bookings/components/BookingRow.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { BookingExpandedPanel } from "./BookingExpandedPanel";
import { formatRelativeTime } from "../lib/formatRelativeTime";
import type { Booking } from "../lib/types";

function fmt12h(time: string): string {
  // "09:30" -> "9:30 AM"
  const [hStr, mStr] = time.split(":");
  let h = parseInt(hStr, 10);
  const m = mStr ?? "00";
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

interface Props {
  booking: Booking;
  expanded: boolean;
  onToggle: () => void;
}

export function BookingRow({ booking, expanded, onToggle }: Props) {
  return (
    <div className="border-t border-border first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-6 py-3 text-left hover:bg-accent/50 transition-colors"
      >
        {expanded ? <ChevronDown size={14} className="text-muted-foreground shrink-0" /> : <ChevronRight size={14} className="text-muted-foreground shrink-0" />}
        <span className="text-sm font-mono w-20 shrink-0">{fmt12h(booking.appointmentTime)}</span>
        <span className="text-sm font-medium flex-1 min-w-0 truncate">{booking.patientName}</span>
        <span className="text-xs font-mono text-muted-foreground hidden sm:inline w-32 truncate">{booking.user.whatsappPhone}</span>
        <span className="text-xs font-mono text-muted-foreground hidden md:inline w-28 truncate">
          {booking.thyrocareOrderId ?? "—"}
        </span>
        <span className="shrink-0"><StatusBadge status={booking.status} /></span>
        <span className="text-xs text-muted-foreground hidden lg:inline w-24 truncate">{booking.address?.city ?? ""}</span>
        <span className="text-xs text-muted-foreground hidden xl:inline w-28 text-right">Booked {formatRelativeTime(booking.createdAt)}</span>
      </button>
      {expanded && <BookingExpandedPanel booking={booking} />}
    </div>
  );
}
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/bookings/components/BookingRow.tsx
git commit -m "feat(bookings): add BookingRow with expansion toggle"
```

---

## Task 8: `DaySection`

**Files:**
- Create: `app/bookings/components/DaySection.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useState } from "react";
import { BookingRow } from "./BookingRow";
import { dayLabel } from "../lib/dayLabels";
import type { DayBucket } from "../lib/types";

export function DaySection({ bucket, today }: { bucket: DayBucket; today: string }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <section className="rounded-lg border border-border overflow-hidden bg-card">
      <header className="px-6 py-3 bg-muted/40 border-b border-border flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{dayLabel(bucket.date, today)}</h3>
        <span className="text-xs text-muted-foreground">
          {bucket.bookings.length} {bucket.bookings.length === 1 ? "booking" : "bookings"}
        </span>
      </header>
      {bucket.bookings.length === 0 ? (
        <p className="px-6 py-6 text-sm text-muted-foreground text-center">No bookings</p>
      ) : (
        <div>
          {bucket.bookings.map((b) => (
            <BookingRow
              key={b.id}
              booking={b}
              expanded={expandedId === b.id}
              onToggle={() => setExpandedId(expandedId === b.id ? null : b.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/bookings/components/DaySection.tsx
git commit -m "feat(bookings): add DaySection with single-row expansion state"
```

---

## Task 9: `DayGroupedView` (fetch + window + load-more)

**Files:**
- Create: `app/bookings/components/DayGroupedView.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import api from "@/lib/api";
import { DaySection } from "./DaySection";
import { groupByDay } from "../lib/groupByDay";
import { localDateNDaysFrom } from "../lib/dayLabels";
import type { Booking, DayBucket } from "../lib/types";

const WINDOW_DAYS = 7;
const FETCH_LIMIT = 500;

function todayLocal(): string {
  return localDateNDaysFrom(new Date(), 0);
}

export function DayGroupedView() {
  const [today] = useState<string>(todayLocal);
  const [windows, setWindows] = useState<DayBucket[][]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWindow = useCallback(async (windowIndex: number): Promise<DayBucket[]> => {
    const from = localDateNDaysFrom(new Date(`${today}T00:00:00`), windowIndex * WINDOW_DAYS);
    const to = localDateNDaysFrom(new Date(`${today}T00:00:00`), windowIndex * WINDOW_DAYS + WINDOW_DAYS - 1);
    const params = new URLSearchParams({
      appointmentFrom: from,
      appointmentTo: to,
      limit: String(FETCH_LIMIT),
    });
    const r = await api.get(`/bookings?${params}`);
    const bookings: Booking[] = r.data.bookings ?? [];
    return groupByDay(bookings, from, WINDOW_DAYS);
  }, [today]);

  useEffect(() => {
    let cancelled = false;
    setLoadingInitial(true);
    fetchWindow(0)
      .then((buckets) => { if (!cancelled) setWindows([buckets]); })
      .catch((e) => { if (!cancelled) setError(e?.message ?? "Failed to load"); })
      .finally(() => { if (!cancelled) setLoadingInitial(false); });
    return () => { cancelled = true; };
  }, [fetchWindow]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = await fetchWindow(windows.length);
      setWindows((w) => [...w, next]);
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to load");
    } finally {
      setLoadingMore(false);
    }
  };

  if (loadingInitial) {
    return (
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border overflow-hidden">
            <Skeleton className="h-10 w-full" />
            <div className="p-3 flex flex-col gap-2">
              {Array.from({ length: 3 }).map((_, j) => <Skeleton key={j} className="h-8" />)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-400">Error: {error}</p>;
  }

  const allBuckets = windows.flat();

  return (
    <div className="flex flex-col gap-4">
      {allBuckets.map((bucket) => (
        <DaySection key={bucket.date} bucket={bucket} today={today} />
      ))}
      <div className="flex justify-center pt-2">
        <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load next 7 days"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/bookings/components/DayGroupedView.tsx
git commit -m "feat(bookings): add DayGroupedView with 7-day window and load-more"
```

---

## Task 10: View toggle in `page.tsx`

**Files:**
- Modify: `app/bookings/page.tsx`

- [ ] **Step 1: Add toggle reading from `?view=`**

```tsx
"use client";

export const dynamic = "force-dynamic";

import { useRouter, useSearchParams } from "next/navigation";
import { AdminLayout } from "@/components/AdminLayout";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AllBookingsView } from "./components/AllBookingsView";
import { DayGroupedView } from "./components/DayGroupedView";

type View = "day" | "all";

export default function BookingsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const view: View = params.get("view") === "all" ? "all" : "day";

  const setView = (v: View) => {
    const next = new URLSearchParams(params.toString());
    next.set("view", v);
    router.replace(`/bookings?${next.toString()}`);
  };

  return (
    <AdminLayout title="Bookings">
      <div className="flex flex-col gap-4">
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList>
            <TabsTrigger value="day">By day</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        {view === "day" ? <DayGroupedView /> : <AllBookingsView />}
      </div>
    </AdminLayout>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/bookings/page.tsx
git commit -m "feat(bookings): add By-day / All view toggle"
```

---

## Task 11: Manual verification

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Open `/bookings`**

Verify:
- Default view is "By day".
- First section is labelled "Today" with current date count.
- Second section is "Tomorrow".
- Subsequent sections show weekday + date (e.g. "Sun, 10 May 2026").
- Within a section, bookings are sorted by appointment time ascending (earliest first).
- Empty days show "No bookings".
- Collapsed row shows: time, patient, phone, Thyrocare ID (or `—`), status badge, city, "Booked Xd ago".
- Clicking a row expands it; clicking another row in the same day collapses the first.
- Expanded panel shows customer, patient/appointment, order tracking sections; "Open user profile →" links to `/users/[id]`.
- "Load next 7 days" appends another window of 7 day sections at the bottom.

- [ ] **Step 3: Toggle to "All"**

Verify:
- URL becomes `/bookings?view=all`.
- Existing flat table renders with status filter, pagination, and the new Thyrocare ID column.
- Switching back to "By day" updates URL to `?view=day`.

- [ ] **Step 4: Responsive check**

Resize browser narrower; verify columns drop in this order: "Booked X ago" (xl→lg), city (lg→md), Thyrocare ID (md→sm), phone (sm→xs). Time, patient, status badge stay visible.

- [ ] **Step 5: Lint + build clean**

Run: `npm run lint && npm run build`
Expected: both PASS.

- [ ] **Step 6: Final commit if any tweaks were needed**

```bash
git add -A
git commit -m "chore(bookings): tweaks from manual verification"
```

(If nothing needed tweaking, skip.)

---

## Self-Review

**Spec coverage:**
- Day-grouped default view → Tasks 8, 9, 10 ✓
- Today first, Tomorrow next, then dates → Task 3 (`dayLabel`) + Task 8 ✓
- Sort by appointment time within day → Task 4 (`groupByDay`) ✓
- Initial 7 days + Load more → Task 9 ✓
- Empty days shown → Task 8 ✓
- Collapsed row fields (time, name, phone, Thyrocare ID, status, city, booked ago) → Task 7 ✓
- Expanded read-only panel with all spec sections → Task 6 ✓
- Toggle between By day and All → Task 10 ✓
- All view preserved with new Thyrocare ID column → Task 5 ✓
- Backend endpoint `appointmentFrom`/`appointmentTo` usage → Task 9 ✓
- File structure in spec → matches Tasks 1-9 ✓
- Edge cases (no Thyrocare ID, missing address fields, refund status) → Task 6 (BookingExpandedPanel) ✓
- Out of scope items honoured (no actions, no real-time, no print) ✓

**Placeholder scan:** None — all steps have concrete code or commands.

**Type consistency:** `Booking` shape defined in Task 1 is used identically in Tasks 5–9. `DayBucket` defined in Task 1 is consumed by Tasks 8 and 9. `groupByDay(bookings, from, days)` signature matches between Task 4 and Task 9.
