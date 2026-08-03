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

/**
 * One person on the order. A Thyrocare order can cover several people — each has
 * their own lead and their own report XML.
 *
 * `age` is the vendor's age, NEVER a DOB — and on a shared order the danger is
 * sharper than usual: VL21989C carries a 24-year-old and a 50-year-old, so
 * carrying the wrong row's details into the form is an easy mistake with a
 * clinical consequence.
 */
export interface OrphanPatient {
  leadId: string;
  name: string | null;
  age: number | null;
  gender: string | null;
  isReportAvailable: boolean;
  adopted: boolean;
  linkedBookingId: string | null;
}

export interface OrphanReport {
  eventId: string;
  orderId: string;
  /**
   * ⚠️ The lead the WEBHOOK carried — NOT necessarily anyone still waiting. On a
   * partially-adopted order it is usually the person already DONE (on VL21989C
   * it is Shahina, while Fareetha is the one still owed). NEVER adopt with this.
   * Adopt from `unadoptedPatients[].leadId`.
   */
  leadId: string | null;
  receivedAt: string;
  processed: boolean;
  error: string | null;
  retryCount: number;
  /**
   * How many people on this order still have no booking.
   * `null` means UNRESOLVED, not one and not zero — the roster is only fetched
   * for orders where someone has already been adopted, to keep this polled
   * endpoint cheap. Render null as "1+ waiting".
   */
  patientsWaiting?: number | null;
  multiPatient?: boolean;
  /** The people still owed a result. The ONLY safe source of a lead to adopt. */
  unadoptedPatients?: OrphanPatient[];
}

export interface OrphanReportList {
  /** Orders. Use peopleWaiting for anything operator-facing. */
  count?: number;
  /** People still owed results — the number that actually matters. */
  peopleWaiting?: number;
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
  /** Answers for the LEAD asked about, not the whole order. */
  alreadyLinked: boolean;
  patientCount?: number;
  multiPatient?: boolean;
  /** Every person on the order. Absent on older payloads — fall back to one. */
  patients?: OrphanPatient[];
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
  /**
   * Why the report couldn't be fetched. Present when reportAvailable is false.
   *
   * `ourSide` is the field that decides what the operator does next, so it leads
   * the UI: true = our request failed (e.g. the 10s timeout that stranded
   * VL0D0FDC — retry is worth it); false = Thyrocare answered and said no
   * (404 DATA_NOT_FOUND — retrying just repeats the same answer).
   */
  reportDiagnostic?: {
    step: string;
    kind: string;
    httpStatus?: number | null;
    vendorBody?: string | null;
    ourSide: boolean;
    retryable: boolean;
  } | null;
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
  /**
   * The real draw date, YYYY-MM-DD, from patientHint.collectionDate. Without it
   * the booking is dated today — which on the first live adopt fired a false
   * phlebo-no-show page, because a booking "today" with no phlebo looks abandoned.
   */
  collectionDate?: string;
  notify: boolean;
  dryRun: boolean;
}

/**
 * Vendor hint → the YYYY-MM-DD the server validates. Sliced, never parsed via
 * Date: the hint carries an IST offset ("2026-07-24T08:20:00+05:30") and letting
 * a UTC-based Date touch it can walk the draw date back a day.
 */
export function collectionDateFromHint(hint: string | null | undefined): string | undefined {
  if (!hint) return undefined;
  const ymd = hint.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : undefined;
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
  /**
   * Everyone on this order who STILL has no booking after this adopt. Empty on a
   * normal single-patient order. Non-empty means the job is NOT finished — the
   * operator has linked one person and someone else on the same order is still
   * waiting for results they paid for.
   */
  remainingPatients?: OrphanPatient[];
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

/**
 * What the backend will actually store for a typed phone.
 *
 * The server's normalizePhone() strips non-digits and NOTHING else — it does not
 * add a missing country code. WhatsApp always delivers `919843192228`, so a
 * number typed as bare `9843192228` becomes a SECOND account: her results land
 * on one, her WhatsApp conversation on the other, and duplicates are never
 * merged. She would never see her result.
 *
 * So we resolve to the canonical form here, show the operator exactly what will
 * be saved, and refuse anything that can't be resolved.
 */
export interface PhoneCheck {
  /** Digits only, as the backend would store it. */
  canonical: string;
  /** True when we supplied a missing 91 — must be surfaced, never silent. */
  addedCountryCode: boolean;
  ok: boolean;
  problem: string | null;
}

export function checkPhone(raw: string): PhoneCheck {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits === "") {
    return { canonical: "", addedCountryCode: false, ok: false, problem: null };
  }
  // A bare Indian mobile is 10 digits starting 6-9. Unambiguous, so we can add
  // the country code — but we say so on screen rather than doing it silently.
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return { canonical: `91${digits}`, addedCountryCode: true, ok: true, problem: null };
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    return { canonical: digits, addedCountryCode: false, ok: true, problem: null };
  }
  return {
    canonical: digits,
    addedCountryCode: false,
    ok: false,
    problem:
      "That doesn't look like an Indian mobile. Expected 10 digits, or 12 starting with 91 — anything else creates an account WhatsApp will never match.",
  };
}
