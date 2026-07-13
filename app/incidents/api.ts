// ─────────────────────────────────────────────────────────────────────────────
// Every network call the Incident Log makes. THE ONLY PLACE axios is touched in
// this module — components import functions from here, never `@/lib/api`.
//
// The incidents backend DOES NOT EXIST YET (being built in parallel to
// docs/handoff-backend-incidents-and-calls.md). Until it lands, every function
// below will reject — the UI is written to show a real error state, not a stub.
// Nothing here is mocked, and nothing is persisted client-side.
//
// Base URL already carries `/api/v1/admin` (see lib/api.ts), so paths are
// relative to that, matching the handoff's @Controller('api/v1/admin/incidents').
// ─────────────────────────────────────────────────────────────────────────────

import api from "@/lib/api";
import type {
  AddTimelineEntryRequest,
  CreateActionItemRequest,
  FileIncidentRequest,
  IncidentDetail,
  IncidentListParams,
  IncidentListResponse,
  IncidentStatsResponse,
  IncidentSummary,
  OpenActionsResponse,
  UpdateActionItemRequest,
  UpdateIncidentRequest,
} from "./types";
import type { Booking } from "@/app/bookings/lib/types";
import { normalizeBookings } from "@/app/bookings/lib/normalizeBooking";

// ── Incidents ────────────────────────────────────────────────────────────────

/** POST /incidents — the 60-second file. Server stamps filedBy + reportedAt from the token. */
export async function fileIncident(body: FileIncidentRequest): Promise<IncidentSummary> {
  const r = await api.post<IncidentSummary>("/incidents", body);
  return r.data;
}

/** GET /incidents — list + filters, paginated. Default view is everything not CLOSED. */
export async function listIncidents(params: IncidentListParams): Promise<IncidentListResponse> {
  const r = await api.get<IncidentListResponse>(`/incidents?${toQuery(params)}`);
  return r.data;
}

/** GET /incidents/:id — detail, incl. resolved booking/customer/phlebo/payment-batch siblings + timeline. */
export async function getIncident(id: string): Promise<IncidentDetail> {
  const r = await api.get<IncidentDetail>(`/incidents/${id}`);
  return r.data;
}

/** PATCH /incidents/:id — status, owner, severity (server preserves originalSeverity), RCA fields. */
export async function updateIncident(id: string, body: UpdateIncidentRequest): Promise<IncidentDetail> {
  const r = await api.patch<IncidentDetail>(`/incidents/${id}`, body);
  return r.data;
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
    const r = await api.post<IncidentDetail>(`/incidents/${id}/timeline`, body);
    return r.data;
  }
  const form = new FormData();
  form.append("body", body.body);
  if (body.at) form.append("at", body.at);
  for (const img of images) form.append("attachments", img);
  // Do NOT set Content-Type — axios sets the multipart boundary itself.
  const r = await api.post<IncidentDetail>(`/incidents/${id}/timeline`, form);
  return r.data;
}

/**
 * GET an attachment's bytes.
 *
 * Round 2 (R1): attachments are `bytea` in Postgres served by an admin-auth'd
 * endpoint, NOT a public URL — so they must be fetched through the axios client,
 * which attaches the bearer token. A plain <a href={url}> would hit the endpoint
 * unauthenticated and 401. The caller is responsible for revoking the object URL.
 */
export async function fetchAttachmentBlob(url: string): Promise<string> {
  const r = await api.get(url, { responseType: "blob" });
  return URL.createObjectURL(r.data as Blob);
}

// ── Action items (owner + due date both required) ─────────────────────────────

/** POST /incidents/:id/actions */
export async function createActionItem(id: string, body: CreateActionItemRequest): Promise<IncidentDetail> {
  const r = await api.post<IncidentDetail>(`/incidents/${id}/actions`, body);
  return r.data;
}

/** PATCH /incidents/:id/actions/:actionId */
export async function updateActionItem(
  id: string,
  actionId: string,
  body: UpdateActionItemRequest
): Promise<IncidentDetail> {
  const r = await api.patch<IncidentDetail>(`/incidents/${id}/actions/${actionId}`, body);
  return r.data;
}

/** GET /incidents/actions/open — cross-incident open action items, with overdue flags. */
export async function listOpenActions(): Promise<OpenActionsResponse> {
  const r = await api.get<OpenActionsResponse>("/incidents/actions/open");
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
 * Turn an axios failure into something an operator can act on. Distinguishes
 * "the endpoint isn't there" (which is the expected state until the backend
 * ships) from a genuine outage, so the UI never lies about why it's empty.
 */
export function incidentErrorMessage(err: unknown): string {
  const e = err as {
    code?: string;
    message?: string;
    response?: { status?: number; data?: { message?: string; error?: string } };
  };
  const status = e?.response?.status;
  const fromBody = e?.response?.data?.message ?? e?.response?.data?.error;

  if (status === 404) {
    return "The incidents API isn't available yet — the backend for this feature is still being built.";
  }
  if (status === 403) {
    return "You don't have permission to view incidents.";
  }
  if (status === 400 || status === 422) {
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
