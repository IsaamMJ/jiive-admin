// ─────────────────────────────────────────────────────────────────────────────
// THE ONLY AXIOS FOR THE PAGINATED USER-DETAIL COLLECTIONS.
//
// The base URL already carries /api/v1/admin (lib/api.ts:5), so paths here are
// relative to it. The handoff quotes "/admin/users/:id/conversations"; writing
// that verbatim would produce /api/v1/admin/admin/... and a 404 — which this
// module would then read as "endpoint not deployed" and silently degrade on.
// That is why the path lives in exactly one place.
//
// Verified live against dev on 2026-08-07 (see the notes on each guard).
// ─────────────────────────────────────────────────────────────────────────────

import api from "@/lib/api";
import type { BookingItem, ConversationItem, CursorPage, ResultItem } from "./types";

/** The server's default. Also its documented sweet spot; 200 is the ceiling. */
export const CONVO_PAGE_SIZE = 50;

/**
 * Bookings and results, per account, are SHORT lists — the backend measured them
 * before declining to add indexes for them (handoff §6: the busiest prod account
 * is under twenty bookings, a user's results are "single-digit"). Live on
 * 2026-08-07 the biggest prod account had 10 bookings and 6 results. So one page
 * of 50 loads the whole thing in practice and "load older" is the rare path, not
 * the normal one. It still exists, because "in practice" is not "always".
 */
export const COLLECTION_PAGE_SIZE = 50;

const LIMIT_MIN = 1;
const LIMIT_MAX = 200;

/**
 * The endpoint is not on this backend.
 *
 * Thrown ONLY for a 404, and it is the ONLY condition that may make a caller
 * fall back to the aggregate. A 400 or a 500 is a real failure and must reach
 * the operator as one — quietly rendering the legacy array when the server is
 * actually broken is precisely the accepted-and-ignored class this whole
 * workstream exists to kill.
 *
 * As of 2026-08-07 ALL THREE endpoints answer 200 on BOTH backends — dev and
 * prod. Re-verified against prod the same day: conversations `total: 117`,
 * bookings `total: 10`, results `total: 6` for real accounts. So on today's
 * deployments this class is never thrown, and that is the point of saying so
 * here: an earlier version of this comment described prod as 404ing, which was
 * true for about forty minutes and then silently stopped being true, and a
 * reader following it would have gone looking down the fallback path for a
 * behaviour that no longer exists.
 *
 * The class and the fallback both STAY, for the reason the 404 existed at all:
 * the two backends are promoted independently — prod answered
 * `{"message":"Cannot GET /api/v1/admin/users/<id>/conversations","statusCode":404}`
 * and then, ~40 minutes later and with no change here, 200 — so a rollback is a
 * 404 again, and the difference between "not deployed here" and "broken here"
 * has to survive it. A "user not found" 404 cannot be confused with this in
 * practice: the page only reaches here after `GET /users/:id` has already
 * returned that user, and if the user were gone the page renders "User not
 * found" instead of a tab.
 */
export class EndpointNotDeployedError extends Error {
  constructor(readonly path: string) {
    super(`${path} is not deployed on this backend (404).`);
    this.name = "EndpointNotDeployedError";
  }
}

function statusOf(e: unknown): number | undefined {
  return (e as { response?: { status?: number } })?.response?.status;
}

/**
 * The server's own message wins wherever it exists — a paraphrase has cost us
 * debugging hours before. Nest sends `message` as either a string or an array
 * of validation strings.
 *
 * Shared by all three collections: the failure modes are identical (the same
 * validation pipe produces `limit must be between 1 and 200, got 201` for every
 * one of them — verified live on both backends), so a per-collection copy would
 * only be three places to fix the same wording.
 */
export function userCollectionErrorMessage(e: unknown): string {
  if (e instanceof EndpointNotDeployedError) return e.message;
  const err = e as {
    response?: { status?: number; data?: { message?: string | string[]; error?: string } };
    message?: string;
  };
  const status = err?.response?.status;
  const body = err?.response?.data;
  const server = Array.isArray(body?.message) ? body.message.join(", ") : body?.message ?? body?.error;
  if (server) return `${status ?? "Request failed"}: ${server}`;
  return err?.message || "Couldn't load this conversation.";
}

/**
 * Reject an envelope that isn't one, rather than rendering `undefined.length`
 * or — far worse — a page count where a total belongs. `total` and `hasMore`
 * are load-bearing: the tab label states `total` as a fact, and `hasMore`
 * decides whether the operator is told there is older history.
 *
 * Generic over the item type on purpose. The three endpoints share ONE envelope
 * (handoff §1) and the guard is about the envelope, not the rows — a second
 * copy per collection is how one of them ends up without the `total` check.
 */
function assertCursorPage<T>(path: string, body: unknown): asserts body is CursorPage<T> {
  const b = body as Partial<CursorPage<T>> | null;
  if (!b || !Array.isArray(b.items)) {
    throw new Error(`${path} returned no \`items\` array — the envelope has changed.`);
  }
  if (typeof b.total !== "number" || !Number.isFinite(b.total)) {
    throw new Error(`${path} returned no numeric \`total\`. Refusing to state a page size as a count.`);
  }
  if (typeof b.hasMore !== "boolean") {
    throw new Error(`${path} returned no \`hasMore\`. It is observed server-side and must never be inferred here.`);
  }
  if (b.nextCursor != null && typeof b.nextCursor !== "string") {
    throw new Error(`${path} returned a non-string \`nextCursor\`.`);
  }
}

/**
 * One page of a user's WhatsApp transcript.
 *
 * `items` come back ASCENDING (oldest → newest WITHIN the page) — deliberately
 * the odd one out among the three endpoints, so the transcript renderer needs
 * no `.reverse()` that, if forgotten, would render somebody's conversation
 * backwards. Do NOT normalise it.
 *
 * The WALK is backwards in time regardless: `nextCursor` points at the OLDEST
 * row on the page, i.e. `items[0]`, and `before=<cursor>` fetches the page
 * before it. Each page therefore PREPENDS to the transcript.
 */
export async function fetchConversationsPage(
  userId: string,
  opts: PageOpts = {},
): Promise<CursorPage<ConversationItem>> {
  return fetchCursorPage<ConversationItem>(userId, "conversations", opts, CONVO_PAGE_SIZE);
}

/**
 * One page of a user's BOOKINGS.
 *
 * `items` come back DESCENDING — newest first, matching the aggregate (handoff
 * §3, confirmed live). Do NOT normalise or re-sort: the server owns the order,
 * the cursor encodes it, and a client-side re-sort would put the rows in an
 * order the next `before=` page does not continue from.
 *
 * "Older" therefore means FURTHER DOWN the table, not further up as it does for
 * the chat transcript — the walk direction is the same, but the visual end it
 * arrives at is the opposite one.
 */
export async function fetchBookingsPage(
  userId: string,
  opts: PageOpts = {},
): Promise<CursorPage<BookingItem>> {
  return fetchCursorPage<BookingItem>(userId, "bookings", opts, COLLECTION_PAGE_SIZE);
}

/** One page of a user's RESULTS. Descending, exactly as bookings — see above. */
export async function fetchResultsPage(
  userId: string,
  opts: PageOpts = {},
): Promise<CursorPage<ResultItem>> {
  return fetchCursorPage<ResultItem>(userId, "results", opts, COLLECTION_PAGE_SIZE);
}

export interface PageOpts {
  limit?: number;
  before?: string | null;
}

/**
 * The one request. All three collections are the same call against a different
 * path segment, so they are the same function — the alternative is three copies
 * of the limit check, the cursor encoding and the 404 translation, and the bug
 * this whole workstream is about is exactly what happens when one copy of a rule
 * quietly stops matching the others.
 *
 * `limit` is validated here, not clamped: the server returns 400 for anything
 * outside 1..200 — verified live on BOTH backends and on all three paths,
 * `limit=201` → `{"message":"limit must be between 1 and 200, got 201",…}` — and
 * a silent clamp would leave a caller unable to tell a satisfied request from a
 * quietly shrunk one. A malformed `before` is likewise a 400, never a silent
 * restart at page 1.
 */
async function fetchCursorPage<T>(
  userId: string,
  collection: "conversations" | "bookings" | "results",
  opts: PageOpts,
  defaultLimit: number,
): Promise<CursorPage<T>> {
  const limit = opts.limit ?? defaultLimit;
  if (!Number.isInteger(limit) || limit < LIMIT_MIN || limit > LIMIT_MAX) {
    throw new Error(
      `Refusing to request limit=${limit}: the server accepts ${LIMIT_MIN}–${LIMIT_MAX} and 400s outside it.`,
    );
  }

  const path = `/users/${encodeURIComponent(userId)}/${collection}`;
  const params = new URLSearchParams({ limit: String(limit) });
  // Verbatim, URL-encoded. The cursor is an opaque blob; building or editing
  // one here would make "what this list is ordered by" a breaking change.
  if (opts.before) params.set("before", opts.before);

  try {
    const r = await api.get(`${path}?${params.toString()}`);
    assertCursorPage<T>(path, r.data);
    return r.data;
  } catch (e) {
    if (statusOf(e) === 404) throw new EndpointNotDeployedError(path);
    throw e;
  }
}
