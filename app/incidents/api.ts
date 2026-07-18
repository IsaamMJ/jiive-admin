// ─────────────────────────────────────────────────────────────────────────────
// Every network call the Incident Log makes. THE ONLY PLACE axios is touched in
// this module — components import functions from here, never `@/lib/api`.
//
// The backend is LIVE on dev. Every path below is stated relative to the admin
// API base, which already carries `/api/v1/admin` (see lib/api.ts) — matching the
// handoff's @Controller('api/v1/admin/incidents').
//
// If a path or a field name is wrong, it is wrong HERE and in types.ts, and
// nowhere else. That is the entire point of this file.
// ─────────────────────────────────────────────────────────────────────────────

import api from "@/lib/api";
import {
  FALLBACK_META,
  type AddTimelineEntryRequest,
  type CreateActionItemRequest,
  type FileIncidentRequest,
  type IncidentBooking,
  type IncidentDetail,
  type IncidentListParams,
  type IncidentListResponse,
  type IncidentMeta,
  type IncidentStatsResponse,
  type IncidentDraft,
  type IncidentSummary,
  type MetaOption,
  type OpenActionsResponse,
  type PickerBooking,
  type RcaOwedResponse,
  type UpdateActionItemRequest,
  type UpdateIncidentRequest,
  type WireIncident,
  type WireIncidentEnvelope,
} from "./types";
import { humanizeEnumValue } from "./types";
import type { Booking } from "@/app/bookings/lib/types";
import { normalizeBookings } from "@/app/bookings/lib/normalizeBooking";
import { localDateNDaysFrom } from "@/app/bookings/lib/dayLabels";

// ── Normalisers ──────────────────────────────────────────────────────────────
//
// The server's incident payload is an ENVELOPE: the incident's own fields sit
// under `.incident`, and the resolved customers / bookings / paymentBatchIds /
// timeline hang off it as siblings. The components want one flat object with a
// `context` on it. These two functions are the only place that translation
// happens — which is the whole reason this file exists.

function normalizeSummary(w: WireIncident): IncidentSummary {
  const status = w.status;
  const rcaRequired = w.rcaRequired ?? false;
  const factors = w.contributingFactors ?? [];

  return {
    id: w.id,
    ref: w.ref,
    title: w.title,
    severity: w.severity,
    originalSeverity: w.originalSeverity ?? w.severity,
    severityReassigned: w.severityReassigned ?? false,
    status,
    category: w.category,
    vendor: w.vendor,
    occurredAt: w.occurredAt,
    reportedAt: w.reportedAt,
    resolvedAt: w.resolvedAt ?? null,
    closedAt: w.closedAt ?? null,
    affectedOrderIds: w.affectedOrderIds ?? [],
    filedBy: w.filedBy ?? null,
    owner: w.owner ?? null,
    customerName: w.customerName ?? null,
    rcaRequired,
    rcaOverdue: w.rcaOverdue ?? false,
    rcaDueAt: w.rcaDueAt ?? null,
    detectionLatencyMinutes: w.detectionLatencyMinutes ?? null,
    // Derived, not sent. On a list row `contributingFactors` may be absent, in
    // which case an un-closed incident that owes an RCA counts as owing one —
    // which is the safe direction to be wrong in. The authoritative count is
    // GET /incidents/rca-owed.
    rcaOwed: rcaRequired && status !== "CLOSED" && factors.length === 0,
  };
}

/** Accepts the envelope, or a bare incident if an endpoint ever returns one unwrapped. */
function normalizeDetail(raw: WireIncidentEnvelope | WireIncident): IncidentDetail {
  const env = (raw as WireIncidentEnvelope).incident
    ? (raw as WireIncidentEnvelope)
    : ({ incident: raw as WireIncident } as WireIncidentEnvelope);
  const w = env.incident;

  const bookings = env.bookings ?? [];
  const affected = w.affectedOrderIds ?? [];

  // The server returns ONE bookings array — the orders that were named plus the
  // ones pulled in from the same payment batch. Split it back apart so the UI can
  // still say "and these four came along with the batch", which is the entire
  // point of surfacing the batch ("6 orders / 18 vials" is one event, not six).
  const named = new Set(affected);
  const linked: IncidentBooking[] = [];
  const siblings: IncidentBooking[] = [];
  for (const b of bookings) {
    if (b.thyrocareOrderId && named.has(b.thyrocareOrderId)) linked.push(b);
    else siblings.push(b);
  }

  // An order ID that resolved to no booking must fail loudly, not sit there as a
  // dangling string. The server doesn't flag these, so we work them out.
  const resolvedIds = new Set(
    bookings.map((b) => b.thyrocareOrderId).filter((x): x is string => Boolean(x))
  );
  const unresolvedOrderIds = affected.filter((id) => !resolvedIds.has(id));

  return {
    ...normalizeSummary(w),
    whatHappened: w.whatHappened ?? "",
    whatWentWell: w.whatWentWell ?? null,
    slaBreached: w.slaBreached ?? false,
    slaDetail: w.slaDetail ?? null,
    vendorCommitment: w.vendorCommitment ?? null,
    tags: w.tags ?? [],
    contributingFactors: w.contributingFactors ?? [],
    // The live response calls this `actions` (verified against dev). Reading only
    // `actionItems` meant existing action items never rendered — the RCA block
    // showed "no action items yet" even when the incident had them.
    actionItems: env.actions ?? w.actionItems ?? env.actionItems ?? [],
    timeline: env.timeline ?? [],
    context: {
      customer: env.customers?.[0] ?? null,
      // There is no top-level `address` on the wire — it hangs off each booking.
      // Reading only the top level made the UI claim "no address returned" while
      // the server had sent a perfectly good one. June 21's root cause hinged on
      // an incomplete address, so this is the last field we can afford to drop.
      address: env.address ?? linked[0]?.address ?? siblings[0]?.address ?? null,
      bookings: linked,
      batchSiblings: siblings,
      unresolvedOrderIds,
    },
  };
}

// ── Meta ─────────────────────────────────────────────────────────────────────

/**
 * GET /incidents/meta — the server's enum vocabulary.
 *
 * Drives the category chips, severity tiles and status/vendor filters, so the
 * frontend's idea of "what categories exist" cannot drift from the backend's.
 *
 * Tolerant on the way in: each group is accepted either as a bare `string[]` or
 * as `{ value, label }[]`, because the exact serialisation was not verifiable
 * against dev at the time this was wired. Anything unrecognised falls back to
 * that group's local constant rather than rendering an empty picker — a meta
 * response we don't understand must not silently produce a form with no
 * categories in it.
 */
export async function getIncidentMeta(): Promise<IncidentMeta> {
  const r = await api.get<Record<string, unknown>>("/incidents/meta");
  const raw = r.data ?? {};
  return {
    categories: metaGroup(raw.categories, FALLBACK_META.categories),
    severities: metaGroup(raw.severities, FALLBACK_META.severities),
    statuses: metaGroup(raw.statuses, FALLBACK_META.statuses),
    vendors: metaGroup(raw.vendors, FALLBACK_META.vendors),
  };
}

function metaGroup<T extends string>(raw: unknown, fallback: MetaOption<T>[]): MetaOption<T>[] {
  if (!Array.isArray(raw) || raw.length === 0) return fallback;

  const localLabel = new Map(fallback.map((o) => [o.value as string, o.label]));
  const options: MetaOption<T>[] = [];

  for (const item of raw) {
    if (typeof item === "string") {
      options.push({ value: item as T, label: localLabel.get(item) ?? humanizeEnumValue(item) });
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as { value?: unknown; label?: unknown };
      if (typeof o.value === "string") {
        const label =
          typeof o.label === "string" && o.label !== ""
            ? o.label
            : localLabel.get(o.value) ?? humanizeEnumValue(o.value);
        options.push({ value: o.value as T, label });
      }
    }
  }

  return options.length > 0 ? options : fallback;
}

// ── Incidents ────────────────────────────────────────────────────────────────

/**
 * POST /incidents — the 60-second file. Server stamps filedBy + reportedAt from
 * the token. The request field is `orderIds` (responses call it
 * `affectedOrderIds`); `vendor` is always sent — see FileIncidentRequest.
 */
export async function fileIncident(body: FileIncidentRequest): Promise<IncidentDetail> {
  const r = await api.post<WireIncidentEnvelope>("/incidents", body);
  return normalizeDetail(r.data);
}

/**
 * POST /incidents/draft — the AI drafts the judgement fields from a paragraph.
 *
 * Additive and non-committal: this only pre-fills the file form for review. It
 * NEVER files anything (that stays the existing POST /incidents, unchanged), and
 * it NEVER returns order IDs or an owner — those stay human. On AI failure the
 * server returns 503; the caller must fall back to the empty file form rather
 * than block filing. severity/category/vendor come back as valid enum values
 * (server-enforced), so no normalisation is needed here.
 */
export async function draftIncident(text: string): Promise<IncidentDraft> {
  const r = await api.post<IncidentDraft>("/incidents/draft", { text });
  return r.data;
}

/** GET /incidents — list + filters, paginated. Default view is everything not CLOSED. */
export async function listIncidents(params: IncidentListParams): Promise<IncidentListResponse> {
  const r = await api.get<{ total?: number; incidents?: WireIncident[] }>(
    `/incidents?${toQuery(params)}`
  );
  const rows = r.data?.incidents ?? [];
  return {
    incidents: rows.map(normalizeSummary),
    total: r.data?.total ?? rows.length,
  };
}

/** GET /incidents/:id — detail, incl. resolved booking/customer/phlebo/payment-batch siblings + timeline. */
export async function getIncident(id: string): Promise<IncidentDetail> {
  const r = await api.get<WireIncidentEnvelope>(`/incidents/${id}`);
  return normalizeDetail(r.data);
}

/** PATCH /incidents/:id — status, owner, severity (server preserves originalSeverity), RCA fields. */
export async function updateIncident(id: string, body: UpdateIncidentRequest): Promise<IncidentDetail> {
  const r = await api.patch<WireIncidentEnvelope>(`/incidents/${id}`, body);
  return normalizeDetail(r.data);
}

// ── Timeline (append-only — no update, no delete, by design) ──────────────────

/**
 * POST /incidents/:id/timeline — append an update.
 *
 * Sent as multipart when there are image attachments (the WhatsApp screenshots
 * ARE the evidence), plain JSON otherwise. `at` is back-datable; omitting it
 * lets the server stamp now().
 */
export async function addTimelineEntry(
  id: string,
  body: AddTimelineEntryRequest,
  images: File[] = []
): Promise<IncidentDetail> {
  if (images.length === 0) {
    await api.post(`/incidents/${id}/timeline`, body);
  } else {
    const form = new FormData();
    form.append("body", body.body);
    if (body.at) form.append("at", body.at);
    for (const img of images) form.append("attachments", img);
    // Do NOT set Content-Type — axios sets the multipart boundary itself.
    await api.post(`/incidents/${id}/timeline`, form);
  }
  // This POST returns the appended ENTRY, not the whole incident. The caller
  // re-renders from a full detail, so read it back rather than trying to splice
  // the new entry into local state and hoping the two agree.
  return getIncident(id);
}

/**
 * GET /incidents/attachments/:id — an attachment's bytes.
 *
 * ⚠️ This endpoint is ADMIN-AUTHENTICATED. It cannot be used as an image `src`.
 * The browser does not attach the Authorization header to an <img> request, so
 * `<img src="…/incidents/attachments/:id">` returns 401 and renders as a broken
 * image. The bytes MUST come through the axios client, which the request
 * interceptor in lib/api.ts decorates with the bearer token.
 *
 * Returns the raw Blob rather than an object URL: whoever creates the object URL
 * must also revoke it, and pushing that decision to the caller keeps the
 * create/revoke pair in one place (see useAttachmentUrl in components/
 * AttachmentThumb.tsx) instead of leaking one URL per render.
 */
export async function fetchAttachmentBlob(attachmentId: string): Promise<Blob> {
  const r = await api.get(`/incidents/attachments/${attachmentId}`, { responseType: "blob" });
  return r.data as Blob;
}

// ── Action items (owner + due date both required) ─────────────────────────────

/** POST /incidents/:id/actions — ownerAdminId required, ownerVendor optional. */
export async function createActionItem(id: string, body: CreateActionItemRequest): Promise<IncidentDetail> {
  await api.post(`/incidents/${id}/actions`, body);
  // The mutation's own response shape isn't pinned down, and the caller wants the
  // whole incident back to re-render from. Re-reading the detail is one extra
  // round trip and removes a guess.
  return getIncident(id);
}

/** PATCH /incidents/:id/actions/:actionId */
export async function updateActionItem(
  id: string,
  actionId: string,
  body: UpdateActionItemRequest
): Promise<IncidentDetail> {
  await api.patch(`/incidents/${id}/actions/${actionId}`, body);
  return getIncident(id);
}

/** GET /incidents/actions/open — cross-incident open action items, with overdue flags. */
export async function listOpenActions(): Promise<OpenActionsResponse> {
  const r = await api.get<OpenActionsResponse>("/incidents/actions/open");
  return r.data;
}

/**
 * GET /incidents/rca-owed — the incidents whose cause is still unwritten.
 *
 * The server owns the definition of "owed". The badge reads `count` from here
 * rather than re-deriving it from a filtered /incidents query, so the number on
 * the badge and the rule the RCA-overdue email nudge fires on cannot disagree.
 */
export async function getRcaOwed(): Promise<RcaOwedResponse> {
  const r = await api.get<RcaOwedResponse>("/incidents/rca-owed");
  return r.data;
}

/** GET /incidents/stats — counts by category × severity × vendor × month. */
export async function getIncidentStats(params: {
  from?: string;
  to?: string;
} = {}): Promise<IncidentStatsResponse> {
  const r = await api.get<IncidentStatsResponse>(`/incidents/stats?${toQuery(params)}`);
  return r.data;
}

// ── Existing endpoints this module reads from ────────────────────────────────
// These two already exist and work today. They live here so that ALL axios in
// the incidents module stays in one file.

/** GET /auth/admins — for the action-item owner picker. Existing endpoint (see app/admins). */
export async function listAdmins(): Promise<Array<{ id: string; name: string; email: string; role: string }>> {
  const r = await api.get<{ admins: Array<{ id: string; name: string; email: string; role: string }> }>(
    "/auth/admins"
  );
  return r.data.admins ?? [];
}

/**
 * GET /bookings — feeds the client-derived Suspected Incidents panel.
 * Existing endpoint; this is the ONE part of the incidents module that works
 * with zero new backend.
 */
export async function fetchBookingsForSuspicion(params: {
  appointmentFrom: string; // YYYY-MM-DD
  appointmentTo: string; // YYYY-MM-DD
  limit?: number;
}): Promise<Booking[]> {
  const r = await api.get(`/bookings?${toQuery(params)}`);
  return normalizeBookings(r.data.bookings);
}

/**
 * GET /bookings — feeds the searchable order-ID multi-select on the file form.
 *
 * There is NO server-side order search, so we fetch a wide window of bookings and
 * filter to those that carry a thyrocareOrderId client-side (that is the only
 * thing an incident can be linked to). Reuses the same /bookings + normalizeBookings
 * pattern as fetchBookingsForSuspicion, just over a wider date window and capped
 * at the widest page the list supports.
 */
export async function listBookingsForPicker(): Promise<PickerBooking[]> {
  const today = new Date();
  const r = await api.get(
    `/bookings?${toQuery({
      appointmentFrom: localDateNDaysFrom(today, -180),
      appointmentTo: localDateNDaysFrom(today, 30),
      limit: 500,
    })}`
  );
  const picker: PickerBooking[] = [];
  for (const b of normalizeBookings(r.data.bookings)) {
    if (b.thyrocareOrderId) {
      picker.push({
        orderId: b.thyrocareOrderId,
        patientName: b.patientName,
        appointmentDate: b.appointmentDate,
        bookingId: b.id,
      });
    }
  }
  return picker;
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
 * A 400 is surfaced VERBATIM from the server. That is deliberate and it matters:
 * closing an incident with no contributing factor is a hard 400 whose body
 * explains exactly why, and paraphrasing it into "check the fields" would throw
 * away the only explanation the operator gets. The UI tries to make that 400
 * unreachable (the Close button is disabled until a cause exists), but if the
 * server refuses anyway, the server's reason wins.
 */
export function incidentErrorMessage(err: unknown): string {
  const e = err as {
    code?: string;
    message?: string;
    response?: { status?: number; data?: { message?: string | string[]; error?: string } };
  };
  const status = e?.response?.status;
  const rawBody = e?.response?.data?.message ?? e?.response?.data?.error;
  // Nest's ValidationPipe returns `message` as an array of strings.
  const fromBody = Array.isArray(rawBody) ? rawBody.join(" ") : rawBody;

  if (status === 404) {
    return "Not found — it may have been removed, or the link is stale.";
  }
  if (status === 403) {
    return "You don't have permission to do that.";
  }
  if (status === 413) {
    return fromBody ?? "That file is too large. Images are capped at 5 MB each.";
  }
  if (status === 415 || status === 422) {
    return fromBody ?? "The server rejected that file. Only PNG, JPEG and WebP images are accepted.";
  }
  if (status === 400) {
    return fromBody ?? "The server rejected that — check the fields and try again.";
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
