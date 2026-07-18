// ─────────────────────────────────────────────────────────────────────────────
// The Customer Feedback backend contract (v2 — the living-note model).
// THE ONLY PLACE these shapes are declared.
//
// The model: each customer has ONE living, AI-organized feedback note that
// accumulates. An operator picks a customer, dumps a paragraph, and the note
// updates. Every raw dump is kept verbatim forever underneath; the AI-organized
// text is a view on top, never a replacement. The save is instant — the AI
// organize runs in the BACKGROUND, so no save ever waits on it.
//
// The backend is NOT live yet — it is being built in parallel — so every consumer
// renders real error/empty states and nothing is mocked.
//
// The endpoints (all relative to the admin API base, which already carries
// `/api/v1/admin` — see lib/api.ts):
//   POST /feedback                          — save one dump (organize runs async).
//   GET  /feedback/customers                — the feed of customers, newest activity first.
//   GET  /feedback/customers/:userId        — one customer's living note + raw dumps.
//   POST /feedback/customers/:userId/organize — re-organize the note (retry/refresh).
//   GET  /feedback/export                   — CSV download (blob).
//   GET  /users?limit=200                   — existing; the customer picker filters it client-side.
//
// ⚠️ POST /feedback takes EXACTLY the keys in LogFeedbackRequest, and no query
// endpoint takes a param not listed here. The backend 400s on an unknown key/param
// rather than ignoring it. Do not add a field without the contract pinning it down.
// ─────────────────────────────────────────────────────────────────────────────

// ── Channels ─────────────────────────────────────────────────────────────────
//
// Where the feedback reached us. Feedback arrives unprompted from anywhere — the
// channel is logged in one tap because it is often the pattern itself (everyone
// who grumbles in person is happy on WhatsApp, and the like).

export const FEEDBACK_CHANNELS = ["in_person", "call", "text"] as const;
export type FeedbackChannel = (typeof FEEDBACK_CHANNELS)[number];

export const CHANNEL_LABEL: Record<FeedbackChannel, string> = {
  in_person: "In person",
  call: "Call",
  text: "Text",
};

/** Feed glyphs — the contract specifies these three. Distinct at a glance, no colour needed. */
export const CHANNEL_EMOJI: Record<FeedbackChannel, string> = {
  in_person: "🧍",
  call: "📞",
  text: "💬",
};

export const CHANNEL_HINT: Record<FeedbackChannel, string> = {
  in_person: "Face to face — at the appointment or in the neighbourhood.",
  call: "They rang, or we rang them.",
  text: "WhatsApp or SMS.",
};

// ── Organize status ──────────────────────────────────────────────────────────
//
// The lifecycle of the AI-organized note. A dump is saved instantly; organizing
// happens in the background, so a freshly-saved note sits at "pending" until the
// backend catches up, and can land on "failed" if the AI errored.

export const ORGANIZE_STATUSES = ["ok", "pending", "failed"] as const;
export type OrganizeStatus = (typeof ORGANIZE_STATUSES)[number];

// ── Explainer copy (InfoTips — project convention) ───────────────────────────

export const CHANNEL_EXPLAINER =
  "Where the feedback reached us — in person, a call, or a text. One tap, and it's the difference between “people are unhappy” and “everyone who grumbles in person is fine on WhatsApp”. The channel is often the pattern.";

export const ORGANIZED_EXPLAINER =
  "An AI reads every raw dump you've logged for this customer and keeps ONE tidy summary up to date. It's a view on top of your words — never a replacement. Tap “Show original dumps” any time to read exactly what was said, verbatim.";

export const EXPORT_PII_EXPLAINER =
  "The export is fed to an AI to surface themes, and this is health-adjacent personal data. Theme analysis doesn't need names — so customer names and phone numbers are left OUT by default. Untick the exclusion only when you have a specific reason to include them.";

export const EXPORT_MODE_EXPLAINER =
  "“Raw dumps” exports exactly what was logged, one row per dump — the honest source. “Organized notes” exports the AI summary, one row per customer — tidier, but a step removed from the actual words. Default is raw dumps.";

// ── POST /feedback — save one dump ───────────────────────────────────────────

/**
 * The dump payload.
 *
 * ⚠️ EXACTLY these keys — the backend 400s on an unknown key. Attribution and
 * `createdAt` are stamped SERVER-SIDE from the bearer token; the frontend must not
 * send them. There are deliberately NO tags in v2: the whole point is "pick a
 * customer, pick a channel, dump a paragraph" — the AI-organized note and the
 * export→theme-analysis do the theming, so manual tagging is friction we removed.
 * A plain dump sends exactly `{ userId, channel, notes }`; `bookingId` is included
 * only when present.
 */
export interface LogFeedbackRequest {
  userId: string;
  channel: FeedbackChannel;
  /** Required, non-empty (trimmed). Someone's actual words — a paragraph, not a field. */
  notes: string;
  bookingId?: string;
}

/** The saved dump the server echoes back. Organizing has NOT happened yet at this point. */
export interface LogFeedbackResponse {
  id: string;
  createdAt: string;
  channel: FeedbackChannel;
  userId: string;
  notes: string;
}

// ── GET /feedback/customers — the feed ───────────────────────────────────────
//
// The feed is CUSTOMERS, not individual dumps: one row per customer who has any
// feedback, newest activity first. `organizedPreview` is a short cut of the living
// note; `organizeStatus` says whether that preview is current, still organizing,
// or failed.

export interface FeedbackCustomer {
  userId: string;
  userName: string;
  /** ISO — the most recent dump's timestamp. Drives the newest-first order. */
  lastDumpAt: string;
  dumpCount: number;
  /** A short cut of the organized note. May be empty while organizeStatus === "pending". */
  organizedPreview: string;
  organizeStatus: OrganizeStatus;
}

export interface CustomerFeedParams {
  limit?: number;
  offset?: number;
  /** ISO — filter on activity date. */
  from?: string;
  to?: string;
  channel?: FeedbackChannel;
  /** Free-text name/phone search, matched server-side. */
  search?: string;
}

export interface CustomerFeedResponse {
  total: number;
  customers: FeedbackCustomer[];
}

// ── GET /feedback/customers/:userId — the living note ─────────────────────────

/** One raw dump. The verbatim record — always reachable under the organized note. */
export interface FeedbackDump {
  id: string;
  createdAt: string;
  channel: FeedbackChannel;
  /** The operator's actual words. Rendered verbatim, never paraphrased. */
  notes: string;
  /** The admin who logged it. */
  loggedByLabel: string;
}

export interface CustomerNote {
  userName: string;
  /** The AI-organized summary. Empty/placeholder while organizeStatus === "pending". */
  organizedText: string;
  /** ISO — when the organized text was last regenerated. Null before the first organize. */
  organizedAt: string | null;
  organizeStatus: OrganizeStatus;
  /** Raw dumps, newest first. The source of truth beneath the summary. */
  dumps: FeedbackDump[];
}

// ── POST /feedback/customers/:userId/organize — retry / refresh ──────────────

/** The result of a manual re-organize. Same fields the note carries for the summary. */
export interface OrganizeResult {
  organizedText: string;
  organizedAt: string | null;
  organizeStatus: OrganizeStatus;
}

// ── GET /feedback/export ─────────────────────────────────────────────────────

/** What the export writes: one row per raw dump, or one row per customer's note. */
export const EXPORT_MODES = ["dumps", "organized"] as const;
export type ExportMode = (typeof EXPORT_MODES)[number];

export interface ExportParams {
  from?: string;
  to?: string;
  /** DEFAULT FALSE. Health-adjacent data goes to an external AI — names stay out. */
  includePii?: boolean;
  /** DEFAULT "dumps" — the honest, verbatim source. */
  mode?: ExportMode;
}

// ── Customer picker (existing GET /users?limit=200, filtered client-side) ─────

/**
 * The subset of a user we need to pick and identify one. The `/users` payload
 * carries far more (see app/users/page.tsx); this is all the picker reads.
 */
export interface PickableUser {
  id: string;
  name: string;
  whatsappPhone: string;
}

/** One of a customer's bookings, for the optional "which visit?" picker. */
export interface PickableBooking {
  id: string;
  testType: string;
  appointmentDate: string;
  status: string;
}
