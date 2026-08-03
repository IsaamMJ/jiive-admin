import { isPurgedUser } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// The Feedback Calls backend contract. THE ONLY PLACE these shapes are declared.
//
// Source of truth: docs/proposal-incidents-and-feedback-calls.md (§ Screen 3),
// docs/handoff-backend-incidents-and-calls.md (§ CallLog), and the live dev
// backend — every endpoint and field below was verified against it before this
// module was written.
//
// The three endpoints that exist:
//   GET  /calls/queue    — the worklist. GROUPED BY VISIT (see CallQueueRow).
//   POST /calls          — log a call.
//   GET  /calls/stats    — CSAT + tag counts.
//   GET  /incidents/meta — also carries the CALL vocabulary (dispositions,
//                          queue reasons, tags, attempt cap).
//
// There is NO `GET /calls` list endpoint. It 404s. Do not invent one, and do not
// invent a query param: the backend rejects unknown keys with a hard 400 rather
// than ignoring them, which takes the whole page down instead of degrading.
//
// Fields marked [INFERRED] are not pinned down by a verified response and are
// therefore optional here and rendered defensively. Everything else is verified.
// ─────────────────────────────────────────────────────────────────────────────

// ── Dispositions (exactly 7, flat) ───────────────────────────────────────────
//
// No `voicemail` — effectively dead on Indian mobile networks, and carrying the
// code adds a choice nobody would legitimately use. `unreachable` (switched off)
// stays distinct from `no_answer` (ringing, ignored): they justify different
// retry timing.
//
// Ordered as they are presented on the call screen: the most common outcome
// first, the permanent one last and visually separated.

export const CALL_DISPOSITIONS = [
  "connected",
  "no_answer",
  "unreachable",
  "callback",
  "refused",
  "wrong_number",
  "do_not_contact",
] as const;
export type CallDisposition = (typeof CALL_DISPOSITIONS)[number];

export const DISPOSITION_LABEL: Record<CallDisposition, string> = {
  connected: "Connected",
  no_answer: "No answer",
  unreachable: "Unreachable",
  callback: "Call back later",
  refused: "Refused",
  wrong_number: "Wrong number",
  do_not_contact: "Do not contact",
};

export const DISPOSITION_HINT: Record<CallDisposition, string> = {
  connected: "They picked up and talked",
  no_answer: "Rang out — phone is on, nobody answered",
  unreachable: "Switched off, out of coverage, or dead line",
  callback: "They asked to be rung another time",
  refused: "Picked up, didn't want to talk",
  wrong_number: "Not this customer's number",
  do_not_contact: "Never call again — permanent",
};

/**
 * The only disposition that opens Stage 2. Everything else is one tap and done —
 * that is the whole design: if logging a no-answer is fiddly, no-answers stop
 * being logged and attempt-tracking silently becomes fiction.
 */
export const CONNECTED: CallDisposition = "connected";

/** Removes the row from the queue permanently (verified against dev). */
export const TERMINAL_DISPOSITIONS: readonly CallDisposition[] = [
  "connected",
  "refused",
  "wrong_number",
  "do_not_contact",
];

/** Server-enforced: `callbackAt` is required, so we must ask WHEN before saving. */
export const CALLBACK: CallDisposition = "callback";

/** Consent withdrawal, not a preference. Confirmed before it is sent. */
export const DO_NOT_CONTACT: CallDisposition = "do_not_contact";

// ── Queue reasons ────────────────────────────────────────────────────────────
//
// Why this person is in the queue. Everyone else: don't call.

export const CALL_QUEUE_REASONS = ["incident", "first_time", "low_csat", "nth_repeat"] as const;
export type CallQueueReason = (typeof CALL_QUEUE_REASONS)[number];

export const QUEUE_REASON_LABEL: Record<CallQueueReason, string> = {
  incident: "Incident",
  first_time: "First-time",
  low_csat: "Low CSAT",
  nth_repeat: "Every-5th",
};

export const QUEUE_REASON_HINT: Record<CallQueueReason, string> = {
  incident: "We hurt this person. Close the loop within 48–72h.",
  first_time: "Their first test. Highest information density — retention is won or lost here.",
  low_csat: "They scored us 3 or less last time. A known-bad relationship is the strongest signal there is.",
  nth_repeat: "Every 5th repeat customer, so the queue isn't purely a complaint funnel.",
};

/** Attempt cap. The server sends `maxCallAttempts` in meta; this is the fallback. */
export const DEFAULT_MAX_CALL_ATTEMPTS = 3;

// ── Explainer copy (InfoTips — project convention) ───────────────────────────

export const CSAT_EXPLAINER =
  "1–5 satisfaction, not NPS. NPS's founding claim failed to replicate, a 0–10 scale is miserable to read out by voice (people ask you to repeat the anchors and default to 8), and asking “would you recommend us” when the founder is on the phone produces a wall of 9s that tells you nothing.";

export const TOP2BOX_EXPLAINER =
  "The % of people who answered 4 or 5. Top-2-box satisfaction is the measure that correlated best with two-year retention in the research — better than NPS, and far better than effort score, which correlated negatively.";

export const ATTEMPTS_EXPLAINER =
  "Three attempts, spaced across different times of day. Varying the time beats increasing the count — someone who didn't answer at 11am Tuesday is at work, and 11am Wednesday tests the same hypothesis twice. Sales playbooks say 8–12 touches; that's cold prospecting. This is a courtesy call. Attempt eight is harassment.";

export const DNC_EXPLAINER =
  "Permanent, and enforced by the system — not a preference we try to remember. It is a consent withdrawal: they are removed from every future call list, for good.";

export const TAGS_EXPLAINER =
  "A fixed list, never a text box. Free text guarantees “phlebo late”, “Phlebo Late” and “phlebotomist was late” all coexist and none of them count. These raw counts are the artefact that goes to Thyrocare.";

export const CALLBACK_NOTE = "A callback does not burn an attempt.";

/** Read aloud, verbatim, every time. Same words each call or the number means nothing. */
export const CSAT_SCRIPT =
  "Overall, how satisfied were you with your Jiive blood test? On a scale of 1 to 5, where 5 is very satisfied and 1 is very dissatisfied.";

/** The unscored question that produces the actual insight. Ask it right after the score. */
export const FOLLOW_UP_SCRIPT = "And what's the one thing we could have done better?";

/**
 * The consent notice. Pinned at the top of the call screen so it is never
 * forgotten — the notes are health-adjacent personal data, and this is the
 * one-line notice that makes taking them legitimate.
 */
export function consentScript(adminName: string): string {
  const who = adminName.trim() || "an admin";
  return `Hi, this is ${who} from Jiive. I'm calling about your recent test so we can improve — two minutes, is now okay? I'll note down your comments; you can skip anything.`;
}

/** "phlebo_late" → "Phlebo late". Used for any server value we have no label for. */
export function humanizeEnumValue(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function enumLabel(map: Record<string, string>, value: string): string {
  return map[value] ?? humanizeEnumValue(value);
}

// ── Queue ────────────────────────────────────────────────────────────────────

/** Attribution, never authorization — every call log is team-visible. */
export interface CallAdminRef {
  id: string;
  name: string;
  email?: string;
}

/**
 * The incident this person hit, when `queueReason === "incident"`. These are the
 * people we HURT: the row shows this prominently and they sort to the top.
 *
 * Only `id` is relied on (it is what POST /calls wants as `incidentId`);
 * everything else is rendered if present and skipped if not. [INFERRED shape]
 */
export interface QueueIncidentRef {
  id: string;
  ref?: string | null;
  title?: string | null;
  severity?: string | null;
  category?: string | null;
  status?: string | null;
  occurredAt?: string | null;
}

/**
 * What was said the last time we rang this person. Shown on the row so the
 * caller does not re-ask a question they already answered — the fastest way to
 * make a courtesy call feel like a call centre.
 *
 * [INFERRED shape] — everything but `id` and `disposition` is optional and
 * rendered only when present.
 */
export interface PreviousCall {
  id: string;
  disposition: CallDisposition;
  csat?: number | null;
  notes?: string | null;
  verbatim?: string | null;
  tags?: string[] | null;
  resolved?: boolean | null;
  attemptNumber?: number | null;
  callbackAt?: string | null;
  /** The wire may call it either. Read via `previousCallAt()`. */
  createdAt?: string | null;
  startedAt?: string | null;
  calledBy?: CallAdminRef | null;
  calledByAdminId?: string | null;
}

/** When a previous call happened, whichever field the wire used. */
export function previousCallAt(c: PreviousCall): string | null {
  return c.createdAt ?? c.startedAt ?? null;
}

/**
 * One row = ONE VISIT, not one booking.
 *
 * This is the single most important thing about the queue: the backend groups by
 * visit, so the motivating incident — six orders for one person in one slot —
 * is ONE row and ONE phone call. `bookingCount` / `testTypes` cover the whole
 * batch. Rendering a row per booking would ring the same person six times, which
 * is the exact failure the incident log exists to stop us repeating.
 */
export interface CallQueueRow {
  /** The primary booking of the visit — what POST /calls takes as `bookingId`. */
  bookingId: string;
  /** Every booking in the visit, including the primary one. */
  bookingIds: string[];
  bookingCount: number;
  userId: string;
  userName: string;
  phone: string;
  patientName: string;
  /** The primary booking's test. Use `testTypes` when bookingCount > 1. */
  testType: string;
  testTypes: string[];
  appointmentDate: string; // ISO
  appointmentTime: string; // "07:20"
  bookingStatus: string;
  queueReason: CallQueueReason;
  /** Lower = call sooner. The server owns the ordering; we sort by it, never re-rank. */
  priority: number;
  attemptNumber: number;
  attemptsUsed: number;
  maxAttempts: number;
  /** A callback they asked for is now due. */
  callbackDue: boolean;
  callbackAt: string | null;
  incident: QueueIncidentRef | null;
  previousCalls: PreviousCall[];
}

export interface CallQueueResponse {
  queue: CallQueueRow[];
  total: number;
}

// ── POST /calls ──────────────────────────────────────────────────────────────

/**
 * The log payload.
 *
 * ⚠️ EXACTLY these keys. The backend 400s on an unknown key rather than ignoring
 * it, and a 400 here means a call that was actually made never gets recorded.
 * `calledByAdminId` / `startedAt` / `endedAt` are stamped SERVER-SIDE from the
 * bearer token — the frontend has no access to the admin's ID and must not send
 * them. Nobody types a duration, ever.
 *
 * Two rules the server enforces (both verified — the UI makes them unreachable,
 * but if the server refuses anyway its message is surfaced verbatim):
 *   - csat (1–5) is required when disposition is 'connected'
 *   - callbackAt is required when disposition is 'callback'
 */
export interface LogCallRequest {
  userId: string;
  queueReason: CallQueueReason;
  disposition: CallDisposition;
  bookingId?: string;
  /** Set when the row carries an incident — this is what closes the loop on it. */
  incidentId?: string;
  /** 1–5. Required iff disposition === "connected". */
  csat?: number;
  tags?: string[];
  notes?: string;
  /** One quote, in their words. */
  verbatim?: string;
  resolved?: boolean;
  /** ISO. Required iff disposition === "callback". */
  callbackAt?: string;
}

export interface LogCallResponse {
  call: {
    id: string;
    disposition: CallDisposition;
    [key: string]: unknown;
  };
}

/** 1–5, five big buttons. Not a slider, not a 0–10 scale. */
export const CSAT_VALUES = [1, 2, 3, 4, 5] as const;
export type CsatValue = (typeof CSAT_VALUES)[number];

export const CSAT_LABEL: Record<CsatValue, string> = {
  1: "Very dissatisfied",
  2: "Dissatisfied",
  3: "Neutral",
  4: "Satisfied",
  5: "Very satisfied",
};

/** Top-2-box is 4 or 5. Kept here so the UI and the stats strip cannot disagree. */
export const CSAT_TOP_2_BOX: readonly number[] = [4, 5];

// ── GET /calls/stats ─────────────────────────────────────────────────────────

/**
 * The read side. Per the proposal, this is not decoration: data entry that never
 * comes back to the person entering it is exactly why CRMs go unused. The tag
 * counts are shown as RAW COUNTS ("phlebo-late ×7") — more honest and more
 * actionable than "18.4% cited timeliness", and it is the artefact that goes to
 * Thyrocare.
 */
export interface CallStats {
  /** Call ATTEMPTS (any real disposition). Excludes remarks — those are notes. */
  totalCalls: number;
  /** Free-text remarks logged. Counted separately from calls by the backend. */
  remarkCount: number;
  byDisposition: Record<string, number>;
  csatResponses: number;
  csatTop2BoxPercent: number;
  csatAverage: number;
  tagCounts: Record<string, number>;
  optedOutUsers: number;
}

// ── Meta (GET /incidents/meta — it carries the CALL vocabulary too) ───────────

export interface MetaOption<T extends string = string> {
  value: T;
  label: string;
}

export interface CallMeta {
  dispositions: MetaOption<CallDisposition>[];
  queueReasons: MetaOption<CallQueueReason>[];
  /**
   * The tag vocabulary. NO local fallback, deliberately: dispositions and queue
   * reasons are fixed by the contract and safe to hard-code, but the tag list is
   * the server's and inventing one would either 400 on save or — worse — write a
   * tag that never aggregates with the server's, quietly corrupting the only
   * number this feature produces. If meta is unreachable, the call screen shows
   * no chips and says so; notes still work.
   */
  tags: MetaOption[];
  maxAttempts: number;
}

/**
 * Used when GET /incidents/meta is unreachable. Dispositions and queue reasons
 * are contract-fixed, so they are safe. `tags` is deliberately EMPTY — see above.
 * A degraded vocabulary is survivable; a corrupted tag count is not.
 */
export const FALLBACK_CALL_META: CallMeta = {
  dispositions: CALL_DISPOSITIONS.map((value) => ({ value, label: DISPOSITION_LABEL[value] })),
  queueReasons: CALL_QUEUE_REASONS.map((value) => ({ value, label: QUEUE_REASON_LABEL[value] })),
  tags: [],
  maxAttempts: DEFAULT_MAX_CALL_ATTEMPTS,
};

/**
 * Whether a tag describes something that went WRONG — i.e. something that can be
 * "resolved". Used only to decide whether to reveal the Resolved toggle, so a
 * miss costs a hidden toggle, never a wrong value: `resolved` is never sent
 * unless the caller actually turns it on.
 *
 * A substring heuristic rather than a hard-coded list, because the tag vocabulary
 * is the server's and can grow without a frontend release.
 */
const ISSUE_TAG_MARKERS = [
  "late", "no_show", "noshow", "miss", "wrong", "delay", "fail", "issue", "error",
  "bad", "poor", "rude", "pain", "complaint", "refund", "damage", "unreachable",
  "cancel", "reschedul", "dirty", "unprofessional", "repeat", "difficult",
];

export function isIssueTag(tag: string): boolean {
  const t = tag.toLowerCase();
  return ISSUE_TAG_MARKERS.some((m) => t.includes(m));
}

/**
 * `tel:` needs digits (and a leading +) only — spaces, dashes and brackets make
 * some dialers silently drop the call rather than fail loudly.
 *
 * ⚠️ Verified live (GET /calls/queue, GET /users): EVERY stored phone is a bare
 * 12-digit "91XXXXXXXXXX" with NO leading "+". A handset reads a `+`-less string
 * as a DOMESTIC number, not +91 — the call fails or misdials a random local
 * number. Preserving-only-if-present (the old behaviour) never added the "+", so
 * every "Call" button on this page emitted a dead link. This must resolve the
 * country code, not just pass digits through.
 *
 * Only returns null (never a best-effort guess) when the input can't be
 * resolved with confidence — the caller must fall back to the existing
 * disabled "No number" state (app/calls/page.tsx) rather than risk dialling
 * the wrong person.
 */
export function telHref(phone: string): string | null {
  const trimmed = phone.trim();
  if (!trimmed) return null;

  // The right-to-erasure tombstone is "purged:<uuid>". Stripped to digits it
  // still yields digits from the UUID, so it would otherwise produce a
  // garbage-but-well-formed `tel:` link. Refuse before the digit heuristics
  // below ever see it. isPurgedUser lives in lib/ precisely so this pure
  // contract file can share the one check without pulling in a feature
  // module's axios client.
  if (isPurgedUser(trimmed)) return null;

  // An explicit "+" is trusted as already-resolved E.164 — just drop formatting
  // noise (spaces/dashes/brackets) from what follows it.
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return digits.length >= 8 ? `+${digits}` : null;
  }

  const digits = trimmed.replace(/\D/g, "");

  // The verified live shape: 91 + 10-digit Indian mobile, no "+". This IS valid
  // E.164 once a "+" is prepended — do not also strip/re-add the "91".
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;

  // A bare 10-digit number with no country code at all. Indian mobiles start 6-9;
  // treat anything else (e.g. a landline missing its STD code) as unresolvable
  // rather than guess a country.
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;

  // Anything else — including the Thyrocare vendor's phlebo phone, which is
  // [INFERRED shape] and may be formatted however the vendor likes — can't be
  // resolved with confidence. "No usable phone number" beats a wrong dial.
  return null;
}
