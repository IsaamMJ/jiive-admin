// ─────────────────────────────────────────────────────────────────────────────
// Every network call the Feedback Calls module makes. THE ONLY PLACE axios is
// touched here — components import functions from this file, never `@/lib/api`.
//
// Paths are relative to the admin API base, which already carries
// `/api/v1/admin` (see lib/api.ts).
//
// If a path or a field name is wrong, it is wrong HERE and in types.ts, and
// nowhere else. That is the entire point of this file.
// ─────────────────────────────────────────────────────────────────────────────

import api from "@/lib/api";
import {
  CALL_DISPOSITIONS,
  CALL_QUEUE_REASONS,
  DEFAULT_MAX_CALL_ATTEMPTS,
  DISPOSITION_LABEL,
  FALLBACK_CALL_META,
  humanizeEnumValue,
  QUEUE_REASON_LABEL,
  type CallDisposition,
  type CallMeta,
  type CallQueueResponse,
  type CallQueueRow,
  type CallQueueReason,
  type CallStats,
  type LogCallRequest,
  type LogCallResponse,
  type MetaOption,
} from "./types";

// ── Queue ────────────────────────────────────────────────────────────────────

/**
 * The page size we ask for. The server's own ceiling — `?limit=200` answers 200
 * OK on both backends (verified live 2026-08-07). Sent explicitly rather than
 * left to the server's default so the number of rows on screen is a decision
 * made here, where the "showing N of M" copy that depends on it also lives.
 */
export const QUEUE_LIMIT = 200;

/**
 * GET /calls/queue — the worklist. Who to ring next, and why.
 *
 * ⚠️ UNKNOWN query params are rejected with a hard 400 rather than ignored (the
 * DTO is `.strict()`), and a 400 here renders the queue permanently empty —
 * which reads as "nobody to call" and quietly kills the feature. That warning is
 * about keys the schema does not declare. `limit` IS declared, and was curled
 * against both dev and prod before being added here:
 *   dev  `?limit=1` → `{ queue: [1 row], total: 2 }`   `?limit=200` → 200 OK
 *   prod `?limit=1` → `{ queue: [1 row], total: 10 }`  `?limit=200` → 200 OK
 * Note the second number in each: `total` is counted BEFORE the slice, so it is
 * a real count and not the page length. Still — do not add a param without
 * curling it first.
 *
 * Rows come back grouped by visit and priority-ordered. We re-sort by `priority`
 * defensively (lower = sooner) rather than trusting array order, but we never
 * re-rank: the server owns the ordering rule and the whole promise of this screen
 * is that choosing who is next is not a task.
 */
export async function getCallQueue(): Promise<CallQueueResponse> {
  const r = await api.get<{ queue?: CallQueueRow[]; total?: number }>(`/calls/queue?limit=${QUEUE_LIMIT}`);
  const rows = [...(r.data?.queue ?? [])].sort(compareQueueRows);
  // `total` is NULL when the server didn't send one, never `rows.length`.
  //
  // The old code defaulted to the array length, which is the precise bug this
  // page had: a page of 50 out of 200 people due a call would have rendered as
  // "50", indistinguishable from a queue that really is 50 long. Both backends
  // send a real total today; if one ever stops, the screen says the count is
  // unavailable instead of quietly reporting a page size as a headcount.
  const total = typeof r.data?.total === "number" && Number.isFinite(r.data.total) ? r.data.total : null;
  return { queue: rows, total };
}

/**
 * Priority first (lower = call sooner). Then a callback we promised, because a
 * callback is a commitment we made to a specific time. Then the oldest
 * appointment, so nobody ages out of the queue while newer rows jump it.
 */
function compareQueueRows(a: CallQueueRow, b: CallQueueRow): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.callbackDue !== b.callbackDue) return a.callbackDue ? -1 : 1;
  return (a.appointmentDate ?? "").localeCompare(b.appointmentDate ?? "");
}

// ── Log a call ───────────────────────────────────────────────────────────────

/**
 * POST /calls — log one call.
 *
 * `calledByAdminId`, `startedAt` and `endedAt` are stamped server-side from the
 * bearer token. Optional fields are omitted entirely when empty rather than sent
 * as null/"" — the backend is strict, and an empty string is not the same as
 * "not asked".
 *
 * A terminal disposition (connected / refused / wrong_number / do_not_contact)
 * removes the row from the queue for good, so the caller must refetch after this
 * resolves.
 */
export async function logCall(body: LogCallRequest): Promise<LogCallResponse> {
  const payload: LogCallRequest = {
    userId: body.userId,
    queueReason: body.queueReason,
    disposition: body.disposition,
  };
  if (body.bookingId) payload.bookingId = body.bookingId;
  if (body.incidentId) payload.incidentId = body.incidentId;
  if (typeof body.csat === "number") payload.csat = body.csat;
  if (body.tags && body.tags.length > 0) payload.tags = body.tags;
  if (body.notes && body.notes.trim() !== "") payload.notes = body.notes.trim();
  if (body.verbatim && body.verbatim.trim() !== "") payload.verbatim = body.verbatim.trim();
  if (typeof body.resolved === "boolean") payload.resolved = body.resolved;
  if (body.callbackAt) payload.callbackAt = body.callbackAt;

  const r = await api.post<LogCallResponse>("/calls", payload);
  return r.data;
}

/**
 * Add a plain free-text REMARK against a person — the "I called them, here's what
 * they said" note, with none of the connected/refused/CSAT ceremony.
 *
 * Stored as a call log with disposition "remark": note-only, no score, and
 * NON-TERMINAL (the person stays in the queue), so remarks accumulate as a
 * running notebook under their previous calls.
 *
 * ⚠️ Needs the backend to accept disposition "remark" (note-only, csat not
 * required). Until it does, this 400s — surfaced to the operator, never silent.
 */
export async function addRemark(input: {
  userId: string;
  queueReason: CallQueueReason;
  notes: string;
  bookingId?: string;
  incidentId?: string;
}): Promise<LogCallResponse> {
  const payload: Record<string, unknown> = {
    userId: input.userId,
    queueReason: input.queueReason,
    disposition: "remark",
    notes: input.notes.trim(),
  };
  if (input.bookingId) payload.bookingId = input.bookingId;
  if (input.incidentId) payload.incidentId = input.incidentId;
  const r = await api.post<LogCallResponse>("/calls", payload);
  return r.data;
}

// ── Stats ────────────────────────────────────────────────────────────────────

/**
 * GET /calls/stats — CSAT top-2-box, response count, and the raw tag counts.
 *
 * The tag counts are the artefact this whole feature exists to produce, and
 * showing them to the caller is what stops the logging dying: data entry that
 * never comes back to the person entering it is why CRMs go unused.
 */
export async function getCallStats(): Promise<CallStats> {
  const r = await api.get<Partial<CallStats>>("/calls/stats");
  const d = r.data ?? {};
  return {
    // totalCalls counts call ATTEMPTS (connected/no_answer/… — everything with a
    // real disposition). Remarks are notes, not calls, so the backend keeps them
    // out of this number and reports them separately as remarkCount.
    totalCalls: d.totalCalls ?? 0,
    remarkCount: d.remarkCount ?? 0,
    byDisposition: d.byDisposition ?? {},
    csatResponses: d.csatResponses ?? 0,
    csatTop2BoxPercent: d.csatTop2BoxPercent ?? 0,
    csatAverage: d.csatAverage ?? 0,
    tagCounts: d.tagCounts ?? {},
    optedOutUsers: d.optedOutUsers ?? 0,
  };
}

// ── Meta ─────────────────────────────────────────────────────────────────────

/**
 * GET /incidents/meta — the same endpoint the incident log reads, which also
 * carries the CALL vocabulary: `callDispositions`, `callQueueReasons`,
 * `callTags`, `maxCallAttempts`.
 *
 * Tolerant on the way in: each group is accepted either as a bare `string[]` or
 * as `{ value, label }[]`. Dispositions and queue reasons fall back to the local
 * constants (they are fixed by the contract). `callTags` does NOT fall back — see
 * the note on CallMeta.tags. A tag list we made up would either 400 on save or,
 * worse, write a value that never aggregates with the server's.
 */
export async function getCallMeta(): Promise<CallMeta> {
  const r = await api.get<Record<string, unknown>>("/incidents/meta");
  const raw = r.data ?? {};

  const maxRaw = raw.maxCallAttempts;
  const maxAttempts =
    typeof maxRaw === "number" && Number.isFinite(maxRaw) && maxRaw > 0
      ? maxRaw
      : DEFAULT_MAX_CALL_ATTEMPTS;

  return {
    dispositions: metaGroup<CallDisposition>(
      raw.callDispositions,
      FALLBACK_CALL_META.dispositions,
      DISPOSITION_LABEL,
      CALL_DISPOSITIONS
    ),
    queueReasons: metaGroup<CallQueueReason>(
      raw.callQueueReasons,
      FALLBACK_CALL_META.queueReasons,
      QUEUE_REASON_LABEL,
      CALL_QUEUE_REASONS
    ),
    // Empty fallback, on purpose.
    tags: metaGroup<string>(raw.callTags, [], {}, null),
    maxAttempts,
  };
}

/**
 * Normalise one meta group. `known`, when given, filters out any value outside
 * the contract's fixed vocabulary — a disposition we can't render a button for
 * would otherwise become a dead tap target. Tags pass `null` because their
 * vocabulary is the server's and is meant to grow.
 */
function metaGroup<T extends string>(
  raw: unknown,
  fallback: MetaOption<T>[],
  labels: Record<string, string>,
  known: readonly string[] | null
): MetaOption<T>[] {
  if (!Array.isArray(raw) || raw.length === 0) return fallback;

  const options: MetaOption<T>[] = [];
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
    if (known && !known.includes(value)) continue;
    options.push({ value: value as T, label: label ?? labels[value] ?? humanizeEnumValue(value) });
  }

  return options.length > 0 ? options : fallback;
}

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * Turn an axios failure into something the caller can act on.
 *
 * A 400 is surfaced VERBATIM. That is deliberate: the server enforces
 * "csat (1-5) is required when disposition is 'connected'" and "callbackAt is
 * required when disposition is 'callback'", and those two sentences say exactly
 * what to do. Paraphrasing them into "check the fields" throws away the only
 * explanation the caller gets — while they still have the customer on the line.
 */
export function callErrorMessage(err: unknown): string {
  const e = err as {
    code?: string;
    message?: string;
    response?: { status?: number; data?: { message?: string | string[]; error?: string } };
  };
  const status = e?.response?.status;
  const rawBody = e?.response?.data?.message ?? e?.response?.data?.error;
  // Nest's ValidationPipe returns `message` as an array of strings.
  const fromBody = Array.isArray(rawBody) ? rawBody.join(" ") : rawBody;

  if (status === 400) {
    return fromBody ?? "The server rejected that — check the fields and try again.";
  }
  if (status === 403) {
    return "You don't have permission to do that.";
  }
  if (status === 404) {
    return "Not found — this person may already have been called, or the queue is stale.";
  }
  if (status === 409) {
    return fromBody ?? "That call has already been logged.";
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
