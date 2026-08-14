/**
 * `POST /rag/search` — the retrieval probe.
 *
 * WHY THIS EXISTS. A dropped passage reads as an abstraction: "23 words won't
 * be stored." This turns it into the thing that actually happens to a customer:
 * ask the question that passage answers, and see what the knowledge base says
 * INSTEAD. Silent loss does not degrade to "I don't know" — it degrades to a
 * confident neighbour.
 *
 * Verified live on dev 2026-08-10. Query = a real dropped fragment from the
 * KB's most authoritative document:
 *   "Offer tests for thyroid dysfunction to adults, children and young people
 *    with: type 1 diabetes or other autoimmune diseases…"
 * Response: wouldGroundLive 10, top hit 0.742 —
 *   "DO NOT offer testing for thyroid dysfunction solely because an adult,
 *    child or young person has type 2 diabetes."
 * The dropped rule and its top replacement are opposites. That is the argument
 * this feature is making, made out of the operator's own document.
 *
 * Read-only and on demand — ONE call per tap, never a fan-out across fragments.
 * Search is cheap but it is still a live embedding call, and a gate that fires
 * 30 requests when a dialog opens is a gate someone turns off.
 */

import api from "@/lib/api";

/** One retrieved chunk. `score` is cosine similarity, `source` a heading path. */
export interface ProbeHit {
  score: number;
  /** Whether this hit clears the live grounding threshold the assistant uses. */
  clearsLiveThreshold: boolean;
  /** Real heading path, e.g. "… › 1.2 Investigating suspected thyroid dysfunction › 1.2.7". */
  source: string;
  snippet: string;
  documentId: string;
}

export interface ProbeResult {
  /** How many hits would actually ground a live answer. 0 = the KB says nothing. */
  wouldGroundLive: number;
  threshold: number | null;
  hits: ProbeHit[];
}

/**
 * Never throws. `unavailable` (404) is kept apart from `error` for the same
 * reason it is in discovery.ts: "this build predates the endpoint" and "the
 * backend is down" call for different operator reactions, and a spinner that
 * resolves into a wrong story is worse than either.
 */
export type ProbeOutcome =
  | { kind: "ok"; result: ProbeResult }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

function httpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

function serverMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { message?: string; error?: string } } })?.response?.data;
  // Verbatim server message where there is one — never a paraphrase.
  return data?.message ?? data?.error ?? fallback;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function coerceHit(raw: unknown): ProbeHit | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const score = asNumber(r.score);
  // Without a score there is no way to say how close the substitute is, and the
  // whole point of showing a hit is its closeness. Drop the row rather than
  // render a match with no strength attached to it.
  if (score === null) return null;
  return {
    score,
    // Absent must not read as "clears" — default is the non-reassuring one.
    clearsLiveThreshold: r.clearsLiveThreshold === true,
    source: typeof r.source === "string" ? r.source : "",
    snippet: typeof r.snippet === "string" ? r.snippet : "",
    documentId: typeof r.documentId === "string" ? r.documentId : "",
  };
}

/**
 * Ask the knowledge base the question a dropped passage answers.
 *
 * Timeout is explicit: this fires from a button that shows a spinner, and
 * BUILD-CHECKLIST #3 forbids a spinner with no guaranteed end.
 */
export async function probeRetrieval(query: string): Promise<ProbeOutcome> {
  const trimmed = query.trim();
  if (trimmed === "") return { kind: "error", message: "Nothing to search for." };
  try {
    const r = await api.post<unknown>("/rag/search", { query: trimmed }, { timeout: 30_000 });
    const d = (r.data ?? {}) as Record<string, unknown>;
    const hits = Array.isArray(d.hits)
      ? d.hits.map(coerceHit).filter((h): h is ProbeHit => h !== null)
      : [];
    const wouldGroundLive = asNumber(d.wouldGroundLive);
    return {
      kind: "ok",
      result: {
        // Fall back to counting the hits that say they clear, rather than
        // asserting 0 — "the KB has nothing" is a strong claim to invent from a
        // missing field.
        wouldGroundLive: wouldGroundLive ?? hits.filter((h) => h.clearsLiveThreshold).length,
        threshold: asNumber(d.threshold),
        hits,
      },
    };
  } catch (err) {
    if (httpStatus(err) === 404) return { kind: "unavailable" };
    if ((err as { code?: string })?.code === "ECONNABORTED") {
      return { kind: "error", message: "The search took longer than 30 seconds and we stopped waiting." };
    }
    return { kind: "error", message: serverMessage(err, "The search could not be run.") };
  }
}

/** Copy for the probe, kept here so the button and its result cannot drift. */
export const PROBE_INFOTIP =
  "Runs this passage back through the knowledge base as if a customer had asked about it, and shows what comes back without it. Similarity is not correctness — a close match can be the wrong age band, the wrong test or the wrong dose.";
