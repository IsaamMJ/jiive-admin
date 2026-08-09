import type { Package } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Which package is LIVE — and what the server would actually sell if the answer
// were not exactly one.
//
// ── WHAT CHANGED (backend 4e8bad0, 2026-08-09) ──────────────────────────────
// `isActive` used to be decoration. Every booking-flow caller asked the catalog
// for the literal testType 'primary' (PackageService's deleted
// `getActiveOrFallback(testType)`), so nothing ever asked which row was active —
// toggling CARDIAC on changed nothing, and toggling PRIMARY off changed nothing
// either. That is why this screen shipped six independent on/off switches: at
// the time, any combination really was harmless, because none of them meant
// anything.
//
// It means something now. EXACTLY ONE package is live, enforced inside a
// database transaction (PackageService.activate, package.service.ts:205 —
// deactivate-the-rest and activate-this-one in one `$transaction`). The live row
// drives the offer card, the price Lumi speaks in conversation, the Razorpay
// amount, the Thyrocare SKU that decides which blood panel is physically drawn,
// and — via bookingTestTypeFor() — how the results are processed.
//
// ── WHY THIS FILE EXISTS RATHER THAN AN `x.filter(p => p.isActive)[0]` ──────
// Because "not exactly one" has two distinct meanings and neither of them is
// "nothing is being sold". Both are states the SERVER handles by continuing to
// take money, so a UI that renders either as a blank or as an error would be
// telling the operator the opposite of what is happening.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE SERVER'S OWN TIE-BREAK, copied deliberately rather than inferred.
 *
 * `PackageService.getLivePackage()` (package.service.ts:145-150) selects the
 * active rows with `orderBy: [{ displayOrder: 'asc' }, { testType: 'asc' }]` and
 * serves `active[0]`.
 *
 * The ADMIN LIST endpoint sorts differently — `PackageService.list()`
 * (package.service.ts:126-130) uses `[{ displayOrder: 'asc' }, { displayName:
 * 'asc' }]`, i.e. displayName, not testType. So in the multi-live case "the
 * first row in this table" and "the row customers are being sold" are NOT the
 * same question, and answering the second with the first would name the wrong
 * package on the one screen where naming the wrong package is the whole risk.
 * Two rows sharing a displayOrder is all it takes for the two orders to differ.
 */
function serverOrder(a: Package, b: Package): number {
  if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
  return a.testType < b.testType ? -1 : a.testType > b.testType ? 1 : 0;
}

export type LiveState =
  /** The normal, enforced state. */
  | { kind: "one"; row: Package }
  /**
   * NOT "no package configured", and NOT "sales are stopped".
   *
   * package.service.ts:164-174: zero active rows falls through to `envFallback()`
   * — the env-configured SKU and BIOAGE_CUSTOMER_PRICE_PAISE — and raises the
   * `no_live_package` ops alert. Customers keep buying; they just buy something
   * nobody on this screen chose, at a price this screen cannot read. The backend
   * refuses to let an admin reach this state (deactivate() throws), so seeing it
   * means the seed has not run or somebody edited the database directly.
   */
  | { kind: "none" }
  /**
   * package.service.ts:176-188: more than one active row is "should be
   * unreachable" — activate() is transactional — but a direct DB edit or a failed
   * migration could produce it. The server does not refuse; it serves the
   * deterministic first and raises `multiple_live_packages`. So we must name
   * WHICH one is actually being sold, not merely report the count.
   */
  | { kind: "many"; rows: Package[]; served: Package };

export function liveState(packages: Package[]): LiveState {
  const rows = packages.filter((p) => p.isActive);
  if (rows.length === 0) return { kind: "none" };
  if (rows.length === 1) return { kind: "one", row: rows[0] };
  // Sort a COPY. `packages` is the array React is rendering from; sorting it in
  // place would reorder the table as a side effect of reading it.
  const served = [...rows].sort(serverOrder)[0];
  return { kind: "many", rows, served };
}

/** The row customers are being sold, or null when nothing on this list is. */
export function servedRow(packages: Package[]): Package | null {
  const s = liveState(packages);
  return s.kind === "one" ? s.row : s.kind === "many" ? s.served : null;
}

/**
 * What `Booking.testType` becomes for a package — mirrored verbatim from
 * `bookingTestTypeFor()` (package.service.ts:61-63).
 *
 * This is not cosmetic. `ResultsPipelineService` routes on the BOOKING value:
 * `'biological_age'` runs the PhenoAge scoring and produces a biological age;
 * ANY other value takes the generic path, which stores every marker and renders
 * a results page with no age on it. So making a non-`primary` package live
 * changes what a completed booking's results page contains, and it does so
 * silently — there is no error anywhere in that path.
 *
 * Note the direction of the claim: this tells you which ROUTE a result takes. It
 * says nothing about whether the panel's markers actually cover the nine PhenoAge
 * inputs — that is bioage.ts's question, and its answer for an unmatched SKU is
 * "we can't check", never "it works".
 */
export function bookingTestTypeFor(packageTestType: string): string {
  return packageTestType === "primary" ? "biological_age" : packageTestType;
}

/** True when going live on `to` changes whether results are scored as a bio-age. */
export function bioAgeRoutingChanges(from: Package | null, to: Package): boolean {
  if (!from) return bookingTestTypeFor(to.testType) === "biological_age";
  return bookingTestTypeFor(from.testType) !== bookingTestTypeFor(to.testType);
}
