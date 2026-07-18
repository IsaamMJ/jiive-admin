// ─────────────────────────────────────────────────────────────────────────────
// The Customer Feedback backend contract. THE ONLY PLACE these shapes are declared.
//
// Source of truth: docs/handoff-backend-feedback.md (2026-07-18). Every endpoint
// and field below is stated there; nothing here was invented. The backend is NOT
// live yet — it is being built in parallel to that handoff — so every consumer
// renders real error/empty states and nothing is mocked.
//
// The endpoints (all relative to the admin API base, which already carries
// `/api/v1/admin` — see lib/api.ts):
//   POST /feedback          — log one piece of feedback.
//   GET  /feedback          — the feed (paginated, filterable).
//   GET  /feedback/export   — CSV download (blob).
//   GET  /incidents/meta    — also carries the feedback tag vocabulary (callTags).
//   GET  /users?limit=200   — existing; the customer picker filters it client-side.
//
// ⚠️ POST /feedback takes EXACTLY the keys in LogFeedbackRequest. The backend 400s
// on an unknown key rather than ignoring it. Do not add a field without the
// handoff pinning it down.
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

/** Feed glyphs — the handoff specifies these three. Distinct at a glance, no colour needed. */
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

// ── Explainer copy (InfoTips — project convention) ───────────────────────────

export const CHANNEL_EXPLAINER =
  "Where the feedback reached us — in person, a call, or a text. One tap, and it's the difference between “people are unhappy” and “everyone who grumbles in person is fine on WhatsApp”. The channel is often the pattern.";

export const EXPORT_PII_EXPLAINER =
  "The export is fed to an AI to surface themes, and this is health-adjacent personal data. Theme analysis doesn't need names — so customer names and phone numbers are left OUT by default. Untick the exclusion only when you have a specific reason to include them.";

export const TAGS_EXPLAINER =
  "A fixed list, never a text box. Free text guarantees “phlebo late”, “Phlebo Late” and “phlebotomist was late” all coexist and none of them count. These raw counts are the artefact the export turns into a scorecard.";

/** "phlebo_late" → "Phlebo late". Used for any server tag value we have no label for. */
export function humanizeEnumValue(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ── POST /feedback ───────────────────────────────────────────────────────────

/**
 * The log payload.
 *
 * ⚠️ EXACTLY these keys — the backend 400s on an unknown key. Attribution
 * (`loggedByLabel`) and `createdAt` are stamped SERVER-SIDE from the bearer
 * token; the frontend must not send them. Optional fields are omitted entirely
 * when empty rather than sent as null/"" (see api.ts logFeedback).
 */
export interface LogFeedbackRequest {
  userId: string;
  channel: FeedbackChannel;
  /** Required, non-empty (trimmed). This is the whole entry — someone's actual words. */
  notes: string;
  tags?: string[];
  bookingId?: string;
  incidentId?: string;
}

/** The created row the server echoes back. */
export interface LogFeedbackResponse {
  id: string;
  createdAt: string;
  channel: FeedbackChannel;
  userId: string;
  notes: string;
  tags: string[];
}

// ── GET /feedback — the feed ─────────────────────────────────────────────────

export interface FeedbackEntry {
  id: string;
  createdAt: string;
  channel: FeedbackChannel;
  userId: string;
  /** Resolved from the user by the server. */
  userName: string;
  notes: string;
  tags: string[];
  /** The admin who logged it. */
  loggedByLabel: string;
  bookingId?: string | null;
  incidentId?: string | null;
}

export interface FeedbackListParams {
  limit?: number;
  offset?: number;
  /** ISO — filter on createdAt. */
  from?: string;
  to?: string;
  channel?: FeedbackChannel;
  tag?: string;
  userId?: string;
}

export interface FeedbackListResponse {
  total: number;
  feedback: FeedbackEntry[];
}

// ── GET /feedback/export ─────────────────────────────────────────────────────

export interface ExportParams {
  from?: string;
  to?: string;
  /** DEFAULT FALSE. Health-adjacent data goes to an external AI — names stay out. */
  includePii?: boolean;
}

// ── Meta (GET /incidents/meta — it carries the feedback tag vocabulary) ───────

export interface MetaOption {
  value: string;
  label: string;
}

/**
 * The tag vocabulary. NO local fallback, deliberately: inventing a tag would
 * either 400 on save or — worse — write a value that never aggregates with the
 * server's, quietly corrupting the only number the export produces. If meta is
 * unreachable, the log dialog shows no chips and says so; free-text notes still
 * work. Same call the incidents/calls modules make against GET /incidents/meta.
 */
export interface FeedbackMeta {
  tags: MetaOption[];
}

/** Meta is tags-only here and has no safe fallback — an empty list is the degraded state. */
export const EMPTY_FEEDBACK_META: FeedbackMeta = { tags: [] };

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
