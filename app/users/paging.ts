// ─────────────────────────────────────────────────────────────────────────────
// Merging pages of a transcript. Pure functions, no imports beyond the types —
// so they can be reasoned about (and exercised) without a browser or a network.
// ─────────────────────────────────────────────────────────────────────────────

import type { ConversationItem } from "./types";

/**
 * The same sort key the server pages on: `(createdAt, id)` ascending.
 *
 * The `id` tiebreak is load-bearing, not defensive tidiness. `createdAt` is
 * millisecond-precision and one Lumi turn logs an inbound and an outbound
 * together, so identical timestamps happen in ordinary traffic. Ordering by
 * timestamp alone would let two such messages swap places between renders —
 * i.e. show a reply above the question that caused it.
 *
 * ISO-8601 UTC strings sort correctly lexicographically, so no Date parsing.
 */
export function compareMessages(a: ConversationItem, b: ConversationItem): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * Union two sets of messages, deduped by `id`, ascending.
 *
 * Used for BOTH directions — prepending an older page and folding in a poll of
 * the newest page — because a set union is order-agnostic and a poll that
 * overlaps what is already loaded must not duplicate it. `incoming` wins on a
 * collision: it is the fresher read of the same row (a template's `status` can
 * move from sent to failed).
 */
export function mergeMessages(
  existing: readonly ConversationItem[],
  incoming: readonly ConversationItem[],
): ConversationItem[] {
  const byId = new Map<string, ConversationItem>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort(compareMessages);
}

/**
 * Did a poll skip past what we have loaded?
 *
 * The poll asks for the NEWEST page. If more than a page of messages arrived
 * between two polls, that page shares no row with the loaded block and there is
 * a hole between them — and a plain union would render the two blocks flush
 * against each other, silently claiming a continuous conversation. Returns the
 * id of the first message AFTER the hole so the transcript can say so out loud.
 *
 * Needs a page of traffic inside one poll interval, so it is rare — which is
 * exactly why it would never be noticed if it were left to render as a lie.
 */
export function gapBeforeId(
  existing: readonly ConversationItem[],
  freshNewestPage: readonly ConversationItem[],
): string | null {
  if (existing.length === 0 || freshNewestPage.length === 0) return null;
  const known = new Set(existing.map((m) => m.id));
  // Any overlap at all means the two blocks are contiguous.
  if (freshNewestPage.some((m) => known.has(m.id))) return null;
  const newestKnown = existing[existing.length - 1];
  const oldestFresh = freshNewestPage[0];
  // Only a fresh page strictly NEWER than everything we hold leaves a hole. A
  // page strictly older can't come back from a no-cursor request, but if it
  // somehow did, it is not a gap of this kind.
  return compareMessages(oldestFresh, newestKnown) > 0 ? oldestFresh.id : null;
}
