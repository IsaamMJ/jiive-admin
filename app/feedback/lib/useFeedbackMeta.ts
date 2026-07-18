"use client";

import { useEffect, useState } from "react";
import { getFeedbackMeta } from "../api";
import { EMPTY_FEEDBACK_META, type FeedbackMeta } from "../types";

/**
 * The server's feedback tag vocabulary, fetched once per session and shared by
 * every consumer — same pattern as app/calls/lib/useCallMeta.ts, reading the same
 * GET /incidents/meta (which carries `callTags`).
 *
 * Never rejects. If the call fails we report `degraded: true` and an empty tag
 * list. The list is NOT faked (see FeedbackMeta.tags): a made-up tag would either
 * 400 on save or, worse, write a value that never aggregates with the server's,
 * corrupting the only number the export produces. A degraded log dialog shows no
 * chips and says why; free-text notes still work.
 */
type MetaResult = { meta: FeedbackMeta; degraded: boolean };

let cached: Promise<MetaResult> | null = null;

function loadMeta(): Promise<MetaResult> {
  if (!cached) {
    cached = getFeedbackMeta()
      .then((meta) => ({ meta, degraded: false }))
      .catch(() => {
        // Don't cache the failure — a later mount should be free to try again
        // rather than being stuck on the empty list for the rest of the session.
        cached = null;
        return { meta: EMPTY_FEEDBACK_META, degraded: true };
      });
  }
  return cached;
}

export function useFeedbackMeta(): MetaResult {
  const [result, setResult] = useState<MetaResult>({ meta: EMPTY_FEEDBACK_META, degraded: false });

  useEffect(() => {
    let cancelled = false;
    loadMeta().then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return result;
}
