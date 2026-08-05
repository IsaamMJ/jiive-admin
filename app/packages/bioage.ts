// ─────────────────────────────────────────────────────────────────────────────
// Bio-age (PhenoAge) coverage for a Thyrocare SKU
//
// MIRRORED VERBATIM FROM THE BACKEND. Source of truth:
//   jiive-backend/src/modules/thyrocare/xml-parser.service.ts
//     :51   PHENOAGE_TEST_CODE_MAP
//     :100  REQUIRED_BIOMARKERS
//
// IF THAT MAP CHANGES, THIS FILE MUST CHANGE WITH IT. There is no import path
// between the two repos, so nothing will tell you — the only symptom is this
// screen quietly disagreeing with the pipeline about whether a panel works.
// Do not "tidy" the fallback entries away: they are load-bearing precisely
// because Thyrocare's codes have varied before.
//
// WHAT THIS CAN AND CANNOT TELL YOU — read before trusting a verdict.
// The map was built from report-XML TEST_CODEs. We apply it here to the
// catalog's order-side testsIncluded[].code. Those are the same vocabulary in
// every case checked so far, but they are not guaranteed to be. Consequence:
//   - a FULL verdict is a POSITIVE match on all nine and is trustworthy;
//   - a shortfall means "we did not match these", NOT "the lab does not run
//     these". It is a lower bound.
// So coverage errs toward over-warning, and the action we offer on a shortfall
// is "check with Thyrocare", never a block. Over-warning costs a phone call.
// Under-warning costs every customer on that panel their result.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thyrocare TEST_CODE → canonical PhenoAge marker.
 * Verbatim copy of PHENOAGE_TEST_CODE_MAP (xml-parser.service.ts:51), including
 * its confirmed-vs-fallback grouping and the reasons attached to each.
 */
export const PHENOAGE_TEST_CODE_MAP: Record<string, string> = {
  // Confirmed from sample XML
  SCRE: "creatinine",
  FBS: "glucose",

  // Confirmed from Adhish's SKU catalog 2026-05-14
  SALB: "albumin",
  HSCRP: "crp",
  ALKP: "alp",

  // Fallback codes (in case Thyrocare XML uses a variant)
  ALB: "albumin",
  ALBUMIN: "albumin",
  ALP: "alp",
  SGOT_ALP: "alp",
  CRP: "crp",
  HCRP: "crp",

  // CBC sub-tests (H6 panel — "HEMOGRAM - 6 PART (DIFF)").
  // CONFIRMED 2026-06-04 against a real H6 XML (prod order VLFEE773, lead
  // SP85473383). RDCV + LEUC were previously MISSING from the backend map, which
  // dropped rdw + wbc and silently degraded every PhenoAge to 7/9.
  LYMPH: "lymphocyte", // confirmed (the % — NOT the absolute count ALYM)
  MCV: "mcv", // confirmed
  RDCV: "rdw", // confirmed (RDW-CV — NOT RDWSD, which is RDW-SD)
  LEUC: "wbc", // confirmed (total leukocytes)
  // Defensive fallbacks (unconfirmed variants)
  LYMP: "lymphocyte",
  LYM: "lymphocyte",
  LYMPHOCYTE: "lymphocyte",
  RDW: "rdw",
  RDWCV: "rdw",
  "RDW-CV": "rdw",
  WBC: "wbc",
  TLC: "wbc",
  TLEUC: "wbc",
  TWBC: "wbc",
};

/**
 * All 9 PhenoAge markers, in the canonical order the results page renders them.
 * Verbatim from REQUIRED_BIOMARKERS (xml-parser.service.ts:100).
 */
export const REQUIRED_BIOMARKERS = [
  "albumin",
  "creatinine",
  "glucose",
  "crp",
  "lymphocyte",
  "mcv",
  "rdw",
  "alp",
  "wbc",
] as const;

export type Marker = (typeof REQUIRED_BIOMARKERS)[number];

/** Operator-facing names. The internal keys are lowercase pipeline identifiers. */
export const MARKER_LABEL: Record<Marker, string> = {
  albumin: "Albumin",
  creatinine: "Creatinine",
  glucose: "Glucose",
  crp: "CRP",
  lymphocyte: "Lymphocyte",
  mcv: "MCV",
  rdw: "RDW",
  alp: "ALP",
  wbc: "WBC",
};

/**
 * Normalise a catalog test code before lookup. The backend does a bare
 * .toUpperCase(); we additionally fold RDW_CV → RDW-CV so the punctuation
 * variant hits the fallback entry rather than silently missing. Widening the
 * match can only ever ADD a found marker, never invent a missing one, so it
 * cannot turn a real shortfall into a false "full".
 */
function normaliseCode(code: string): string {
  return code.trim().toUpperCase().replace(/_/g, "-").replace(/\s+/g, "");
}

function markerForCode(code: string | null | undefined): Marker | null {
  if (!code) return null;
  const up = code.trim().toUpperCase();
  const hit = PHENOAGE_TEST_CODE_MAP[up] ?? PHENOAGE_TEST_CODE_MAP[normaliseCode(code)];
  return (hit as Marker | undefined) ?? null;
}

/**
 * THE VERDICT. Three values, and the middle one does not exist.
 *
 * REQUIRED_BIOMARKERS is a CONJUNCTION, not a score. The pipeline's
 * toPhenoAgeInput() returns null if any one of the nine is absent, so a panel
 * covering 8 markers produces exactly as much biological age as one covering 0:
 * none. That is why there is no `partial` kind and why 0..8 all collapse into
 * `none`. The fraction is EVIDENCE for the verdict; it is never the verdict.
 *
 * `unknown` is a first-class outcome, not an error case. It means nobody has
 * checked — which is neither "supported" nor "not supported", and must never be
 * rendered as either.
 */
export type Coverage =
  | { kind: "full"; found: Marker[] }
  | { kind: "none"; found: Marker[]; missing: Marker[] }
  | { kind: "unknown"; why: UnknownReason };

export type UnknownReason =
  /** The id matched nothing in the catalog, so there is no test list to read. */
  | "no-match"
  /** The catalog itself is unreachable or returned its 200-with-{error} shape. */
  | "catalog-down"
  /** Matched, but Thyrocare returned an EMPTY test list for this SKU. */
  | "empty-tests"
  /** We haven't looked yet (catalog still loading). */
  | "not-checked";

/**
 * Coverage for a matched catalog row.
 *
 * THE PSKU TRAP — this is live today, not hypothetical. All 529 prod PSKUs come
 * back with `testsIncluded: []` and `noOfTestsIncluded: 0`. Dev's currently
 * configured primary package is FBS/PSKU, which is one of them. Computing
 * "0 of 9" from an empty list would render "no bio-age" for the package that is
 * live on dev right now — while FBS is literally in the map above as `glucose`.
 * The catalog simply cannot answer for these rows, so an empty test list is
 * UNKNOWN and never zero.
 *
 * Partial mitigation, applied below: for PSKUs the SKU id IS a test code (FBS,
 * SCRE, CRP, HSCRP, ALKP, SALB, TLEUC all match the map directly). That is still
 * only ever a lower bound of 1, so it cannot produce a `full` verdict on its
 * own — it stays `unknown`, and the UI says what it did manage to learn.
 */
export function coverageForSku(
  // Structural, not the SlimSku type, so bioage.ts stays independent of
  // catalog.ts — coverage is pure marker arithmetic and must be unit-testable
  // without a catalog in hand.
  sku: { testsIncluded?: { code: string }[] } | null | undefined,
): Coverage {
  if (!sku) return { kind: "unknown", why: "no-match" };

  const tests = sku.testsIncluded;
  if (!Array.isArray(tests) || tests.length === 0) {
    return { kind: "unknown", why: "empty-tests" };
  }

  const found = new Set<Marker>();
  for (const t of tests) {
    const m = markerForCode(t?.code);
    if (m) found.add(m);
  }

  const foundList = REQUIRED_BIOMARKERS.filter((m) => found.has(m));
  const missing = REQUIRED_BIOMARKERS.filter((m) => !found.has(m));

  if (missing.length === 0) return { kind: "full", found: [...foundList] };
  return { kind: "none", found: [...foundList], missing: [...missing] };
}

/**
 * The one thing we can still say about an unmatched SKU: whether the id itself
 * happens to be a PhenoAge test code. Returns the marker or null.
 *
 * Used ONLY to add a "we did learn this much" line under an `unknown` verdict.
 * It must never upgrade `unknown` to a positive answer — knowing one of nine is
 * not knowing nine of nine, and the distance between them is the customer's
 * entire result.
 */
export function markerFromSkuIdItself(skuId: string): Marker | null {
  return markerForCode(skuId);
}

/** Plain-language headline. Binary by design — see the Coverage doc comment. */
export function coverageHeadline(c: Coverage): string {
  if (c.kind === "full") return "Bio-age: AVAILABLE";
  if (c.kind === "none") return "Bio-age: NOT AVAILABLE";
  return "Bio-age: UNKNOWN";
}
