// Datetime plumbing for the incident forms.
//
// `<input type="datetime-local">` speaks local wall-clock ("2026-06-21T07:20") and
// the API speaks ISO/UTC. These convert between the two without a library, and
// without the classic off-by-a-timezone bug of slicing an ISO string directly.

/** Date → the value a datetime-local input expects, in the user's own timezone. */
export function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value → ISO string. Returns null if the input is empty or unparseable. */
export function datetimeLocalToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value); // Parsed as LOCAL time — which is what the operator typed.
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO → datetime-local value, for editing an existing timestamp. */
export function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : toDatetimeLocalValue(d);
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  // Bare YYYY-MM-DD must be read as a local calendar date, not as UTC midnight,
  // or a due date can render as "the day before" west of Greenwich.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

/** Today as YYYY-MM-DD in the user's timezone — the min for a due-date input. */
export function todayLocalDate(): string {
  return toDatetimeLocalValue(new Date()).slice(0, 10);
}

/** A due date is overdue when its local calendar day is strictly before today. */
export function isOverdue(dueDate: string, doneAt: string | null): boolean {
  if (doneAt) return false;
  return dueDate < todayLocalDate();
}

/** "Filed 4h after it happened" — the detection-latency gap the handoff calls a metric. */
export function describeDetectionGap(occurredAt: string, reportedAt: string): string | null {
  const o = new Date(occurredAt).getTime();
  const r = new Date(reportedAt).getTime();
  if (Number.isNaN(o) || Number.isNaN(r)) return null;
  const mins = Math.round((r - o) / 60_000);
  if (mins < 5) return null; // Filed essentially live — nothing worth saying.
  if (mins < 60) return `filed ${mins}m after it happened`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `filed ${hrs}h after it happened`;
  return `filed ${Math.round(hrs / 24)}d after it happened`;
}
