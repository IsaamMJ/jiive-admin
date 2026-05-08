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
