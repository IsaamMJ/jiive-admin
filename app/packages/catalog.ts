import { apiHost, fetchCatalogPage, serverMessage } from "./api";
import type { CatalogSku } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Thyrocare's SKU catalog — a HELPER, never a validator
//
// THE RULE THIS FILE EXISTS TO ENFORCE: the catalog may never gate what the
// operator is allowed to type into thyrocareSkuId.
//
// Thyrocare's two sources contradict each other about what a SKU's id is.
// Their email to the founder, verbatim:
//       SKU NAME - COMBINE HEALTH CHECK PACKAGE
//       SKU ID   - COMHECHPA
// Their own catalog API, which we pass through unmapped (thyrocare.service.ts
// fetchCatalog does `return res.data`):
//       { id: "COMBINE HEALTH CHECK PACKAGE", name: "COMBINE HEALTH CHECK
//         PACKAGE", type: "SSKU", aliases: [] }
// "COMHECHPA" appears NOWHERE in the catalog — verified 2026-08-05 by walking
// all 966 prod rows: not as an id, not as a name, not as an alias, not even as a
// substring. A screen that refused ids absent from the catalog would refuse the
// exact value the lab told the founder to use. Over-validating here IS the bug.
//
// So the catalog is used for exactly two things, both advisory:
//   1. reading skuType when we can find the SKU (so it can't be mistyped), and
//   2. reading testsIncluded[].code for bio-age coverage.
// It never blocks, and a failure to find something is reported as "we couldn't
// check", never as "that's wrong".
//
// SHAPE NOTES, all confirmed live on 2026-08-05:
//   - 291 of 966 prod rows have id === name (the SSKUs return the human name in
//     the id field), so matching must consider name and aliases too.
//   - Prod has 966 rows / 964 unique ids (ALDOS and DREN appear twice); dev has
//     538 rows / 477 unique ids. `id` is NOT a React key and NOT a Map key
//     without de-duping first.
//   - Dev and prod are DIFFERENT catalogs. PROJ1062813 (prod's live primary) is
//     absent from dev entirely. Nothing here may be tested on dev and assumed
//     for prod.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A catalog row with the bulk stripped out. See CatalogTest in types.ts for why
 * test names are dropped.
 */
export interface SlimSku {
  id: string;
  name: string;
  aliases: string[];
  type: string;
  noOfTestsIncluded: number;
  /** Only `code` survives — it is all coverage needs. */
  testsIncluded: { code: string }[];
  /**
   * What the LAB charges us, in RUPEES, as a STRING (Thyrocare's units, not
   * ours). Our own pricePaise is an integer in paise. Never do arithmetic
   * across the two without converting — that is a 100× waiting to happen.
   */
  sellingPriceRupees: string | null;
  /** `null` on many rows. Null is UNKNOWN, never "no fasting needed". */
  isFastingRequired: boolean | null;
  /**
   * Some SKUs require 2 or 3 people on a single order ({"min":"2"}), which a
   * single-patient booking cannot satisfy. Null when unstated.
   */
  minBeneficiaries: number | null;
}

export type CatalogState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; skus: SlimSku[] }
  /**
   * One state, three triggers: the 200-with-{error} shape, a non-array skuList,
   * or a network failure. They collapse together because the operator's options
   * are identical in all three — and because the alternative (rendering an
   * outage as "no SKUs found") is the absent-signal-as-assurance bug.
   */
  | { status: "down"; reason: string };

const PAGE_SIZE = 200;
/** Prod is 5 pages at this size. The cap only exists so a broken `nextPage`
 *  can't spin forever; it is not a real limit. */
const MAX_PAGES = 25;

function toSlim(raw: CatalogSku): SlimSku {
  const rate = raw.rate ?? {};
  const min = Number(raw.beneficiaries?.min);
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    aliases: Array.isArray(raw.aliases) ? raw.aliases.filter((a) => typeof a === "string") : [],
    type: String(raw.type ?? ""),
    noOfTestsIncluded: Number(raw.noOfTestsIncluded ?? 0),
    testsIncluded: Array.isArray(raw.testsIncluded)
      ? raw.testsIncluded
          .map((t) => ({ code: String(t?.code ?? "") }))
          .filter((t) => t.code !== "")
      : [],
    sellingPriceRupees: rate.sellingPrice != null ? String(rate.sellingPrice) : null,
    isFastingRequired:
      typeof raw.flags?.isFastingRequired === "boolean" ? raw.flags.isFastingRequired : null,
    minBeneficiaries: Number.isFinite(min) && min > 0 ? min : null,
  };
}

/** sessionStorage key. Carries the API host for the same reason journal.ts does:
 *  dev and prod hold different catalogs, and a shared cache would answer a prod
 *  question with dev's data. */
function cacheKey(): string {
  return `jiive.packages.catalog.v1::${apiHost()}`;
}

function readCache(): SlimSku[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(cacheKey());
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as SlimSku[]) : null;
  } catch {
    return null;
  }
}

function writeCache(skus: SlimSku[]): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(cacheKey(), JSON.stringify(skus));
  } catch {
    // Quota or private mode. The catalog still works this session; it just
    // re-fetches next time. Never surfaced — a cache miss is not an operator
    // problem.
  }
}

/**
 * Fetch the whole catalog, honouring `isLastPage`/`nextPage`.
 *
 * A single pageSize=2000 request would work today (the server has no cap and
 * returns all 966 rows in ~1s), but the paged walk costs nothing extra and
 * survives Thyrocare adding a cap later. `page` and `pageSize` are the ONLY
 * query params the route binds (admin.controller.ts:2972-2989) — there is no
 * server-side search, which is why the picker filters client-side.
 */
export async function loadCatalog(): Promise<CatalogState> {
  const cached = readCache();
  if (cached) return { status: "ready", skus: cached };

  const all: SlimSku[] = [];
  let page = 1;

  try {
    for (let i = 0; i < MAX_PAGES; i++) {
      const body = await fetchCatalogPage(page, PAGE_SIZE);

      // THE 200-WITH-{error} SHAPE. admin.controller.ts:2985 catches an upstream
      // failure and returns { error, details } with a 200 and no skuList. Live
      // example (pageSize=0): {"error":"Request failed with status code 400",
      // "details":{"errors":[{"code":"INVALID_REQUEST","message":"Invalid page
      // size"}]}}. `res.ok` is true. Reading `skuList ?? []` here would render a
      // total Thyrocare outage as an empty catalog.
      if (!Array.isArray(body?.skuList)) {
        return {
          status: "down",
          reason: body?.error ?? "Thyrocare's catalog returned no SKU list.",
        };
      }

      all.push(...body.skuList.map(toSlim));

      if (body.isLastPage) break;
      const next = body.nextPage;
      // A missing/!advancing nextPage would loop forever on the same page.
      if (typeof next !== "number" || next <= page) break;
      page = next;
    }
  } catch (e) {
    return {
      status: "down",
      reason: serverMessage(e, (e as Error)?.message || "Couldn't reach Thyrocare's catalog."),
    };
  }

  // Zero rows is indistinguishable from an outage, and the safe reading of an
  // ambiguous signal is "unknown". Thyrocare having genuinely zero SKUs is not a
  // real state; a silently-empty response is.
  if (all.length === 0) {
    return { status: "down", reason: "Thyrocare's catalog came back empty." };
  }

  // De-dupe on the full identity, not on id — prod has two byte-identical ALDOS
  // rows and dev has 61 duplicated rows. Left un-deduped the operator sees the
  // same SKU twice in the picker.
  const seen = new Set<string>();
  const unique = all.filter((s) => {
    const k = `${s.id} ${s.name} ${s.type}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  writeCache(unique);
  return { status: "ready", skus: unique };
}

// ── Matching ────────────────────────────────────────────────────────────────

/** Trim, collapse internal whitespace, uppercase. Applied to both sides. */
export function norm(s: string): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

export type MatchReason = "id" | "name" | "alias";

export interface SkuMatch {
  sku: SlimSku;
  reason: MatchReason;
  /** True when the row's id and name are the same string — expected for 291 of
   *  966 prod rows, and NOT a data problem worth alarming the operator about. */
  idEqualsName: boolean;
  /**
   * True when the typed string is NOT this row's id — i.e. we found the SKU by
   * its name or an alias, and the catalog's own id for it is something else.
   *
   * THIS IS THE FIELD THAT STOPS A REJECTED ORDER. The dialog sends the string
   * the operator TYPED as thyrocareSkuId, and thyrocare.service.ts:1235-1241
   * puts that exact string on the order as both `id` and `name`. So a match by
   * name reads the type and the bio-age markers off PROJ1062813 and then ships
   * "PRIMARY HEALTH" to the lab. Live prod counts, walked 2026-08-05: 675 of 966
   * rows have id !== name, and all 147 alias arrays are just the name again —
   * so this is the common case, not a corner. Every surface that would otherwise
   * render a green "verified" must degrade when this is true.
   */
  typedIsNotTheId: boolean;
  /**
   * How many catalog rows answer to the same name/alias. 49 prod names map to
   * more than one id (AAROGYAM XL is both PROJ1043920 and PROJ1045582), so on a
   * name match the type and test list we show may belong to a different SKU than
   * the operator means. >1 means we cannot imply a single answer.
   */
  ambiguousCount: number;
}

/**
 * Lenient match: by id, then name, then any alias, all case-insensitively and
 * whitespace-collapsed. Returns WHAT it matched on, because "matched by name"
 * and "matched by id" mean different things to an operator deciding whether to
 * trust the id they were given.
 *
 * Deliberately NOT implemented: any acronym or fuzzy heuristic that would map
 * COMHECHPA → COMBINE HEALTH CHECK PACKAGE. It would be right often enough to be
 * trusted and wrong often enough to be lethal, and the wrongness only surfaces
 * after the customer has paid.
 */
export function matchSku(skus: SlimSku[], typed: string): SkuMatch | null {
  const q = norm(typed);
  if (q === "") return null;

  const pack = (sku: SlimSku, reason: MatchReason, ambiguousCount: number): SkuMatch => ({
    sku,
    reason,
    idEqualsName: norm(sku.id) === norm(sku.name),
    // Computed from the TYPED string, not from the reason, so it stays true
    // even if the match order below is ever rearranged.
    typedIsNotTheId: norm(sku.id) !== q,
    ambiguousCount,
  });

  const byId = skus.find((s) => norm(s.id) === q);
  if (byId) return pack(byId, "id", 1);

  // Reaching here PROVES the typed string is not any row's id.
  const byName = skus.filter((s) => norm(s.name) === q);
  if (byName.length > 0) return pack(byName[0], "name", byName.length);

  const byAlias = skus.filter((s) => s.aliases.some((a) => norm(a) === q));
  if (byAlias.length > 0) return pack(byAlias[0], "alias", byAlias.length);

  return null;
}

/**
 * Substring search for the picker. Capped by the caller — the server has no
 * search param at all, so this runs over the whole in-memory catalog.
 */
export function searchSkus(skus: SlimSku[], query: string, limit = 50): SlimSku[] {
  const q = norm(query);
  if (q === "") return [];
  const out: SlimSku[] = [];
  for (const s of skus) {
    if (
      norm(s.id).includes(q) ||
      norm(s.name).includes(q) ||
      s.aliases.some((a) => norm(a).includes(q))
    ) {
      out.push(s);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Up to `n` near matches to offer as suggestions when nothing matched exactly.
 *  Offered as suggestions ONLY — the typed string is never silently rewritten. */
export function nearMatches(skus: SlimSku[], typed: string, n = 3): SlimSku[] {
  return searchSkus(skus, typed, n);
}

/** A stable React key. `id` alone is not unique — see the de-dupe note above. */
export const skuKey = (s: SlimSku, i: number) => `${s.id} ${s.type} ${i}`;
