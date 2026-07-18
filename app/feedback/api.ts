// ─────────────────────────────────────────────────────────────────────────────
// Every network call the Feedback module makes. THE ONLY PLACE axios is touched
// here — components import functions from this file, never `@/lib/api`.
//
// Paths are relative to the admin API base, which already carries
// `/api/v1/admin` (see lib/api.ts).
//
// The feedback backend (the /feedback/* endpoints) is NOT live yet — it is being
// built in parallel to the v2 living-note contract. Until it ships, everything
// under /feedback 404s. That is surfaced to the operator as a calm "not built
// yet" line — never mocked, stubbed, or swallowed. GET /users DOES work today, so
// the customer picker is exercised even before the feedback backend lands.
//
// If a path or a field name is wrong, it is wrong HERE and in types.ts, and
// nowhere else. That is the entire point of this file.
// ─────────────────────────────────────────────────────────────────────────────

import api from "@/lib/api";
import {
  type CustomerFeedParams,
  type CustomerFeedResponse,
  type CustomerNote,
  type ExportParams,
  type LogFeedbackRequest,
  type LogFeedbackResponse,
  type OrganizeResult,
  type PickableBooking,
  type PickableUser,
} from "./types";

// ── Save a dump ──────────────────────────────────────────────────────────────

/**
 * POST /feedback — save one dump against a customer.
 *
 * The save is instant and does NOT wait on the AI organize (that runs in the
 * background server-side). Attribution and `createdAt` are stamped server-side
 * from the bearer token. Optional fields are omitted entirely when empty rather
 * than sent as null/"" — the backend is strict and 400s on unknown keys, and an
 * empty string is not the same as "not provided". v2 has NO tags: with no booking
 * the body is exactly `{ userId, channel, notes }`.
 */
export async function logFeedback(input: LogFeedbackRequest): Promise<LogFeedbackResponse> {
  const payload: Record<string, unknown> = {
    userId: input.userId,
    channel: input.channel,
    notes: input.notes.trim(),
  };
  if (input.bookingId) payload.bookingId = input.bookingId;

  const r = await api.post<LogFeedbackResponse>("/feedback", payload);
  return r.data;
}

// ── The feed of customers ────────────────────────────────────────────────────

/**
 * GET /feedback/customers — the feed. One row per customer with feedback, newest
 * activity first, paginated (offset/limit) and filterable.
 */
export async function listFeedbackCustomers(
  params: CustomerFeedParams
): Promise<CustomerFeedResponse> {
  const r = await api.get<{ total?: number; customers?: CustomerFeedResponse["customers"] }>(
    `/feedback/customers?${toQuery(params)}`
  );
  const customers = r.data?.customers ?? [];
  return { total: r.data?.total ?? customers.length, customers };
}

// ── One customer's living note ───────────────────────────────────────────────

/**
 * GET /feedback/customers/:userId — the AI-organized note plus every raw dump
 * (newest first). The dumps are the verbatim source; the organized text is a view
 * on top of them.
 */
export async function getCustomerNote(userId: string): Promise<CustomerNote> {
  const r = await api.get<CustomerNote>(`/feedback/customers/${encodeURIComponent(userId)}`);
  const d = r.data;
  return {
    userName: d?.userName ?? "",
    organizedText: d?.organizedText ?? "",
    organizedAt: d?.organizedAt ?? null,
    organizeStatus: d?.organizeStatus ?? "pending",
    dumps: d?.dumps ?? [],
  };
}

/**
 * POST /feedback/customers/:userId/organize — force a re-organize of the note
 * (retry after a failure, or refresh on demand). Returns the regenerated summary.
 */
export async function organizeCustomerNote(userId: string): Promise<OrganizeResult> {
  const r = await api.post<OrganizeResult>(
    `/feedback/customers/${encodeURIComponent(userId)}/organize`
  );
  const d = r.data;
  return {
    organizedText: d?.organizedText ?? "",
    organizedAt: d?.organizedAt ?? null,
    organizeStatus: d?.organizeStatus ?? "pending",
  };
}

// ── Export ───────────────────────────────────────────────────────────────────

/**
 * GET /feedback/export — a CSV file (text/csv, Content-Disposition attachment).
 *
 * Fetched as a blob THROUGH the axios client so the request interceptor attaches
 * the bearer token — a plain `<a href>` would hit the endpoint unauthenticated
 * and 401. The caller turns the blob into a download (createObjectURL + a
 * temporary <a download>, then revokes the URL); this function only fetches.
 *
 * `includePii` defaults to false and `mode` to "dumps" server-side; we still send
 * both explicitly so the defaults are visible at the call site.
 */
export async function exportFeedback(
  params: ExportParams
): Promise<{ blob: Blob; filename: string }> {
  const query = toQuery({
    from: params.from,
    to: params.to,
    includePii: params.includePii ?? false,
    mode: params.mode ?? "dumps",
  });
  const r = await api.get(`/feedback/export?${query}`, { responseType: "blob" });
  const disposition =
    (r.headers as Record<string, string> | undefined)?.["content-disposition"] ?? "";
  return {
    blob: r.data as Blob,
    filename: filenameFromDisposition(disposition) ?? defaultExportName(params),
  };
}

/** Pull `filename="…"` out of a Content-Disposition header. */
function filenameFromDisposition(disposition: string): string | null {
  // RFC 5987 `filename*=` first (may be percent-encoded), then plain `filename=`.
  const star = /filename\*=(?:UTF-8'')?["']?([^"';]+)/i.exec(disposition);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      return star[1];
    }
  }
  const plain = /filename=["']?([^"';]+)/i.exec(disposition);
  return plain?.[1] ?? null;
}

/** Fallback name when the server sends no Content-Disposition. */
function defaultExportName(params: ExportParams): string {
  const range = params.from || params.to ? `${params.from ?? "start"}_${params.to ?? "now"}` : "all";
  return `feedback-${params.mode ?? "dumps"}-${range}.csv`;
}

// ── Existing endpoint this module reads from ─────────────────────────────────
// Lives here so ALL axios in the feedback module stays in one file.

/**
 * GET /users?limit=200 — the customer picker. Filtered client-side by name/phone
 * as the operator types (no server search endpoint exists for the picker; the
 * feed's own `search` param is separate). The `/users` payload carries much more
 * per user — see app/users/page.tsx — but the picker only needs id/name/phone.
 */
export async function listUsersForPicker(): Promise<PickableUser[]> {
  const r = await api.get<{ users?: Array<{ id: string; name?: string; whatsappPhone?: string }> }>(
    "/users?limit=200"
  );
  return (r.data?.users ?? []).map((u) => ({
    id: u.id,
    name: u.name ?? "",
    whatsappPhone: u.whatsappPhone ?? "",
  }));
}

/**
 * GET /users/:id — used only for its `bookings`, to offer an OPTIONAL "which
 * booking is this feedback about?" picker once a customer is chosen. Feedback is
 * often general (no booking), so this is never required.
 */
export async function listUserBookings(userId: string): Promise<PickableBooking[]> {
  const r = await api.get<{ bookings?: Array<{ id: string; testType?: string; appointmentDate?: string; status?: string }> }>(
    `/users/${userId}`
  );
  return (r.data?.bookings ?? []).map((b) => ({
    id: b.id,
    testType: b.testType ?? "",
    appointmentDate: b.appointmentDate ?? "",
    status: b.status ?? "",
  }));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * The date inputs give us bare `YYYY-MM-DD`, but the backend's `from`/`to` filters
 * require a full ISO datetime (a bare date is a 400: "from: Invalid input",
 * verified against dev). Expand `from` to the start of that day and `to` to the
 * END of it, so a "to" of the 31st includes everything that happened that day
 * rather than stopping at midnight. Values already carrying a time are left as-is.
 */
function normalizeDateParam(key: string, value: string): string {
  if ((key !== "from" && key !== "to") || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return key === "from" ? `${value}T00:00:00.000Z` : `${value}T23:59:59.999Z`;
}

function toQuery(params: object): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params) as Array<[string, unknown]>) {
    if (v === undefined || v === null || v === "") continue;
    q.set(k, normalizeDateParam(k, String(v)));
  }
  return q.toString();
}

/**
 * Turn an axios failure into something an operator can act on.
 *
 * A 404 on a /feedback route means the backend is not built yet (it is shipping in
 * parallel), NOT a stale link — so it gets its own reassuring line rather than
 * "not found". A 400 is surfaced VERBATIM: the server enforces "notes required"
 * and rejects unknown keys with a body that says exactly what is wrong, and
 * paraphrasing it throws away the only explanation the operator gets.
 */
export function feedbackErrorMessage(err: unknown): string {
  const e = err as {
    code?: string;
    message?: string;
    response?: { status?: number; data?: { message?: string | string[]; error?: string } };
  };
  const status = e?.response?.status;
  const rawBody = e?.response?.data?.message ?? e?.response?.data?.error;
  // Nest's ValidationPipe returns `message` as an array of strings. On a blob
  // response (the export) the body isn't parseable — fall through to status text.
  const fromBody =
    Array.isArray(rawBody) ? rawBody.join(" ") : typeof rawBody === "string" ? rawBody : undefined;

  if (status === 404) {
    return "The feedback API isn't available yet — the backend is being built. This page will light up the moment it ships.";
  }
  if (status === 400) {
    return fromBody ?? "The server rejected that — check the fields and try again.";
  }
  if (status === 403) {
    return "You don't have permission to do that.";
  }
  if (status && status >= 500) {
    return fromBody ?? "The server errored. Try again in a moment.";
  }
  if (e?.code === "ECONNABORTED") {
    return "That request timed out. Check your connection and try again.";
  }
  if (!status) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return fromBody ?? e?.message ?? "Something went wrong.";
}

/**
 * Whether a failure is the "backend not built yet" 404, so a page can show a calm
 * building-in-progress panel instead of a red outage box. Kept next to
 * feedbackErrorMessage so the two can't disagree about what a 404 means.
 */
export function isNotBuiltYet(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status === 404;
}
