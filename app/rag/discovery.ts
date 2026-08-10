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
import type { DiscoveredDocument, DiscoverRunResponse, DocStatus, RagDocument } from "./types";

// ── Provenance: who put this document in the knowledge base ──────────────────
//
// ✅ THE ID-SET WORKAROUND IS GONE (removed 2026-08-10).
//
// It used to fetch `/rag/discovered`, build a Set of its `documentId`s and
// subtract that from the main list, because `GET /rag/documents` returned only
// `{documentId, title, chunkCount, status, updatedAt}` and a discovered row was
// byte-for-byte indistinguishable from an uploaded one.
//
// Backend c795d8a puts `sourceUrl` / `discoveredVia` / `discoveryQuery` on the
// row itself, so the split is now made from the row. Two real bugs die with the
// workaround:
//   1. It depended on a second request, so a failed `/rag/discovered` meant no
//      split at all.
//   2. `/rag/documents` is capped at 500 (DOCS_LIST_CAP), so a discovered
//      document sitting outside that window could never be matched.
//
// ⚠️ DEV / PROD ASYMMETRY — DELETE THE `unknown` BRANCH WHEN THIS IS SETTLED.
//
// Verified live 2026-08-10 against BOTH environments. Contrary to the earlier
// handoff, prod is NOT behind here — all three keys are present in both:
//   DEV  (jiive-dev.isaam.dev)  7 rows. 3 carry sourceUrl +
//        discoveredVia:"exa" + discoveryQuery:"tsh"; the other 4 carry all
//        three keys with explicit null.
//   PROD (d3pvjhguhk37b0…)      4 rows. All four carry the keys, all null.
// Cross-check: the ids the old id-Set produced on dev
//   {7dc4d16f…, 7e8c4baf…, b7a896b5…}
// are exactly the ids with a non-null `sourceUrl`, and on prod both methods
// yield the empty set. The replacement is behaviour-identical in both
// environments and costs one fewer request.
//
// The `unknown` branch below therefore describes a deployment that predates
// c795d8a — a rollback, or a third environment. It is currently unreachable and
// has never been observed; it exists so that a rollback degrades honestly
// instead of silently presenting machine-fetched clinical content as something
// a human chose to upload. Delete it once a rollback is impossible.

/**
 * What the row says about its own origin.
 *
 * `unknown` is a first-class variant and NOT merged into `uploaded`. Those are
 * different facts:
 *   unknown  → this server cannot tell us where the document came from.
 *   uploaded → this server checked, and a human put it here.
 * Collapsing them turns "we don't know" into "a human chose this", which is the
 * exact shape of the bug this whole module guards against.
 */
export type Provenance =
  | { kind: "unknown" }
  | { kind: "uploaded" }
  | { kind: "discovered"; sourceUrl: string; via: string | null; query: string | null };

/**
 * Read one row's provenance.
 *
 * Distinguishes an ABSENT key from a PRESENT-BUT-NULL value, which is the only
 * way to tell "the server has no opinion" from "the server says a human
 * uploaded it". `in` is deliberate — `doc.sourceUrl == null` cannot see the
 * difference and would silently answer the wrong question.
 */
export function readProvenance(doc: RagDocument): Provenance {
  const hasField = "sourceUrl" in doc || "discoveredVia" in doc;
  if (!hasField) return { kind: "unknown" };
  const sourceUrl = typeof doc.sourceUrl === "string" && doc.sourceUrl.trim() !== "" ? doc.sourceUrl : null;
  const via = typeof doc.discoveredVia === "string" && doc.discoveredVia.trim() !== "" ? doc.discoveredVia : null;
  // Either signal is enough to call it machine-found. Requiring both would let a
  // row with a sourceUrl but no channel fall through into "uploaded", which is
  // the reassuring reading and therefore the wrong default.
  if (!sourceUrl && !via) return { kind: "uploaded" };
  return {
    kind: "discovered",
    // A discovered row with no usable URL still gets rendered as discovered; the
    // row-level UI says the publisher is unreadable rather than dropping the
    // provenance entirely.
    sourceUrl: sourceUrl ?? "",
    via,
    query: typeof doc.discoveryQuery === "string" && doc.discoveryQuery.trim() !== "" ? doc.discoveryQuery : null,
  };
}

/**
 * The split of the main documents list.
 *
 * `available: false` means this server does not mark provenance at all, so the
 * split CANNOT be made. In that case `uploaded` holds every row unfiltered —
 * and the caller must say so on screen. A list that looks filtered but isn't is
 * strictly worse than an honestly unfiltered one, because it quietly presents
 * clinical content nobody has read as something a human selected.
 */
export interface DocPartition {
  available: boolean;
  uploaded: RagDocument[];
  discovered: RagDocument[];
}

export function partitionDocs(docs: RagDocument[]): DocPartition {
  // An empty list needs no capability claim: there is nothing hidden either way,
  // so this is reported as available with two empty lists rather than as a
  // failure the operator has to interpret.
  if (docs.length === 0) return { available: true, uploaded: [], discovered: [] };
  // One row carrying the field proves the server sends it. Probing "any row"
  // rather than "every row" matters because the backend omits nothing per-row —
  // it either has the columns or it doesn't.
  const available = docs.some((d) => "sourceUrl" in d || "discoveredVia" in d);
  if (!available) return { available: false, uploaded: docs, discovered: [] };
  const uploaded: RagDocument[] = [];
  const discovered: RagDocument[] = [];
  for (const doc of docs) {
    (readProvenance(doc).kind === "discovered" ? discovered : uploaded).push(doc);
  }
  return { available: true, uploaded, discovered };
}

/** Shown next to the split so the mechanism is never a mystery. */
export const PARTITION_NOTE =
  "The server now stamps each document with where it came from, so this split is read straight off the row rather than guessed in the browser.";

/** Shown INSTEAD of the split when the server doesn't stamp provenance. */
export const PARTITION_UNAVAILABLE_NOTE =
  "This server doesn't record where a document came from, so uploaded and auto-discovered documents cannot be told apart. Everything is listed together below — treat any row as possibly machine-fetched and unread.";

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

// ── The discovered queue is a PROVENANCE list, not a review queue ────────────

/**
 * Split the discovered rows by whether a human still has to look at them.
 *
 * ⚠️ `GET /rag/discovered` HAS NO STATUS FILTER. `listDiscovered`
 * (`jiive-backend/src/modules/rag/rag-document.service.ts:641-654`) selects on
 * `discoveredVia IS NOT NULL` and nothing else, so an approved document stays in
 * this list forever. It answers "what did a machine put here", not "what is
 * waiting for you".
 *
 * The page treated `discovered.length` as the waiting count, and every aggregate
 * on the screen inherited it. Live on DEV 2026-08-10, `/rag/discovered` returned
 * three rows, ALL `status: "ready"` — 77, 28 and 4 chunks, long since approved
 * and live in the knowledge base — and the UI said:
 *
 *   "3 auto-discovered documents waiting … Nobody has read them yet."
 *   "Nobody has read these. … Read each one before approving it"
 *   an amber tab badge reading 3
 *
 * Zero documents were unread. The row-level status pill told the truth, so a
 * careful reader could tell; no aggregate on the page could. That is a counter
 * that is permanently wrong in the alarming direction, which is worse than one
 * that is absent: when a genuinely unread document does arrive it shows as 3→4
 * on a number the operator has already been trained to ignore — the exact
 * failure this queue exists to prevent.
 *
 * The LIST is deliberately not filtered. Those approved rows are the record of
 * what a machine put into the knowledge base without anyone reading it, and that
 * record is the point. Only the counts and the wording change.
 */
export interface DiscoveredCounts {
  /** Awaiting a human decision. The only number that may be called "waiting". */
  awaiting: number;
  /** Already approved and live in the KB. Nothing to do. */
  approved: number;
  /** Still being parsed, or failed. Not actionable yet, and not read either. */
  notReady: number;
}

export function countDiscovered(docs: Array<{ status: string }>): DiscoveredCounts {
  let awaiting = 0;
  let approved = 0;
  let notReady = 0;
  for (const d of docs) {
    if (d.status === "pending_review") awaiting++;
    else if (d.status === "ready") approved++;
    else notReady++;
  }
  return { awaiting, approved, notReady };
}
