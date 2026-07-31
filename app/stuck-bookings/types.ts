export interface StuckBookingUser {
  whatsappPhone: string;
  name: string;
}

export interface StuckBookingAddress {
  pincode: number | string;
  city: string;
}

export interface StuckBooking {
  id: string;
  patientName: string;
  testType: string;
  status: string;                      // payment_completed | awaiting_reschedule_choice
  appointmentDate: string;             // ISO
  appointmentTime: string;             // "08:00"
  appointmentSlotId: string | null;
  paymentBatchId: string | null;       // null for single bookings
  thyrocareCreateAttempts: number;     // auto-retries burned (cap 6)
  lastOrderError: string | null;
  lastOrderErrorAt: string | null;
  amount: number;                      // paise
  createdAt: string;                   // ISO
  user: StuckBookingUser;
  address: StuckBookingAddress | null;
}

export interface StuckBookingsResponse {
  count: number;
  bookings: StuckBooking[];
}

export interface Slot {
  id: string;
  time: string;     // "08:20"
  label: string;    // "08:20 - 08:40"
  recommended?: boolean;
}

export interface SlotsResponse {
  pincode: number | string;
  date: string;
  slots: Slot[];
}

const RETRY_CAP = 6;

export interface WhyStuck {
  dotClass: string;
  label: string;
}

/** Map a persisted lastOrderError into an operator-facing reason + colour. */
export function whyStuck(err: string | null): WhyStuck {
  if (!err) return { dotClass: "bg-slate-400", label: "Not yet attempted" };
  if (/insufficient balance/i.test(err))
    return { dotClass: "bg-orange-500", label: "Wallet empty — top up, then Retry" };
  if (/slot is not available/i.test(err))
    return { dotClass: "bg-red-500", label: "Slot full — Reschedule" };
  if (/missing_address|missing_dob/i.test(err))
    return { dotClass: "bg-slate-300", label: "Missing data — fix profile" };
  return { dotClass: "bg-slate-400", label: err };
}

export { RETRY_CAP };

/** ISO date → "YYYY-MM-DD" without timezone drift (handoff dates are midnight-UTC). */
export const toYmd = (iso: string) => iso.slice(0, 10);

export const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// ─────────────────────────────────────────────────────────────────────────────
// Unlinked lab reports (orphan Thyrocare reports)
//
// A report is tied to a customer only through bookings.thyrocare_order_id. When
// an order is placed directly on the Thyrocare portal no booking row exists, so
// the arriving report has nothing to attach to and the customer never gets their
// result. The operator supplies the missing identity and the backend builds the
// rows + runs the real results pipeline.
//
// Endpoints (relative to the admin base, which already carries /api/v1/admin):
//   GET  /thyrocare/orphan-reports              — the list
//   GET  /thyrocare/orphan-reports/:orderId     — preflight (hits the vendor API)
//   POST /thyrocare/orphan-reports/:orderId/adopt
// ─────────────────────────────────────────────────────────────────────────────

export interface OrphanReport {
  eventId: string;
  orderId: string;
  /** Null on older payloads — the operator must then type it in. */
  leadId: string | null;
  receivedAt: string;
  processed: boolean;
  error: string | null;
  retryCount: number;
}

export interface OrphanReportList {
  count?: number;
  reports: OrphanReport[];
}

/**
 * What the vendor says about the patient. A CHECK for the operator to compare
 * against, NEVER a source of defaults — see ORPHAN_DOB_RULE.
 */
export interface OrphanPatientHint {
  name: string | null;
  /** Deliberately unused for prefill. An age cannot yield a DOB. */
  age: number | null;
  gender: string | null;
  city: string | null;
  state: string | null;
  pincode: number | null;
  collectionDate: string | null;
}

export interface OrphanPreflight {
  orderId: string;
  leadId: string | null;
  alreadyLinked: boolean;
  linkedBookingId: string | null;
  /** False = Thyrocare hasn't published the report yet. Normal early state, not an error. */
  reportAvailable: boolean;
  /** False = missing PhenoAge markers; adopting sends the customer an apology, not a result. */
  bioAgeReady: boolean;
  biomarkerCount: number;
  markersFound: string[];
  markersMissing: string[];
  patientHint: OrphanPatientHint;
  /** Vendor lookup failed — patientHint will be empty. Soft warning, not fatal. */
  vendorLookupError: string | null;
}

export type OrphanSubject = "self" | "family_member";

export interface OrphanAdoptRequest {
  leadId: string;
  phone: string;
  patientName: string;
  /** YYYY-MM-DD. Must be typed by a human — never derived from the age hint. */
  dob: string;
  gender: "male" | "female";
  subject: OrphanSubject;
  /** Required when subject === "family_member". */
  relationship?: string;
  city?: string;
  state?: string;
  pincode?: number;
  notify: boolean;
  dryRun: boolean;
}

export interface OrphanAdoptResponse {
  success: boolean;
  dryRun: boolean;
  orderId: string;
  leadId: string;
  userId: string | null;
  /**
   * Present even when success === false — meaning the link rows WERE written and
   * only the pipeline deferred. That case is not an operator-facing failure.
   */
  bookingId: string | null;
  patientId: string | null;
  /** True = an existing account was matched on the phone number. The danger case. */
  reusedExistingUser: boolean;
  existingUser?: { id?: string; name?: string | null; whatsappPhone?: string | null } | null;
  notified: boolean;
  resultId: string | null;
  pipelineError: string | null;
}

/**
 * The rule that matters most. Bio-age is computed FROM the date of birth, so a
 * DOB reverse-engineered from the vendor's "age: 34" can shift a customer's
 * reported biological age by up to a year. The backend refuses to guess; so does
 * the form. City/state/pincode are cosmetic and may be prefilled.
 */
export const ORPHAN_DOB_RULE =
  "Type the date of birth from a document the customer gave you. Never work it out from the age shown on the right — bio-age is calculated from the DOB, so a guessed year changes the customer's result.";

/**
 * `success: false` WITH a bookingId is a deferral, not a failure: the rows are
 * written, the order is linked, and reconciliation finishes it within ~30 min.
 * Re-posting adopt would 409 — so no red, and no retry button.
 */
export function isDeferredNotFailed(r: OrphanAdoptResponse): boolean {
  return !r.success && !!r.bookingId;
}
