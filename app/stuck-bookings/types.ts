export interface StuckBookingUser {
  whatsappPhone: string;
  name: string;
  /** ISO. Identity target when the booking has no patientId (booked for self). */
  dob: string | null;
  gender: string | null;
}

export interface StuckBookingAddress {
  id: string;
  houseNo: string | null;
  street: string;
  addressLine1: string;
  addressLine2: string;
  landmark: string | null;
  locality: string | null;
  city: string;
  state: string;
  pincode: number | string;
}

/** The FamilyMember row, when the booking was made for someone other than the account holder. */
export interface StuckBookingPatient {
  id: string;
  name: string;
  dob: string | null;   // ISO
  gender: string | null;
}

/** Live byte-budget read of the address as currently stored (before any edit). */
export interface AddressBudgetPreview {
  usedBytes: number;
  budgetBytes: number;
  compositeLength: number;
  trims: { kind: string }[];
  aboveCap: boolean;
  belowFloor: boolean;
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
  /** Non-null when the booking was placed for a family member, not the account holder. */
  patientId: string | null;
  /** Non-null means an order already exists — Fix & Retry must refuse (G3). */
  thyrocareOrderId: string | null;
  addressId: string;
  patient: StuckBookingPatient | null;
  /** Untrimmed customer address text (houseNo+street+addressLine1+landmark joined) — the field Fix & Retry edits. */
  addressText: string;
  addressBudget: AddressBudgetPreview | null;
}

/** Who a stuck booking's identity edits would target — mirrors the backend's own rule exactly. */
export function stuckBookingPatientTarget(b: StuckBooking): "account_holder" | "family_member" {
  return b.patientId ? "family_member" : "account_holder";
}

export function stuckBookingStoredDob(b: StuckBooking): string | null {
  const dob = b.patientId ? (b.patient?.dob ?? null) : b.user.dob;
  return dob ? toYmd(dob) : null;
}

export function stuckBookingStoredGender(b: StuckBooking): "male" | "female" | "" {
  const norm = stuckBookingStoredGenderRaw(b);
  return norm === "male" || norm === "female" ? norm : "";
}

/**
 * The trimmed/lowercased stored gender, WITHOUT collapsing an unrecognised
 * value (legacy data predating the male/female-only rule) to "". Mirrors the
 * backend's G7 check exactly (`!!storedGender && ... !== body.patientGender`)
 * — used only to detect "this would overwrite something", never for display.
 * `stuckBookingStoredGender` above is the one to prefill a male/female Select
 * with; using this one there would make an odd legacy value look unset.
 */
export function stuckBookingStoredGenderRaw(b: StuckBooking): string {
  const g = (b.patientId ? b.patient?.gender : b.user.gender) ?? "";
  return g.trim().toLowerCase();
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

// ─────────────────────────────────────────────────────────────────────────────
// Fix & Retry — POST /bookings/:id/fix-details
//
// The Khalam incident (2026-08-17): a paid booking's Thyrocare order was
// rejected ("address must be between 25 and 200 characters") and there was no
// way to edit it short of a raw SQL UPDATE against prod RDS. This is that fix.
//
// Only send fields the operator actually changed — the backend re-validates
// the address budget against the resolved city/state even when only the
// pincode changed, and a confirmIdentityOverwrite must accompany a dob/gender
// value that differs from what's already stored (G7).
// ─────────────────────────────────────────────────────────────────────────────

export interface FixDetailsRequest {
  address?: string;
  pincode?: string;
  patientName?: string;
  patientDob?: string;               // YYYY-MM-DD
  patientGender?: "male" | "female";
  confirmIdentityOverwrite?: boolean;
  /** Informed-consent escape for a genuine long full name the 6-word/60-char plausibility check rejects. */
  confirmNameOverride?: boolean;
}

export interface FixDetailsAddressResult {
  pincode: number;
  city: string;
  state: string;
  localityCleared: boolean;
  usedBytes: number;
  budgetBytes: number;
  compositeLength: number;
  trims: { kind: string }[];
}

export interface FixDetailsSuccess {
  success: true;
  bookingId: string;
  patientTarget: "account_holder" | "family_member";
  changed: string[];
  address?: FixDetailsAddressResult;
  attempts: { used: number; cap: number };
  warnings: string[];
  /** 'reschedule' after a pincode change — the old slot was chosen for the old area. */
  nextStep: "retry" | "reschedule";
  /**
   * Every booking that shares this booking's Address row (this one plus any
   * cart siblings) — non-empty only when the pincode changed. The Address
   * row is shared across a whole payment batch, so a pincode edit silently
   * moves every sibling's slot to the new area too; the console gates their
   * Retry button on this the same way it gates this booking's via nextStep.
   */
  affectedBookingIds?: string[];
}

/** A guard passed but a later write failed mid-flight (near-impossible under the placement lock). */
export interface FixDetailsPartial {
  success: false;
  partial: true;
  changed: string[];
  error: string;
}

/** A business refusal — HTTP 200, every message ends "Nothing was changed." */
export interface FixDetailsRefusal {
  error: string;
  orderId?: string;
}

export type FixDetailsResponse = FixDetailsSuccess | FixDetailsPartial | FixDetailsRefusal;

export function isFixDetailsSuccess(r: FixDetailsResponse): r is FixDetailsSuccess {
  return (r as FixDetailsSuccess).success === true;
}

export function isFixDetailsPartial(r: FixDetailsResponse): r is FixDetailsPartial {
  return (r as FixDetailsPartial).partial === true;
}

const RETRY_CAP = 6;

export interface WhyStuck {
  dotClass: string;
  label: string;
}

/**
 * Map a persisted lastOrderError into an operator-facing reason + colour.
 *
 * The transient branch shares VENDOR_TRANSIENT_SIGNAL with
 * classifyReportFetchFailure() on purpose. Order placement and report fetching
 * are different calls, but "Thyrocare's own server timed out" means the same
 * thing in both and must not get two different opinions in one codebase — that
 * split is exactly what produced the VLC5D31A bug documented further down.
 */
export function whyStuck(err: string | null): WhyStuck {
  if (!err) return { dotClass: "bg-slate-400", label: "Not yet attempted" };
  if (/insufficient balance/i.test(err))
    return { dotClass: "bg-orange-500", label: "Wallet empty — top up, then Retry" };
  if (/slot is not available/i.test(err))
    return { dotClass: "bg-red-500", label: "Slot full — Reschedule" };
  if (/missing_address|missing_dob/i.test(err))
    return { dotClass: "bg-slate-300", label: "Missing data — fix profile" };
  // Their side broke, transiently. Retry is the whole answer — say so, instead
  // of dropping a raw vendor stack-trace next to a neutral grey dot that reads
  // as "nothing to do here".
  if (looksLikeTransientVendorFailure(err))
    return { dotClass: "bg-amber-500", label: "Thyrocare's system timed out — Retry" };
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
   * NEVER read a field off this directly in the UI — run it through
   * classifyReportFetchFailure(). See the evidence block above that function.
   */
  reportDiagnostic?: OrphanReportDiagnostic | null;
}

/**
 * The backend's account of a failed report fetch.
 *
 * Read the field docs carefully — two of them have been misread in production:
 *
 * `ourSide` answers "WHOSE NETWORK LEG FAILED", and nothing else. It does NOT
 * answer "does this order exist". Reading it as the second question is the bug
 * fixed on 2026-08-05 (order VLC5D31A, below).
 *
 * `retryable` is the backend's advice, and it is currently wrong for the case
 * that matters — see the note in classifyReportFetchFailure().
 */
export interface OrphanReportDiagnostic {
  /** Which stage failed, e.g. "mint". */
  step: string;
  /** The backend's own label, e.g. "http_error" | "not_found" | "timeout". */
  kind: string;
  /** Thyrocare's HTTP status, when we got one at all. */
  httpStatus?: number | null;
  /** Our transport-level message, e.g. "Request failed with status code 500". */
  message?: string | null;
  /** Thyrocare's raw response body. A JSON *string* — often malformed. */
  vendorBody?: string | null;
  /** Whose leg failed. NOT "does this order exist". */
  ourSide: boolean;
  /** Advisory only. Demonstrably wrong for VLC5D31A — deliberately not trusted. */
  retryable: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Why the report couldn't be read — the classifier, and the bug it replaces
//
// LIVE EVIDENCE. Order VLC5D31A, patient "Juveira A H", 22, FEMALE, collected
// 2026-08-04. GET /thyrocare/orphan-reports/VLC5D31A returned, verbatim:
//
//   reportAvailable: false
//   reportDiagnostic: {
//     step: "mint", kind: "http_error", httpStatus: 500,
//     message: "Request failed with status code 500",
//     vendorBody: "{\"errors\":[{\"code\":\"SERVER_TIMEOUT\",\"message\":
//        \"EXECUTION TIMEOUT EXPIRED.  THE TIMEOUT PERIOD ELAPSED PRIOR TO
//         COMPLETION OF THE OPERATION OR THE SERVER IS NOT RESPONDING.\"}]}",
//     ourSide: false, retryable: false }
//   patients: [{ leadId: "SP86410123", name: "Juveira A H", age: 22,
//                gender: "FEMALE", isReportAvailable: true, adopted: false }]
//
// The UI keyed its entire message off `ourSide`, and for ourSide:false rendered:
//   "Thyrocare has no report for this order — they answered (500), this isn't a
//    connection problem, so retrying gives the same answer. Usually a demo or
//    mistyped order that never existed at Thyrocare."
//
// Every clause of that was false. Thyrocare never said the order was unknown —
// its own server timed out. It IS a connection problem, on their side. Retrying
// was exactly right. The order and the patient are real, and Thyrocare's own
// roster for that same order says her report EXISTS. A real customer sat
// unlinked behind a banner telling the operator she had never existed.
//
// This is the codebase's recurring defect: an identifier that answers one
// question read as if it answered another. `ourSide` answers WHOSE LEG FAILED.
// The copy read it as DOES THIS ORDER EXIST. The second question has THREE
// answers, not two:
//
//   (a) our request never reached them            → retry
//   (b) they failed transiently (5xx / timeout)   → retry; their system, not the order
//   (c) they answered "no such order/report"      → don't retry; may be a demo/typo
//
// (b) had no branch, so it fell through to (c). Splitting it out is the fix.
//
// Governing rule, applied throughout below: AN ABSENT SIGNAL IS NEVER A POSITIVE
// ASSURANCE. Silence, an unparseable body, or a status we don't recognise
// degrades to "unknown" — never to (c), the only verdict allowed to tell an
// operator the customer's order never existed.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Text that can only mean "their side broke, transiently" — never "no such
 * order". SERVER_TIMEOUT / "EXECUTION TIMEOUT EXPIRED" / "THE SERVER IS NOT
 * RESPONDING" are the exact strings VLC5D31A came back with.
 *
 * No /g flag: a global regex carries lastIndex between .test() calls and would
 * silently alternate true/false on repeated use.
 */
const VENDOR_TRANSIENT_SIGNAL =
  /server[\s_-]*timeout|execution timeout|timeout period|not responding|timed?[\s_-]?out|temporarily unavailable|service unavailable|server (?:is )?busy|gateway time-?out|bad gateway|try again later|deadlock|too many requests/i;

/**
 * A POSITIVE, definitive "we hold no such order". ONLY this may unlock the
 * "demo or mistyped order" copy. Its absence proves nothing.
 *
 * Live: the other five stranded orders (VL23C8DF, VL11F1CC, VLE2C673, VLDSIM001,
 * VL0853EA) all answer 404 with {"errors":[{"code":"DATA_NOT_FOUND","message":
 * "Order ID not found"}]} — genuinely case (c), and their banner was right.
 */
const VENDOR_NO_SUCH_ORDER_SIGNAL =
  /data[\s_-]*not[\s_-]*found|no[\s_-]*record|not\s+found/i;

/** Shared by whyStuck() so the two call sites can't drift apart. */
export function looksLikeTransientVendorFailure(text: string | null | undefined): boolean {
  return !!text && VENDOR_TRANSIENT_SIGNAL.test(text);
}

/** What we could actually get out of `vendorBody`. */
export interface VendorBodyRead {
  /** True only when a body was present AND it parsed as JSON. */
  parsed: boolean;
  /** errors[].code values, upper-cased. Empty when absent or unparseable. */
  codes: string[];
  /** The raw body, trimmed. Kept searchable even when parsed is false. */
  text: string;
}

/**
 * Read `vendorBody` without ever throwing.
 *
 * It arrives as a JSON *string* and cannot be trusted to be JSON at all — a
 * gateway in front of Thyrocare will happily return an HTML error page, and a
 * truncated body is common on the timeouts this whole module is about. So:
 * try to parse, and on failure keep the raw text for regex matching but report
 * parsed:false, which the classifier treats as "I could not read their answer"
 * rather than as any particular answer.
 */
export function readVendorBody(body: string | null | undefined): VendorBodyRead {
  const text = (body ?? "").trim();
  if (text === "") return { parsed: false, codes: [], text: "" };
  try {
    const json: unknown = JSON.parse(text);
    // JSON.parse("null") and JSON.parse("7") both succeed — guard the shape.
    const errors = json && typeof json === "object" ? (json as { errors?: unknown }).errors : null;
    const codes = Array.isArray(errors)
      ? errors
          .map((e) => (e && typeof e === "object" ? (e as { code?: unknown }).code : null))
          .filter((c): c is string => typeof c === "string")
          .map((c) => c.toUpperCase())
      : [];
    return { parsed: true, codes, text };
  } catch {
    return { parsed: false, codes: [], text };
  }
}

export type ReportFetchVerdictKind =
  /** No failure at all — Thyrocare simply hasn't published it yet. */
  | "not_published_yet"
  /** (a) Our request never got an answer. */
  | "our_request_failed"
  /** (b) Their server answered, only to say it broke. THE BRANCH THAT WAS MISSING. */
  | "vendor_transient"
  /** (c) They answered definitively: no such order/report. */
  | "vendor_says_no_report"
  /** We could not tell. Never dressed up as (c). */
  | "unknown";

export interface ReportFetchVerdict {
  kind: ReportFetchVerdictKind;
  /** Offer a "Try again" button? True for everything except a definitive no. */
  retryWorthwhile: boolean;
  /**
   * The ONLY flag that may unlock "demo / mistyped / never existed" copy.
   * Gate that sentence on this, never on `ourSide` — that swap is the bug.
   */
  mayNeverHaveExisted: boolean;
  /** The signal that decided it, in plain words. Shown to the operator. */
  because: string;
}

/**
 * Decide what Thyrocare actually told us about a report we couldn't read.
 *
 * Pure — same input, same verdict, no I/O — so the reasoning below is the whole
 * behaviour. Walked against the live payloads on 2026-08-05:
 *
 *   VLC5D31A  ourSide:false, 500, SERVER_TIMEOUT   → vendor_transient   (retry)
 *   VL23C8DF  ourSide:false, 404, DATA_NOT_FOUND   → vendor_says_no_report
 *   VL11F1CC  ourSide:false, 404, DATA_NOT_FOUND   → vendor_says_no_report
 *   VLE2C673  ourSide:false, 404, DATA_NOT_FOUND   → vendor_says_no_report
 *   VLDSIM001 ourSide:false, 404, DATA_NOT_FOUND   → vendor_says_no_report
 *   VL0853EA  ourSide:false, 404, DATA_NOT_FOUND   → vendor_says_no_report
 *
 * i.e. exactly one of the six banners was lying, and it was the one with a real
 * customer behind it.
 *
 * NOTE ON `diag.retryable` — 2026-08-07: NOW TRUSTED for the retry decision.
 *
 * It used to be ignored, and correctly so: VLC5D31A returned retryable:false on
 * a vendor SERVER_TIMEOUT, the textbook retryable failure, and a field wrong in
 * the one case that matters must not be allowed to suppress the retry button.
 *
 * The backend fixed it (2026-08-05, prod 2026-08-07, `79795ce`): it now splits
 * on status code — 5xx = their server failed to answer → retry; 4xx = their
 * server answered "no" → don't. Previously it split on `kind`, where
 * `http_error` covered a 500 and a 404 identically. They asked us to drop the
 * local derivation, and they're right: two sources of one truth drift, and if
 * theirs regresses they would rather hear about it than have it quietly
 * compensated for.
 *
 * Verified live on prod before switching over: all five outstanding orders
 * (VL23C8DF, VL11F1CC, VLE2C673, VLDSIM001, VL0853EA) report 404
 * DATA_NOT_FOUND with retryable:false — correct. NOT VERIFIED: the 5xx→true
 * branch, because no live order currently carries a 5xx. That is the branch
 * that failed last time, so `retryWorthwhile` below ORs their flag with our
 * reading rather than replacing one with the other — we defer to them on when
 * to retry, but we will not let a false suppress a retry that the vendor's own
 * words justify. Absent a signal we still offer the retry: a re-read is cheap,
 * writing off a waiting customer is not.
 *
 * The classification itself (whose fault, and therefore WHAT TO TELL THE
 * OPERATOR) stays ours — a boolean cannot say "the lab's system timed out"
 * versus "this order never existed", and that sentence is what caused the
 * original hour of confusion.
 */
export function classifyReportFetchFailure(
  diag: OrphanReportDiagnostic | null | undefined,
): ReportFetchVerdict {
  // 0. No diagnostic at all. The backend fills this in only when a fetch FAILED,
  //    so its absence means the fetch worked and the report simply isn't
  //    published — the normal state in the hours after collection. Not evidence
  //    of anything being wrong, and not a retry case.
  if (!diag) {
    return {
      kind: "not_published_yet",
      retryWorthwhile: false,
      mayNeverHaveExisted: false,
      because: "no fetch failure was reported — the report just isn't published yet",
    };
  }

  const body = readVendorBody(diag.vendorBody);
  // Kept separate on purpose. `vendorSays` is Thyrocare's OWN words and is the
  // only thing allowed to produce a definitive (c). `ourTransport` is our
  // backend's narration of the call — useful for spotting a timeout, but it
  // must never be the source of "the order doesn't exist".
  const vendorSays = `${body.codes.join(" ")} ${body.text}`;
  const ourTransport = `${diag.kind ?? ""} ${diag.message ?? ""}`;
  const status = diag.httpStatus ?? 0;

  // 1. Our leg failed — we never got an answer, so nothing the vendor "said"
  //    exists to interpret. This is the case that already worked.
  if (diag.ourSide) {
    return {
      kind: "our_request_failed",
      retryWorthwhile: true,
      mayNeverHaveExisted: false,
      because: "our request to Thyrocare never completed",
    };
  }

  // 2. THE MISSING BRANCH. Their server answered, but only to report its own
  //    failure. A 5xx is by definition "we broke", never "you asked for
  //    something that isn't here" — so no 5xx may ever reach step 3. 408 and
  //    429 are the same shape (slow down / try again) with a 4xx status.
  const transientStatus = status >= 500 || status === 408 || status === 429;
  if (
    transientStatus ||
    looksLikeTransientVendorFailure(vendorSays) ||
    looksLikeTransientVendorFailure(ourTransport)
  ) {
    return {
      kind: "vendor_transient",
      retryWorthwhile: true,
      mayNeverHaveExisted: false,
      because: transientStatus
        ? `Thyrocare answered ${status || "with a server error"} — their system, not this order`
        : "Thyrocare's own answer says it timed out or is overloaded",
    };
  }

  // 3. A definitive "no such order" needs Thyrocare to SAY SO. We require their
  //    words — an error code or matching body text — and not merely a bare 404,
  //    because a 404 with nothing behind it is equally consistent with our
  //    backend calling a wrong path. If the body didn't parse we have no words,
  //    so we fall through to (4) by construction: an unreadable answer can
  //    never become a statement that the customer's order never existed.
  const saysNoSuchOrder =
    body.codes.some((c) => c.includes("NOT_FOUND")) || VENDOR_NO_SUCH_ORDER_SIGNAL.test(vendorSays);
  if (saysNoSuchOrder) {
    return {
      kind: "vendor_says_no_report",
      // The ONE place the backend's flag can widen our answer rather than
      // narrow it. Thyrocare's words say "no such order", so we don't offer a
      // retry on our own account — but if the backend has decided this is
      // retryable anyway (it now reasons from the status code, and knows things
      // about the request that never reach this payload), defer to it. It can
      // turn a retry ON here; nothing lets it turn one OFF.
      retryWorthwhile: diag.retryable === true,
      mayNeverHaveExisted: true,
      because: `Thyrocare answered${status ? ` ${status}` : ""} that it holds no such order`,
    };
  }

  // 4. We could not tell. Say that, and still offer the retry — a re-read is
  //    cheap and safe, whereas guessing (c) here is how a waiting customer gets
  //    written off. This is the landing spot for malformed bodies, blank bodies
  //    and statuses we don't recognise.
  return {
    kind: "unknown",
    retryWorthwhile: true,
    mayNeverHaveExisted: false,
    because:
      body.text !== "" && !body.parsed
        ? "Thyrocare's answer couldn't be read"
        : "Thyrocare's answer didn't say why",
  };
}

/**
 * The people Thyrocare's OWN roster says have a report waiting and who still
 * have no booking.
 *
 * Two different answers come back about the same order: an order-level fetch,
 * and a per-patient roster. On VLC5D31A the first failed (500 SERVER_TIMEOUT)
 * while the second listed Juveira A H with isReportAvailable:true. The roster
 * is the more specific of the two and it is a POSITIVE statement, so it wins:
 * the report exists and we merely failed to fetch it.
 *
 * This is also why it is safe to open the form on: we unblock on the presence
 * of a positive signal, never on the absence of a negative one.
 */
export function patientsThyrocareSaysAreReady(
  pre: OrphanPreflight | null | undefined,
): OrphanPatient[] {
  return (pre?.patients ?? []).filter((p) => !p.adopted && p.isReportAvailable);
}

/**
 * True when the order-level fetch failed but the roster contradicts it. Surface
 * this to the operator rather than hiding it — the contradiction IS the finding.
 */
export function rosterContradictsFetchFailure(pre: OrphanPreflight | null | undefined): boolean {
  if (!pre || pre.reportAvailable) return false;
  return patientsThyrocareSaysAreReady(pre).length > 0;
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
