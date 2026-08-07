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
import type { ConversationItem, CursorPage } from "./types";

/** The server's default. Also its documented sweet spot; 200 is the ceiling. */
export const CONVO_PAGE_SIZE = 50;

const LIMIT_MIN = 1;
const LIMIT_MAX = 200;

/**
 * The endpoint is not on this backend.
 *
 * Thrown ONLY for a 404, and it is the ONLY condition that may make a caller
 * fall back to the aggregate. A 400 or a 500 is a real failure and must reach
 * the operator as one — quietly rendering the legacy 50-message array when the
 * server is actually broken is precisely the accepted-and-ignored class this
 * whole workstream exists to kill.
 *
 * Live on 2026-08-07: dev (jiive-dev.isaam.dev) serves it; prod
 * (d3pvjhguhk37b0.cloudfront.net) answers
 * `{"message":"Cannot GET /api/v1/admin/users/<id>/conversations","statusCode":404}`.
 * A "user not found" 404 cannot be confused with this in practice: the page
 * only reaches here after `GET /users/:id` has already returned that user, and
 * if the user were gone the page renders "User not found" instead of a tab.
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
 */
export function conversationErrorMessage(e: unknown): string {
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
 */
function assertCursorPage(path: string, body: unknown): asserts body is CursorPage<ConversationItem> {
  const b = body as Partial<CursorPage<ConversationItem>> | null;
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
 *
 * `limit` is validated here, not clamped: the server returns 400 for anything
 * outside 1..200 (verified live — `limit=0` and `limit=201` both 400), and a
 * silent clamp would leave a caller unable to tell a satisfied request from a
 * quietly shrunk one. A malformed `before` is likewise a 400, never a silent
 * restart at page 1 (verified live).
 */
export async function fetchConversationsPage(
  userId: string,
  opts: { limit?: number; before?: string | null } = {},
): Promise<CursorPage<ConversationItem>> {
  const limit = opts.limit ?? CONVO_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < LIMIT_MIN || limit > LIMIT_MAX) {
    throw new Error(
      `Refusing to request limit=${limit}: the server accepts ${LIMIT_MIN}–${LIMIT_MAX} and 400s outside it.`,
    );
  }

  const path = `/users/${encodeURIComponent(userId)}/conversations`;
  const params = new URLSearchParams({ limit: String(limit) });
  // Verbatim, URL-encoded. The cursor is an opaque blob; building or editing
  // one here would make "what this list is ordered by" a breaking change.
  if (opts.before) params.set("before", opts.before);

  try {
    const r = await api.get(`${path}?${params.toString()}`);
    assertCursorPage(path, r.data);
    return r.data;
  } catch (e) {
    if (statusOf(e) === 404) throw new EndpointNotDeployedError(path);
    throw e;
  }
}
