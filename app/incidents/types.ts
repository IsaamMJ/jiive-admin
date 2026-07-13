// ─────────────────────────────────────────────────────────────────────────────
// The Incident Log backend contract. THE ONLY PLACE these shapes are declared.
//
// Source of truth: docs/handoff-backend-incidents-and-calls.md
// The backend does not exist yet — it is being built to this contract in
// parallel. When it lands, any field-name drift is a one-line fix HERE, not a
// hunt through components.
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

// Severities that create an RCA obligation on entering RESOLVED.
export const RCA_REQUIRED_SEVERITIES: readonly IncidentSeverity[] = ["S1", "S2"];

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
 * dedicated ADMIN-AUTHENTICATED endpoint — not a public S3 URL. So `url` must be
 * a path RELATIVE to the admin API base, fetched through the axios client so the
 * bearer token is attached. A bare <a href> would not authenticate. [Backend: confirm]
 */
export interface TimelineAttachment {
  id: string;
  /** Relative path, e.g. "/incidents/<id>/attachments/<attachmentId>". */
  url: string;
  filename: string | null;
  contentType: string | null;
}

/**
 * Round 2 (R1): allowlist only. SVG is deliberately excluded — it is an image to
 * the user and an executable script to the browser, and we would be serving it
 * from our own origin to an authenticated admin (stored XSS → admin compromise).
 * The server re-checks by sniffing the bytes; this client check just fails fast.
 */
export const ALLOWED_ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** ~5 MB per image, enforced server-side too. */
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

/** List-row shape. */
export interface IncidentSummary {
  id: string;
  /** Human-readable, e.g. "INC-2026-014". Operators quote this to the vendor. */
  ref: string;
  title: string;
  severity: IncidentSeverity;
  /** Shadow field, set once. Drift from `severity` tells us if we under-call. */
  originalSeverity: IncidentSeverity;
  status: IncidentStatus;
  category: IncidentCategory;
  vendor: IncidentVendor;
  occurredAt: string; // ISO — manual, back-datable
  reportedAt: string; // ISO — auto. The gap from occurredAt is our detection latency.
  resolvedAt: string | null;
  closedAt: string | null;
  affectedOrderIds: string[];
  filedBy: AdminRef | null; // null when filed via the legacy static ADMIN_TOKEN path
  owner: AdminRef | null;
  /** Customer name, for the list row. [INFERRED] */
  customerName: string | null;
  /** RESOLVED + S1/S2 + RCA not yet written. Powers the "RCA owed" badge. [INFERRED] */
  rcaOwed: boolean;
  /** Open (not-done) action items on this incident. [INFERRED] */
  openActionCount: number;
  /** Open action items past their due date. [INFERRED] */
  overdueActionCount: number;
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
  context: IncidentContext;
}

// ── Request payloads ─────────────────────────────────────────────────────────

/**
 * The 60-second file. EXACTLY these fields. `filedBy` / `reportedAt` are stamped
 * server-side from the bearer token — the client has no access to the admin's ID
 * and must never send them.
 */
export interface FileIncidentRequest {
  title: string;
  severity: IncidentSeverity;
  category: IncidentCategory;
  occurredAt: string; // ISO — back-datable
  whatHappened: string;
  affectedOrderIds: string[];
  /** Optional even at file time — defaults server-side. [INFERRED] */
  vendor?: IncidentVendor;
}

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

export interface IncidentListParams {
  severity?: IncidentSeverity;
  category?: IncidentCategory;
  vendor?: IncidentVendor;
  status?: IncidentStatus;
  /** Default view is "everything not CLOSED" — this is how we ask for it. [INFERRED] */
  excludeClosed?: boolean;
  /** ISO dates, filtering on occurredAt. */
  occurredFrom?: string;
  occurredTo?: string;
  customerId?: string;
  orderId?: string;
  /** Only incidents whose RCA is still owed. Powers the "RCA owed" badge. [INFERRED] */
  rcaOwed?: boolean;
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
