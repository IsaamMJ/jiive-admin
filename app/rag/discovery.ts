/**
 * The Discovered-queue contract: every axios call and every wire guard for the
 * auto-discovery feature lives here, so a backend contract change is a one-file
 * fix (house rule — see AGENTS.md / docs/BUILD-CHECKLIST.md #5).
 *
 * Backend handoff: jiive-backend/docs/handoff-admin-kb-discovered-queue.md.
 * Payloads below were verified live against dev and prod on 2026-08-09 — see
 * the quoted responses in the comments, not just the handoff doc.
 */

import api from "@/lib/api";
import type { DiscoveredDocument, DiscoverRunResponse, DocStatus } from "./types";

/**
 * ⚠️ WORKAROUND — DELETE WHEN THE BACKEND ADDS A SERVER-SIDE FLAG.
 *
 * The handoff says: *"everything discovered has a non-null `sourceUrl`"*, so we
 * could filter the main list on that field. **That is not possible.**
 * `GET /rag/documents` does not return `sourceUrl` at all. Verified live on dev
 * 2026-08-09 — the full row shape is:
 *
 *     { documentId, title, chunkCount, status, updatedAt }
 *
 * All three dev discovered documents appear in that list and are byte-for-byte
 * indistinguishable from an uploaded `pending_review` row.
 *
 * So the partition is done client-side by id: fetch `/rag/discovered`, build a
 * Set of its `documentId`s, and subtract. This costs one extra request and is
 * only correct while that request succeeds — which is why the caller must NOT
 * partition when the discovered fetch failed (a silently unfiltered list that
 * looks filtered is worse than an honestly unfiltered one).
 *
 * Ask the backend for `discoveredVia` / `sourceUrl` on `/rag/documents`, then
 * delete this whole mechanism.
 */
export const DISCOVERED_PARTITION_NOTE =
  "The server doesn't mark which documents were auto-discovered, so this split is made in the browser by matching IDs against the Discovered queue.";

/** The literal the backend uses when a publication date could not be established. */
const SOURCE_DATE_UNKNOWN = "unknown";

/**
 * True when we do NOT know when the source was published.
 *
 * The backend sends the literal string `"unknown"` rather than null — every dev
 * row currently does. An undated clinical guideline is a real review signal, so
 * this must never be hidden, never be formatted as a date, and never be allowed
 * to read as "recent". Absent (`null` / `""`) is treated the same way: still not
 * a date, still not an assurance.
 */
export function isSourceDateUnknown(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = value.trim();
  return trimmed === "" || trimmed.toLowerCase() === SOURCE_DATE_UNKNOWN;
}

/**
 * The publisher domain, which is the actual trust signal — `nice.org.uk` tells a
 * reviewer more than 60 characters of URL do. `www.` is stripped because it is
 * noise, nothing else: the host is otherwise returned verbatim.
 *
 * Returns null when the URL will not parse, which the caller must treat as "this
 * is not a usable link", not as an empty label.
 */
export function publisherDomain(sourceUrl: string): string | null {
  const url = parseHttpUrl(sourceUrl);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  return host.startsWith("www.") ? host.slice(4) : host;
}

/**
 * Parse a source URL, accepting **only** http/https.
 *
 * `sourceUrl` originates from a remote search API. The backend re-checks it
 * against its publisher allowlist, but this is the last hop before the string
 * becomes an `href` in an admin's browser — and a `javascript:` or `data:` URL
 * in an href is script execution, not a link. Anything that is not http(s) is
 * refused a link and shown as plain text instead.
 */
function parseHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

/** The href to render, or null when the value must not become a clickable link. */
export function safeSourceUrl(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl) return null;
  return parseHttpUrl(sourceUrl) ? sourceUrl : null;
}

// ── Wire guards ──────────────────────────────────────────────────────────────
//
// This response is assembled from a third-party search API. A malformed row must
// cost us that row, not the whole review queue — an exception here would blank a
// screen whose entire job is to show an operator what is waiting for them.

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function coerceDiscovered(raw: unknown): DiscoveredDocument | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const documentId = asString(r.documentId);
  const sourceUrl = asString(r.sourceUrl);
  // Without an id there is nothing to review and nothing to partition on; without
  // a sourceUrl the row has no provenance, which is the only reason this tab
  // exists. Either absence makes the row unreviewable, so drop it rather than
  // render a card that can't answer "who published this?".
  if (!documentId || !sourceUrl) return null;
  return {
    documentId,
    title: asString(r.title) ?? "Untitled",
    // Status is rendered by the shared badge; an unrecognised value falls through
    // to the badge's own passthrough case rather than being coerced to something
    // reassuring.
    status: (asString(r.status) ?? "pending_review") as DocStatus,
    sourceUrl,
    // Kept verbatim — including the literal "unknown". Normalising it to null
    // here would erase the difference between "the backend told us it doesn't
    // know" and "the field wasn't sent"; `isSourceDateUnknown` covers both.
    sourceDate: asString(r.sourceDate),
    discoveryQuery: asString(r.discoveryQuery),
    chunkCount: typeof r.chunkCount === "number" ? r.chunkCount : 0,
    updatedAt: asString(r.updatedAt) ?? "",
  };
}

/**
 * The result of loading the queue. `unavailable` is a 404 — the endpoint is not
 * deployed here — and is deliberately distinct from `error`, because "this
 * build predates the feature" and "the backend is down" call for different
 * operator reactions (BUILD-CHECKLIST #2).
 */
export type DiscoveredOutcome =
  | { kind: "ok"; docs: DiscoveredDocument[] }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

function serverMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { message?: string; error?: string } } })?.response
    ?.data;
  // Verbatim server message where there is one — never a paraphrase.
  return data?.message ?? data?.error ?? fallback;
}

function httpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

/**
 * `GET /rag/discovered` → array, newest first. Never throws.
 *
 * Live dev response 2026-08-09 (3 rows, abridged):
 *   { documentId: "b7a896b5…", title: "Overview | Thyroid disease…",
 *     status: "pending_review", sourceUrl: "https://www.nice.org.uk/guidance/NG145",
 *     sourceDate: "unknown", discoveryQuery: "tsh", chunkCount: 0,
 *     updatedAt: "2026-08-09T09:56:08.175Z" }
 * Live prod response 2026-08-09: `[]` with HTTP 200.
 */
export async function fetchDiscovered(): Promise<DiscoveredOutcome> {
  try {
    const r = await api.get<unknown>("/rag/discovered");
    if (!Array.isArray(r.data)) {
      // A non-array body means the contract moved. Say so instead of rendering an
      // empty queue, which would read as "nothing was found".
      return { kind: "error", message: "The server returned an unexpected shape for the discovered queue." };
    }
    return {
      kind: "ok",
      docs: r.data.map(coerceDiscovered).filter((d): d is DiscoveredDocument => d !== null),
    };
  } catch (err) {
    if (httpStatus(err) === 404) return { kind: "unavailable" };
    return { kind: "error", message: serverMessage(err, "Could not load the discovered queue.") };
  }
}

/**
 * The result of a manual discovery run. A 409 means discovery is not wired in
 * this deployment — an answer about capability, not a failure, so it is its own
 * variant and must not be toasted as an error.
 */
export type DiscoverOutcome =
  | { kind: "ran"; result: DiscoverRunResponse }
  | { kind: "unavailable"; message: string }
  | { kind: "error"; message: string };

/**
 * `POST /rag/discover`. Never throws.
 *
 * Costs a real search-API call and writes rows, so it is confirmed before it
 * fires. The explicit timeout matters: the run takes ~30s and the button shows a
 * spinner for the whole of it, so the request must be guaranteed to end rather
 * than leave the operator staring at a spinner that can never resolve
 * (BUILD-CHECKLIST #3).
 */
export async function runDiscovery(): Promise<DiscoverOutcome> {
  try {
    const r = await api.post<Partial<DiscoverRunResponse>>("/rag/discover", {}, { timeout: 90_000 });
    const d = r.data ?? {};
    return {
      kind: "ran",
      result: {
        gaps: Array.isArray(d.gaps) ? d.gaps.filter((g): g is string => typeof g === "string") : [],
        fetched: typeof d.fetched === "number" ? d.fetched : 0,
        queued: typeof d.queued === "number" ? d.queued : 0,
        skippedDuplicate: typeof d.skippedDuplicate === "number" ? d.skippedDuplicate : 0,
        note: typeof d.note === "string" ? d.note : undefined,
      },
    };
  } catch (err) {
    const status = httpStatus(err);
    if (status === 409 || status === 404) {
      return {
        kind: "unavailable",
        message: serverMessage(
          err,
          "Automatic discovery isn't switched on in this environment, so there's nothing to run by hand."
        ),
      };
    }
    if ((err as { code?: string })?.code === "ECONNABORTED") {
      return {
        kind: "error",
        message:
          "The search ran longer than 90 seconds and we stopped waiting. It may still be finishing on the server — refresh the queue in a minute before running it again.",
      };
    }
    return { kind: "error", message: serverMessage(err, "The search could not be run.") };
  }
}
