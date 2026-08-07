// ─────────────────────────────────────────────────────────────────────────────
// The wire contract for the per-collection user-detail endpoints.
//
// Source of truth: docs/handoff-backend-user-detail-pagination-RESPONSE.md.
// Every field name here was checked against a live dev response on 2026-08-07 —
// see app/users/api.ts for the traps that check is guarding against.
// ─────────────────────────────────────────────────────────────────────────────

/** An option the bot offered on an interactive message. `title` is what the customer saw. */
export interface ConvButton {
  id: string;
  title: string;
}

/**
 * A file the customer sent (a lab report PDF, a photo). WhatsApp keeps media ~30
 * days, so `mediaId` is a live handle, not permanent storage — older uploads 404.
 */
export interface ConvMedia {
  mediaId: string;
  filename?: string | null;
  mimeType?: string | null;
  caption?: string | null;
}

/**
 * `displayLabel` is the human label the customer actually saw/tapped for an
 * interactive button ("🧬 Know my Bio-Age"); `content` is the raw payload id
 * ("disc_know_bioage"). The backend resolves it; we prefer it for display.
 *
 * `buttons` are the options the BOT offered on an outbound interactive message
 * (id + the title the customer saw). Present only once the backend stores the
 * button set — see docs/handoff-backend-conversation-buttons.md. Absent =
 * nothing extra to render, never "there were no buttons".
 */
export interface ChatMessage {
  type?: "chat";
  direction: string;
  content: string;
  displayLabel?: string | null;
  messageType?: string;
  media?: ConvMedia | null;
  buttons?: ConvButton[] | null;
  createdAt: string;
}

export interface TemplateMessage {
  type: "template";
  direction: "outbound";
  content: string;
  displayLabel?: string | null;
  templateName: string;
  status: string;
  media?: ConvMedia | null;
  buttons?: ConvButton[] | null;
  createdAt: string;
}

/**
 * A message as the AGGREGATE `GET /users/:id` returns it. Note the absence of
 * `id` — that is the whole reason the old transcript keyed on the array index,
 * and the reason an index key stops being safe the moment pages are prepended.
 */
export type AggregateMessage = ChatMessage | TemplateMessage;

/**
 * The same message from `GET /users/:id/conversations`. Byte-identical to the
 * aggregate's shape PLUS `id` (handoff §4). `id` is half the keyset the server
 * pages on, and it is the React key here.
 */
export type ConversationItem =
  | (ChatMessage & { id: string })
  | (TemplateMessage & { id: string });

/**
 * One booking, as BOTH `GET /users/:id` (the aggregate) and
 * `GET /users/:id/bookings` return it.
 *
 * ONE type, deliberately — the handoff (§4) promises the paginated item is
 * byte-identical to the aggregate's, and that was checked rather than trusted:
 * on 2026-08-07 `JSON.stringify(endpoint.items) === JSON.stringify(aggregate.bookings)`
 * was TRUE on dev and on prod (prod user 5087e500…, 10 bookings). Two types
 * would let the two paths drift apart without anything failing to compile.
 */
export interface BookingItem {
  id: string;
  patientName: string;
  testType: string;
  appointmentDate: string;
  appointmentTime: string;
  status: string;
  /** PAISE. Divide by 100 to render rupees — never store the divided value. */
  amount: number;
  createdAt: string;
  address: { city: string; pincode: number } | null;
}

/**
 * One result, same story: identical from the aggregate and from
 * `GET /users/:id/results` (verified the same way, same day).
 *
 * `patientName` / `relationship` / `patientId` are WHO THE TEST IS FOR. One
 * account is a household, so this is not necessarily the account holder —
 * they are ID-joined via `Booking.patientId → FamilyMember`, never name-matched.
 * "self" = the account holder; null = an uploaded report not yet linked to a
 * member. Absent means "we don't know who", never "it's the account holder".
 */
export interface ResultItem {
  id: string;
  testType: string;
  calculatedAge: string;
  chronologicalAge: string;
  ageDelta: string;
  status: string;
  createdAt: string;
  retestReminderOptIn: boolean;
  retestReminderSentAt: string | null;
  /** Full shareable report link (latest non-expired token), or null if none. */
  reportUrl?: string | null;
  patientName?: string | null;
  relationship?: string | null;
  /** FamilyMember id — lets "Ask AI" deep-link to THIS person's context. */
  patientId?: string | null;
}

/**
 * The cursor-paged envelope. Both fields below are places the old code went
 * wrong, so they are documented at the type rather than at one call site:
 *
 *   `hasMore` is OBSERVED — the backend fetches limit+1 and reports whether the
 *   extra row came back. Do NOT re-derive it from `total > items.length`: on the
 *   last page of a long list that comparison is true and renders a "load more"
 *   that returns nothing. The response doc names that case and says there is a
 *   test for it.
 *
 *   `nextCursor` is OPAQUE base64url encoding the server's sort key. Never parse
 *   it, never construct one — it is passed back verbatim (URL-encoded) or not at
 *   all. It is null when the list is exhausted.
 */
export interface CursorPage<T> {
  items: T[];
  /** The REAL count for this user, always — not the page size. */
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * The OTHER paging mode, kept here so the difference is written down once.
 * `GET /users/:id/credit-transactions` is OFFSET-paged and stays that way
 * (handoff §5) — it now carries an `items` alias alongside `transactions`, but
 * it has no `nextCursor`. The absence of `nextCursor` is how the two modes are
 * told apart. The credits tab is live on `transactions`; nothing here migrates it.
 */
export interface OffsetPage<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
}
