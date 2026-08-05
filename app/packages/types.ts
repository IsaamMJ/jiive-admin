import type { Paise } from "./money";

// ─────────────────────────────────────────────────────────────────────────────
// The /packages backend contract, and the four live traps it carries
//
// Source of truth (read, not guessed):
//   jiive-backend/src/modules/admin/admin.controller.ts
//     :3732  PackagePatchSchema — the Zod schema for PATCH
//     :3744  serializePackage() — DB column `price` → API field `pricePaise`
//     :3865  PATCH returns serializePackage(row), i.e. the FULL updated row
//   jiive-backend/src/modules/thyrocare/thyrocare.service.ts
//     :1151  the order sends thyrocareSkuId as BOTH `id` and `name`
//
// All paths below are relative to the axios base, which ALREADY carries
// /api/v1/admin (lib/api.ts:5). Backend handoff docs quote "/admin/packages…";
// writing that here would produce /api/v1/admin/admin/packages and a 404.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A package row exactly as GET /packages and PATCH /packages/:testType return
 * it. `pricePaise` is the API name; the Prisma column behind it is `price`.
 * That rename is the origin of trap 2 — see PackagePatchBody.price below.
 */
export interface Package {
  testType: string;
  displayName: string;
  description?: string | null;
  pricePaise: number;
  thyrocareSkuId: string;
  skuType: string;
  requiresFasting: boolean;
  fastingHours: number;
  isActive: boolean;
  displayOrder: number;
  updatedAt: string;
}

/**
 * THREE values, not two.
 *
 * The handoff doc lists only OFFER and SSKU. The Zod enum at
 * admin.controller.ts:3732 accepts OFFER | SSKU | PSKU, and the live prod
 * catalog is 147 OFFER / 290 SSKU / 529 PSKU — PSKU is the single largest
 * group. A picker built from the doc would be unable to express the majority of
 * Thyrocare's catalog.
 */
export const SKU_TYPES = ["OFFER", "SSKU", "PSKU"] as const;
export type SkuType = (typeof SKU_TYPES)[number];

export const isSkuType = (v: string): v is SkuType =>
  (SKU_TYPES as readonly string[]).includes(v);

/**
 * TRAP 1 — the SKU id and its type travel together, or not at all.
 *
 * PackagePatchSchema is z.object() with EVERY field .optional(). So
 * `PATCH { thyrocareSkuId: "COMHECHPA" }` returns 200, changes the id, and
 * KEEPS the previous skuType: "OFFER". A new SSKU id wearing the old OFFER type
 * is rejected by Thyrocare at order placement — which happens AFTER Razorpay has
 * already taken the customer's money. The customer is charged for a booking that
 * can never be fulfilled.
 *
 * The API will not enforce the pairing. This union does: an object with
 * `thyrocareSkuId` and no `skuType` is not assignable, so the dangerous body is
 * unconstructible rather than merely discouraged. `npx tsc --noEmit` is in the
 * definition of done, which is what makes this a real gate and not a comment.
 */
export type SkuPair =
  | { thyrocareSkuId: string; skuType: SkuType }
  | { thyrocareSkuId?: never; skuType?: never };

/**
 * Everything PATCH /packages/:testType will accept, and one thing it must never
 * be given.
 */
export type PackagePatchBody = SkuPair & {
  displayName?: string;
  description?: string;
  pricePaise?: Paise;
  requiresFasting?: boolean;
  fastingHours?: number;
  isActive?: boolean;
  displayOrder?: number;

  /**
   * TRAP 2 — TRAP GUARD. DO NOT REMOVE. DO NOT "CORRECT" THIS TO MATCH THE DOC.
   *
   * The handoff doc's example body says "price". It is wrong, and it is wrong in
   * a believable way: the Prisma column really IS `price`, and serializePackage
   * (admin.controller.ts:3750) renames it to `pricePaise` on the way out. The
   * doc leaked the column name.
   *
   * PackagePatchSchema is z.object(), NOT .strict(). An unknown key is SILENTLY
   * DROPPED and the request still returns 200 with the updated row attached. So
   * a UI written literally to the doc changes the SKU and the type, leaves the
   * OLD PRICE standing, and reports success — every customer charged ₹999 for a
   * ₹2,929 panel, with no error surfacing anywhere on either side.
   *
   * `never` turns that into a compile failure. api.ts additionally refuses it at
   * runtime (the key allowlist), and the read-back diff would catch it after the
   * fact. Three layers, because this is the worst bug this screen can ship.
   */
  price?: never;
};

/**
 * The seven fields that together define "which panel is a customer buying, and
 * for how much". Everything the switch flow reads, writes, snapshots and
 * restores is exactly this set — displayOrder and isActive are deliberately NOT
 * in it (position is cosmetic; isActive is its own guarded action).
 */
export interface PanelIdentity {
  displayName: string;
  description: string;
  thyrocareSkuId: string;
  skuType: SkuType;
  pricePaise: number;
  requiresFasting: boolean;
  fastingHours: number;
}

/** GET /packages returns an OBJECT with a `packages` key, not a bare array. */
export interface PackagesResponse {
  packages: Package[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Thyrocare catalog (GET /thyrocare/catalog?page&pageSize)
//
// We pass Thyrocare's payload through verbatim — thyrocare.service.ts
// fetchCatalog does `return res.data` with no mapping — so these are THEIR
// field names and THEIR data quality, warts included.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `name` and `groupName` are optional because we DROP them after computing
 * coverage — see catalog.ts:slim(). The full prod catalog is ~2 MB of JSON,
 * almost all of it test names we never render; keeping only `code` takes the
 * cached copy to ~110 KB, which is what makes a sessionStorage cache viable.
 * Coverage is computed from `code` alone, so nothing downstream needs the rest.
 */
export interface CatalogTest {
  name?: string;
  code: string;
  groupName?: string;
}

export interface CatalogSku {
  id: string;
  name: string;
  aliases?: string[];
  type: string;
  noOfTestsIncluded?: number;
  testsIncluded?: CatalogTest[];
  /** Undocumented but present on all 966 prod rows. `sellingPrice` is RUPEES, as
   *  a STRING — the lab's price to us. Our own pricePaise is integer paise. Two
   *  different units in two adjacent numbers; never add them. */
  rate?: {
    currency?: string;
    listingPrice?: string;
    sellingPrice?: string;
    discountPercentage?: string;
  };
  /** `min` is not always "1" — some SKUs require 2 or 3 people on one order,
   *  which a single-patient booking cannot satisfy. */
  beneficiaries?: { min?: string; max?: string; multiple?: string };
  flags?: {
    isFastingRequired?: boolean | null;
    isHomeCollectible?: boolean | null;
    isPostpaid?: boolean | null;
  };
}

/**
 * The catalog response — or, on an upstream failure, something else entirely.
 *
 * admin.controller.ts:2985 catches upstream errors and returns
 * `{ error, details }` WITH A 200 STATUS and no `skuList`. So `res.ok` is true
 * and `skuList` is undefined for a total Thyrocare outage. Code that writes
 * `data.skuList ?? []` renders "no SKUs found" for an outage — an absent signal
 * read as a positive assurance, which is the exact bug class this codebase
 * exists to avoid. Hence `skuList` is optional here: you cannot read it without
 * confronting the undefined case.
 */
export interface CatalogResponse {
  isLastPage?: boolean;
  nextPage?: number | null;
  skuList?: CatalogSku[];
  error?: string;
  details?: unknown;
}

// ── Explainer copy (InfoTips — project convention) ───────────────────────────
// Hoisted here because these are long, and because two of them are rendered in
// more than one place and must not drift apart.

export const ACTIVE_EXPLAINER =
  "Switching a package off does NOT stop bookings. The server falls back to environment config this screen cannot read (getActiveOrFallback), so customers keep being charged — we just stop knowing how much. To change what a customer pays, change the price or the SKU, not this switch.";

export const SKU_TYPE_EXPLAINER =
  "Thyrocare has three types: OFFER, SSKU and PSKU. The type is part of the order we send them, and it is not optional in practice — if you change the SKU id and leave the old type behind, Thyrocare rejects the order after the customer has already paid. When we can find the SKU in their catalog we read the type from there; when we can't, you have to tell us.";

export const PAISE_ECHO_EXPLAINER =
  "The raw number we put on the wire. Prices are stored in paise (1/100 of a rupee), so ₹2,929 is 292900. It's shown because a decimal point in the wrong place looks almost identical in rupees and is unmissable as a digit count here.";

export const BIO_AGE_EXPLAINER =
  "Bio-age needs all nine PhenoAge markers. It is all-or-nothing: a panel covering eight of them produces no biological age at all, exactly like one covering zero. So there is no such thing as partial bio-age coverage — the panel either works or it doesn't.";

export const NOT_IN_CATALOG_EXPLAINER =
  "Thyrocare's catalog API and Thyrocare's emails disagree about SKU ids. They told us in writing to use COMHECHPA, and that string appears nowhere in all 966 rows of their own catalog. So 'not in the catalog' is not evidence that an id is wrong — it only means we can't check it for you.";

export const PREVIOUS_PANEL_EXPLAINER =
  "Saved in THIS browser, not on the server. The backend logs only which field names changed on a package update, so once a row is overwritten the old values exist nowhere else. Clear your browser data, or switch device, and this is gone.";

export const SWITCH_PANEL_EXPLAINER =
  "Changes which Thyrocare panel a customer actually receives, and what they pay for it. Takes effect on the next booking; bookings already made keep the SKU and the price they were created with.";
