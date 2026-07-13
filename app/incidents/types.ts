// ─────────────────────────────────────────────────────────────────────────────
// The Incident Log backend contract. THE ONLY PLACE these shapes are declared.
//
// Source of truth: docs/handoff-backend-incidents-and-calls.md, plus the
// additive changes the backend shipped on top of it (all additive — nothing was
// renamed):
//   - GET /incidents/meta      — the enum vocabulary, so the frontend's copy of
//                                it can never silently drift from the server's.
//   - GET /incidents/rca-owed  — the count behind the "RCA owed (N)" badge.
//   - Timeline attachments carry METADATA only; the bytes come from
//     GET /incidents/attachments/:id, which is admin-authenticated.
//
// Fields marked [INFERRED] are NOT literally spelled out in the handoff doc.
// They are the minimum the UI needs and the backend should confirm or correct
// them. Everything else is stated in the doc.
// ─────────────────────────────────────────────────────────────────────────────

// ── Enums (fixed vocabularies — handoff "Data model") ────────────────────────

// Harm-based ladder. Listed lowest-harm first: that is the order the file form
// presents them in, so the eye lands on S0 (near miss) rather than skipping it.
export const INCIDENT_SEVERITIES = ["S0", "S3", "S2", "S1"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  S0: "Near miss",
  S3: "Friction",
  S2: "Real harm",
  S1: "Danger",
};

export const SEVERITY_HINT: Record<IncidentSeverity, string> = {
  S0: "Caught before it reached the customer",
  S3: "Annoying, but nothing was lost",
  S2: "Real cost to the customer — fasted for nothing, took leave",
  S1: "Customer harmed, wrong result acted on, or data leaked",
};

// Fixed enum, required at file time. This is the field that makes
// "how many phlebo no-shows this quarter?" one query. Do not grow it casually.
export const INCIDENT_CATEGORIES = [
  "phlebo_no_show",
  "phlebo_late",
  "sample_issue",
  "wrong_test_or_panel",
  "result_delayed",
  "result_wrong",
  "booking_error",
  "address_or_dispatch",
  "billing_refund",
  "app_or_backend",
  "other",
] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<IncidentCategory, string> = {
  phlebo_no_show: "Phlebo no-show",
  phlebo_late: "Phlebo late",
  sample_issue: "Sample issue",
  wrong_test_or_panel: "Wrong test / panel",
  result_delayed: "Result delayed",
  result_wrong: "Result wrong",
  booking_error: "Booking error",
  address_or_dispatch: "Address / dispatch",
  billing_refund: "Billing / refund",
  app_or_backend: "App / backend",
  other: "Other",
};

export const INCIDENT_VENDORS = ["thyrocare", "internal", "none"] as const;
export type IncidentVendor = (typeof INCIDENT_VENDORS)[number];

export const VENDOR_LABEL: Record<IncidentVendor, string> = {
  thyrocare: "Thyrocare",
  internal: "Internal (us)",
  none: "No vendor",
};

// OPEN → RESOLVED → CLOSED. RESOLVED and CLOSED are deliberately distinct:
// RESOLVED = the customer is whole again but the RCA is still owed.
export const INCIDENT_STATUSES = ["OPEN", "RESOLVED", "CLOSED"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const STATUS_LABEL: Record<IncidentStatus, string> = {
  OPEN: "Open",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

// Severities that create an RCA obligation on entering RESOLVED.
export const RCA_REQUIRED_SEVERITIES: readonly IncidentSeverity[] = ["S1", "S2"];

/**
 * Label for an enum value that may have come from the server's vocabulary rather
 * than ours. If the backend adds a category we don't know about yet, this renders
 * "Sample Mislabelled" instead of `undefined` — the UI degrades to readable, never
 * to blank.
 */
export function enumLabel(map: Record<string, string>, value: string): string {
  return map[value] ?? humanizeEnumValue(value);
}

/** "phlebo_no_show" → "Phlebo no show". */
export function humanizeEnumValue(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ── Shared sub-shapes ────────────────────────────────────────────────────────

/** Admin attribution. Attribution, never authorization — everything is team-visible. */
export interface AdminRef {
  id: string;
  name: string;
  email: string;
}

export interface IncidentAddress {
  addressLine1: string | null;
  addressLine2: string | null;
  landmark: string | null;
  city: string | null;
  state: string | null;
  pincode: number | null;
}

/** A booking resolved from an order ID, or pulled in as a payment-batch sibling. */
export interface IncidentBooking {
  id: string;
  thyrocareOrderId: string | null;
  thyrocareLeadId: string | null;
  patientName: string | null;
  testType: string | null;
  appointmentDate: string | null; // YYYY-MM-DD
  appointmentTime: string | null; // "07:20"
  status: string | null;
  amount: number | null; // paise
  paymentBatchId: string | null;
  phleboName: string | null;
  phleboPhone: string | null;
}

export interface IncidentCustomer {
  id: string;
  name: string | null;
  whatsappPhone: string | null;
  email: string | null;
}

/**
 * Server-resolved context. The operator types ONE order ID; the backend expands
 * it into the customer, slot, phlebo, address and — critically — every sibling
 * order sharing the same paymentBatchId, so "6 orders / 18 vials" shows up as
 * one event instead of six unrelated ones.
 */
export interface IncidentContext {
  customer: IncidentCustomer | null;
  address: IncidentAddress | null;
  /** Bookings resolved from affectedOrderIds. */
  bookings: IncidentBooking[];
  /** Every order in the same payment batch, including the ones above. */
  batchSiblings: IncidentBooking[];
  /** Order IDs that matched no booking. Must fail loudly, not store a dangling string. */
  unresolvedOrderIds: string[]; // [INFERRED]
}

/** Append-only. Never edited, never deleted — that is what makes it evidence. */
export interface TimelineEntry {
  id: string;
  /** Back-datable — people paste yesterday's thread today. */
  at: string; // ISO
  body: string;
  admin: AdminRef | null;
  attachments: TimelineAttachment[];
  createdAt: string; // ISO — when it was actually written (≠ `at`)
}

/**
 * Round 2 (R1): attachment bytes live in Postgres as `bytea` and are served by a
 * dedicated ADMIN-AUTHENTICATED endpoint — not a public S3 URL.
 *
 * What ships here is METADATA ONLY. There is no `url`, and there deliberately
 * isn't one: the bytes come from `GET /incidents/attachments/:id`, which requires
 * the bearer token. A plain <img src="…/attachments/:id"> cannot work — the
 * browser does not attach the Authorization header to an image request, so it
 * would 401 and render as a broken image. Fetch through the axios client with
 * `responseType: 'blob'` (see fetchAttachmentBlob in api.ts).
 */
export interface TimelineAttachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string; // ISO
}

/**
 * Round 2 (R1): allowlist only. PNG / JPEG / WebP.
 *
 * GIF is not allowed and SVG is not allowed. SVG especially: it is an image to
 * the user and an executable script to the browser, and we would be serving it
 * from our own origin to an authenticated admin (stored XSS → admin compromise).
 *
 * The SERVER is the real gate — it sniffs the magic bytes and ignores both the
 * filename and the client-declared Content-Type, because both are attacker
 * controlled. The client-side check below is a UX courtesy so the operator is
 * told immediately instead of after a failed upload. It is NOT a security
 * control and must never be described as one.
 */
export const ALLOWED_ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** The `accept` attribute for the file input. Same list as above. */
export const ATTACHMENT_ACCEPT = ALLOWED_ATTACHMENT_TYPES.join(",");

/** ~5 MB per image. Enforced server-side too — this is the fail-fast copy. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/**
 * Owner and due date are BOTH required — an action item without an owner is not
 * an action item.
 *
 * Round 2 (R2): `ownerAdminId` is ALWAYS required and is the internal person who
 * chases the action. `ownerVendor` is optional and records who *owes* the
 * deliverable. A vendor is never the sole owner — June 21 failed precisely
 * because the RCA's only owner was Thyrocare and nobody internal owned chasing it.
 */
export interface IncidentActionItem {
  id: string;
  description: string;
  /** REQUIRED — the internal admin who chases this. Never null. */
  ownerAdminId: string;
  /** Optional — the vendor who owes the deliverable. Does NOT replace the internal owner. */
  ownerVendor: IncidentVendor | null;
  /** Display name of the internal owner. [INFERRED] */
  ownerLabel: string;
  dueDate: string; // YYYY-MM-DD
  doneAt: string | null; // ISO
  /** Server-computed: dueDate in the past and not done. [INFERRED] */
  overdue: boolean;
}

// ── Incident ─────────────────────────────────────────────────────────────────

/**
 * List-row shape — the UI's flat view of an incident.
 *
 * ⚠️ This is NOT the wire shape. The server nests the incident's own fields under
 * `.incident` and hangs customers / bookings / timeline / paymentBatchIds off the
 * envelope as SIBLINGS. api.ts flattens that on the way in, so components never
 * see the envelope. See WireIncident / WireIncidentEnvelope below.
 */
export interface IncidentSummary {
  id: string;
  /** Human-readable, e.g. "INC-2026-014". Operators quote this to the vendor. */
  ref: string;
  title: string;
  severity: IncidentSeverity;
  /** Shadow field, set once. Drift from `severity` tells us if we under-call. */
  originalSeverity: IncidentSeverity;
  /** Server-computed: severity was changed after filing. */
  severityReassigned: boolean;
  status: IncidentStatus;
  category: IncidentCategory;
  vendor: IncidentVendor;
  occurredAt: string; // ISO — manual, back-datable
  reportedAt: string; // ISO — auto. The gap from occurredAt is our detection latency.
  resolvedAt: string | null;
  closedAt: string | null;
  /** RESPONSE field name. The CREATE REQUEST calls the same thing `orderIds`. */
  affectedOrderIds: string[];
  filedBy: AdminRef | null; // null when filed via the legacy static ADMIN_TOKEN path
  owner: AdminRef | null;
  customerName: string | null;
  /** Server-computed: this severity owes an RCA. */
  rcaRequired: boolean;
  /** Server-computed: the RCA obligation exists and its due date has passed. */
  rcaOverdue: boolean;
  rcaDueAt: string | null;
  /** Server-computed gap between occurredAt and reportedAt — our detection latency. */
  detectionLatencyMinutes: number | null;
  /**
   * DERIVED IN api.ts, not sent by the server: an RCA is required, the incident
   * isn't closed, and no contributing factor has been written yet. The top-strip
   * count comes from GET /incidents/rca-owed (which owns the real definition);
   * this is only the per-row badge.
   */
  rcaOwed: boolean;
}

/** Detail shape — everything on the summary plus the enrichment and the RCA. */
export interface IncidentDetail extends IncidentSummary {
  /** Free text, LONG. Operators paste whole WhatsApp threads. Never capped at 255. */
  whatHappened: string;
  whatWentWell: string | null;
  slaBreached: boolean;
  /** Which SLA — e.g. "collection within the booked 60-min slot". */
  slaDetail: string | null; // [INFERRED name]
  /** What the vendor promised, and by when. */
  vendorCommitment: string | null;
  tags: string[];
  /** PLURAL, deliberately. June 21 had at least three. Not "root cause". */
  contributingFactors: string[];
  actionItems: IncidentActionItem[];
  timeline: TimelineEntry[];
  /** Assembled in api.ts from the envelope's customers/bookings/paymentBatchIds. */
  context: IncidentContext;
}

// ── Wire shapes (what the server actually sends) ──────────────────────────────
//
// Kept separate from the UI shapes above ON PURPOSE. The server's envelope is
// nested and its create request is named asymmetrically from its responses; both
// facts are absorbed by the normalisers in api.ts so that exactly one file has to
// know about them.

/** The incident's own fields — everything under `.incident`. */
export interface WireIncident {
  id: string;
  ref: string;
  title: string;
  severity: IncidentSeverity;
  originalSeverity?: IncidentSeverity;
  severityReassigned?: boolean;
  status: IncidentStatus;
  category: IncidentCategory;
  vendor: IncidentVendor;
  occurredAt: string;
  reportedAt: string;
  resolvedAt?: string | null;
  closedAt?: string | null;
  affectedOrderIds?: string[];
  filedBy?: AdminRef | null;
  owner?: AdminRef | null;
  whatHappened?: string;
  whatWentWell?: string | null;
  slaBreached?: boolean;
  slaDetail?: string | null;
  vendorCommitment?: string | null;
  tags?: string[];
  contributingFactors?: string[];
  actionItems?: IncidentActionItem[];
  rcaRequired?: boolean;
  rcaOverdue?: boolean;
  rcaDueAt?: string | null;
  detectionLatencyMinutes?: number | null;
  customerName?: string | null;
  /** Prisma relation counts on list rows. */
  _count?: Record<string, number>;
}

/**
 * The create/detail envelope. The incident is under `.incident`; the resolved
 * context and the timeline are SIBLINGS of it, not inside it.
 */
export interface WireIncidentEnvelope {
  incident: WireIncident;
  customers?: IncidentCustomer[];
  bookings?: IncidentBooking[];
  paymentBatchIds?: string[];
  timeline?: TimelineEntry[];
  actionItems?: IncidentActionItem[];
  address?: IncidentAddress | null;
}

// ── Request payloads ─────────────────────────────────────────────────────────

/**
 * The 60-second file.
 *
 * ⚠️ The order IDs are called `orderIds` HERE, in the request — even though every
 * response calls the same thing `affectedOrderIds`. That asymmetry is the live
 * contract, verified against dev. Do not "tidy" either name to match the other.
 *
 * `filedBy` / `reportedAt` are stamped server-side from the bearer token — the
 * client has no access to the admin's ID and must never send them.
 */
export interface FileIncidentRequest {
  title: string;
  severity: IncidentSeverity;
  category: IncidentCategory;
  occurredAt: string; // ISO — back-datable
  whatHappened: string;
  orderIds: string[];
  /**
   * ALWAYS SENT, never omitted. The server defaults an absent vendor to "none",
   * and an incident filed as "none" is invisible to the Thyrocare scorecard — the
   * single artefact this whole system exists to produce. INC-2026-001 (June 21,
   * the motivating incident) is already on dev with vendor:"none" for exactly this
   * reason. The file form pre-selects it from the category so it costs no typing.
   */
  vendor: IncidentVendor;
}

/**
 * Which vendor a category implies. Pre-selects the vendor control in the file
 * form so the operator never has to think about it — they can still override it
 * in one tap, and the override is what gets sent.
 *
 * Categories that map to "none" are genuinely ambiguous (a dispatch failure or a
 * wrong panel could be either side's fault), so they stay user-selectable rather
 * than guessing and being confidently wrong.
 */
export const VENDOR_BY_CATEGORY: Record<IncidentCategory, IncidentVendor> = {
  phlebo_no_show: "thyrocare",
  phlebo_late: "thyrocare",
  sample_issue: "thyrocare",
  result_delayed: "thyrocare",
  result_wrong: "thyrocare",
  booking_error: "internal",
  app_or_backend: "internal",
  billing_refund: "internal",
  address_or_dispatch: "none",
  wrong_test_or_panel: "none",
  other: "none",
};

/** The vendor a category implies, or "none" for a category we don't know. */
export function suggestVendor(category: IncidentCategory | null): IncidentVendor {
  if (!category) return "none";
  return (VENDOR_BY_CATEGORY as Record<string, IncidentVendor>)[category] ?? "none";
}

/** Short labels for the one-tap vendor control. "Who does this land on?" */
export const VENDOR_SHORT_LABEL: Record<IncidentVendor, string> = {
  thyrocare: "Thyrocare",
  internal: "Us",
  none: "Neither",
};

/** Everything here is optional — enrichment, done later from a laptop. */
export interface UpdateIncidentRequest {
  title?: string;
  status?: IncidentStatus;
  severity?: IncidentSeverity; // server preserves originalSeverity
  category?: IncidentCategory;
  vendor?: IncidentVendor;
  ownerAdminId?: string | null;
  whatHappened?: string;
  whatWentWell?: string | null;
  slaBreached?: boolean;
  slaDetail?: string | null;
  vendorCommitment?: string | null;
  contributingFactors?: string[];
  tags?: string[];
  affectedOrderIds?: string[];
}

export interface AddTimelineEntryRequest {
  body: string;
  /** Back-datable. Omit to let the server stamp now(). */
  at?: string; // ISO
}

export interface CreateActionItemRequest {
  description: string;
  /** REQUIRED (Round 2 R2) — the internal admin who chases this. */
  ownerAdminId: string;
  /** Optional — the vendor who owes the deliverable. Never a substitute for the internal owner. */
  ownerVendor?: IncidentVendor;
  dueDate: string; // YYYY-MM-DD — REQUIRED
}

export interface UpdateActionItemRequest {
  description?: string;
  ownerAdminId?: string;
  ownerVendor?: IncidentVendor | null;
  dueDate?: string;
  /** ISO to mark done, null to re-open. */
  doneAt?: string | null;
}

// ── Query params ─────────────────────────────────────────────────────────────

/**
 * VERIFIED against the live dev backend on 2026-07-13 — every key below returned
 * 200; anything absent returned 400. The list schema is STRICT: an unrecognised
 * key is a hard 400, not an ignored param, so a hopeful guess doesn't degrade —
 * it takes the whole list down. (An earlier version of this file guessed
 * `excludeClosed`, `occurredFrom`, `occurredTo` and `rcaOwed`; all four 400'd and
 * the incidents list rendered permanently empty. Do not add a key here without
 * curling it first.)
 *
 * Note what is NOT here: there is no way to ask for "everything except CLOSED".
 * `status` takes a single value only. See the comment in page.tsx.
 */
export interface IncidentListParams {
  severity?: IncidentSeverity;
  category?: IncidentCategory;
  vendor?: IncidentVendor;
  /** Single value only — the backend rejects a comma-separated list. */
  status?: IncidentStatus;
  /** ISO dates (YYYY-MM-DD), filtering on occurredAt. */
  from?: string;
  to?: string;
  /** Thyrocare order id, e.g. "VL8E1FF6". (`customerId` is NOT supported — 400.) */
  orderId?: string;
  limit?: number;
  offset?: number;
}

// ── Responses ────────────────────────────────────────────────────────────────

export interface IncidentListResponse {
  incidents: IncidentSummary[];
  total: number;
}

/** Cross-incident open action items. The screen that turns a diary into an operating system. */
export interface OpenActionItem extends IncidentActionItem {
  incidentId: string;
  incidentRef: string;
  incidentTitle: string;
}

export interface OpenActionsResponse {
  actions: OpenActionItem[];
  total: number;
}

/** Counts by category × severity × vendor × month. Powers the CEO's question + the vendor scorecard. */
export interface IncidentStatsBucket {
  month: string; // YYYY-MM
  vendor: IncidentVendor;
  category: IncidentCategory;
  severity: IncidentSeverity;
  count: number;
}

export interface IncidentStatsResponse {
  buckets: IncidentStatsBucket[];
}

// ── Meta (GET /incidents/meta) ───────────────────────────────────────────────
//
// The server owns the vocabulary. We fetch it and drive the category chips,
// severity tiles and status/vendor filters from it, so that adding a category
// backend-side does not require a frontend release and — more importantly — so
// the two lists can never silently disagree about what a category *is*.
//
// The local constants above remain the compile-time source of truth (house style
// per the handoff: a TS enum, never raw strings) AND the offline fallback. If
// /incidents/meta fails, the file form must still work — a broken meta call must
// not take incident filing down with it.

export interface MetaOption<T extends string = string> {
  value: T;
  label: string;
}

export interface IncidentMeta {
  categories: MetaOption<IncidentCategory>[];
  severities: MetaOption<IncidentSeverity>[];
  statuses: MetaOption<IncidentStatus>[];
  vendors: MetaOption<IncidentVendor>[];
}

/** Used verbatim when /incidents/meta is unreachable. */
export const FALLBACK_META: IncidentMeta = {
  categories: INCIDENT_CATEGORIES.map((value) => ({ value, label: CATEGORY_LABEL[value] })),
  severities: INCIDENT_SEVERITIES.map((value) => ({ value, label: SEVERITY_LABEL[value] })),
  statuses: INCIDENT_STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] })),
  vendors: INCIDENT_VENDORS.map((value) => ({ value, label: VENDOR_LABEL[value] })),
};

// ── RCA owed (GET /incidents/rca-owed) ───────────────────────────────────────

/**
 * Powers the "RCA owed (N)" badge. Previously the list page derived this by
 * re-querying /incidents with `rcaOwed=true&limit=1` and reading `total` — which
 * meant the badge's definition of "owed" lived in the frontend's filter params.
 * It now comes from the endpoint that owns the definition.
 */
export interface RcaOwedResponse {
  count: number;
  incidents: IncidentSummary[];
}

// ── Suspected incidents (client-derived — NOT a backend shape) ────────────────
//
// These are NOT records. They are a read-only view derived on the client from
// the EXISTING /bookings API, so the panel works today with zero backend. It is
// the one part of this module that does not need the incident API at all.

export const SUSPICION_KINDS = ["possible_no_show", "cancelled_by_vendor", "refund_issued"] as const;
export type SuspicionKind = (typeof SUSPICION_KINDS)[number];

export interface SuspectedIncident {
  /** Booking id — stable, used as the dismiss key. */
  bookingId: string;
  kind: SuspicionKind;
  /** Plain-language statement of what we detected. */
  detected: string;
  customerName: string;
  orderId: string | null;
  /** The appointment slot this is about. */
  appointmentDate: string; // YYYY-MM-DD
  appointmentTime: string; // "07:20"
  /** Prefill for the file form. */
  suggestedCategory: IncidentCategory;
  suggestedSeverity: IncidentSeverity;
  suggestedWhatHappened: string;
}
