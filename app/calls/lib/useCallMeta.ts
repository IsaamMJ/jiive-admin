"use client";

import { useEffect, useState } from "react";
import { getCallMeta } from "../api";
import { FALLBACK_CALL_META, type CallMeta } from "../types";

/**
 * The server's call vocabulary (dispositions, queue reasons, tags, attempt cap),
 * fetched once per session and shared by every consumer — same pattern as
 * app/incidents/lib/useIncidentMeta.ts, reading the same GET /incidents/meta.
 *
 * Never rejects. If the call fails we fall back to the local constants and report
 * `degraded: true`. That matters: the seven disposition buttons are the entire
 * feature, and a call screen with no buttons on it because a meta lookup failed
 * is a call that doesn't get logged. Dispositions and queue reasons are fixed by
 * the contract, so the fallback is safe — the tag list is NOT faked (see
 * CallMeta.tags), so a degraded screen shows no chips and says why.
 */
type MetaResult = { meta: CallMeta; degraded: boolean };

let cached: Promise<MetaResult> | null = null;

function loadMeta(): Promise<MetaResult> {
  if (!cached) {
    cached = getCallMeta()
      .then((meta) => ({ meta, degraded: false }))
      .catch(() => {
        // Don't cache the failure — a later mount should be free to try again
        // rather than being stuck on the fallback for the rest of the session.
        cached = null;
        return { meta: FALLBACK_CALL_META, degraded: true };
      });
  }
  return cached;
}

export function useCallMeta(): MetaResult {
  const [result, setResult] = useState<MetaResult>({ meta: FALLBACK_CALL_META, degraded: false });

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
