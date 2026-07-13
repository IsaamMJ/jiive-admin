"use client";

import { useEffect, useState } from "react";
import { getIncidentMeta } from "../api";
import { FALLBACK_META, type IncidentMeta } from "../types";

/**
 * The server's enum vocabulary, fetched once per session and shared by every
 * consumer (the list filters, the file dialog, the detail page) so opening the
 * file dialog doesn't re-hit /incidents/meta.
 *
 * Never rejects. If the call fails we fall back to the local constants in
 * types.ts and report `degraded: true`. That matters: the whole point of filing
 * is that it takes under a minute, and a form with no category chips in it
 * because a meta lookup 404'd is a form nobody can file with. A degraded
 * vocabulary is survivable; an unusable form is not.
 */
type MetaResult = { meta: IncidentMeta; degraded: boolean };

let cached: Promise<MetaResult> | null = null;

function loadMeta(): Promise<MetaResult> {
  if (!cached) {
    cached = getIncidentMeta()
      .then((meta) => ({ meta, degraded: false }))
      .catch(() => {
        // Don't cache the failure — a later mount should be free to try again
        // rather than being stuck on the fallback for the rest of the session.
        cached = null;
        return { meta: FALLBACK_META, degraded: true };
      });
  }
  return cached;
}

export function useIncidentMeta(): MetaResult {
  const [result, setResult] = useState<MetaResult>({ meta: FALLBACK_META, degraded: false });

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
