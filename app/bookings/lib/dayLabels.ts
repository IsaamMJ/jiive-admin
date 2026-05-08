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
