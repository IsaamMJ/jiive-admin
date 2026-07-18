// ─────────────────────────────────────────────────────────────────────────────
// Every network call the Feedback module makes. THE ONLY PLACE axios is touched
// here — components import functions from this file, never `@/lib/api`.
//
// Paths are relative to the admin API base, which already carries
// `/api/v1/admin` (see lib/api.ts).
//
// The feedback backend is NOT live yet (being built in parallel to
// docs/handoff-backend-feedback.md). Until it ships, POST/GET /feedback and the
// export 404. That is surfaced to the operator as a clear "not built yet" line —
// never mocked, stubbed, or swallowed.
//
// If a path or a field name is wrong, it is wrong HERE and in types.ts, and
// nowhere else. That is the entire point of this file.
// ─────────────────────────────────────────────────────────────────────────────

import api from "@/lib/api";
import {
  EMPTY_FEEDBACK_META,
  humanizeEnumValue,
  type ExportParams,
  type FeedbackListParams,
  type FeedbackListResponse,
  type FeedbackMeta,
  type LogFeedbackRequest,
  type LogFeedbackResponse,
  type MetaOption,
  type PickableUser,
} from "./types";

// ── Log ──────────────────────────────────────────────────────────────────────

/**
 * POST /feedback — log one piece of feedback.
 *
 * `loggedByLabel` and `createdAt` are stamped server-side from the bearer token.
 * Optional fields are omitted entirely when empty rather than sent as null/"" —
 * the backend is strict and 400s on unknown keys, and an empty string is not the
 * same as "not asked".
 */
export async function logFeedback(input: LogFeedbackRequest): Promise<LogFeedbackResponse> {
  const payload: Record<string, unknown> = {
    userId: input.userId,
    channel: input.channel,
    notes: input.notes.trim(),
  };
  if (input.tags && input.tags.length > 0) payload.tags = input.tags;
  if (input.bookingId) payload.bookingId = input.bookingId;
  if (input.incidentId) payload.incidentId = input.incidentId;

  const r = await api.post<LogFeedbackResponse>("/feedback", payload);
  return r.data;
}

// ── Feed ─────────────────────────────────────────────────────────────────────

/** GET /feedback — the feed. Newest first, paginated (offset/limit), filterable. */
export async function listFeedback(params: FeedbackListParams): Promise<FeedbackListResponse> {
  const r = await api.get<{ total?: number; feedback?: FeedbackListResponse["feedback"] }>(
    `/feedback?${toQuery(params)}`
  );
  const rows = r.data?.feedback ?? [];
  return { total: r.data?.total ?? rows.length, feedback: rows };
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
 * `includePii` defaults to false server-side; we still send it explicitly so the
 * default is visible at the call site.
 */
export async function exportFeedback(
  params: ExportParams
): Promise<{ blob: Blob; filename: string }> {
  const query = toQuery({
    from: params.from,
    to: params.to,
    includePii: params.includePii ?? false,
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
  return `feedback-${range}.csv`;
}

// ── Meta ─────────────────────────────────────────────────────────────────────

/**
 * GET /incidents/meta — the same endpoint the incident and call logs read, which
 * also carries the feedback tag vocabulary under `callTags`.
 *
 * Tolerant on the way in: the group is accepted either as a bare `string[]` or as
 * `{ value, label }[]`. NO fallback — the tag list is the server's, and a made-up
 * one would either 400 on save or write a value that never aggregates (see the
 * note on FeedbackMeta.tags).
 */
export async function getFeedbackMeta(): Promise<FeedbackMeta> {
  const r = await api.get<Record<string, unknown>>("/incidents/meta");
  const raw = r.data ?? {};
  return { tags: metaGroup(raw.callTags) };
}

function metaGroup(raw: unknown): MetaOption[] {
  if (!Array.isArray(raw) || raw.length === 0) return EMPTY_FEEDBACK_META.tags;

  const options: MetaOption[] = [];
  for (const item of raw) {
    let value: string | null = null;
    let label: string | null = null;

    if (typeof item === "string") {
      value = item;
    } else if (item && typeof item === "object") {
      const o = item as { value?: unknown; label?: unknown };
      if (typeof o.value === "string") value = o.value;
      if (typeof o.label === "string" && o.label !== "") label = o.label;
    }

    if (value === null) continue;
    options.push({ value, label: label ?? humanizeEnumValue(value) });
  }
  return options;
}

// ── Existing endpoint this module reads from ─────────────────────────────────
// Lives here so ALL axios in the feedback module stays in one file.

/**
 * GET /users?limit=200 — the customer picker. Filtered client-side by name/phone
 * as the operator types (no server search endpoint exists for v1; the handoff
 * defers it). The `/users` payload carries much more per user — see
 * app/users/page.tsx — but the picker only needs id/name/phone.
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function toQuery(params: object): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params) as Array<[string, unknown]>) {
    if (v === undefined || v === null || v === "") continue;
    q.set(k, String(v));
  }
  return q.toString();
}

/**
 * Turn an axios failure into something an operator can act on.
 *
 * A 404 on the feed means the backend is not built yet (it is shipping in
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
 * Whether a failure is the "backend not built yet" 404, so the feed can show a
 * calm building-in-progress panel instead of a red outage box. Kept next to
 * feedbackErrorMessage so the two can't disagree about what a 404 means.
 */
export function isNotBuiltYet(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status === 404;
}
