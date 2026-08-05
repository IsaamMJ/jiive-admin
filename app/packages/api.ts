import api from "@/lib/api";
import type {
  CatalogResponse,
  Package,
  PackagePatchBody,
  PackagesResponse,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// THE ONLY AXIOS IN app/packages/. Nothing else in this module imports
// @/lib/api — that is what makes the runtime guards below unbypassable from
// inside the module rather than merely conventional.
//
// The base URL already carries /api/v1/admin (lib/api.ts:5), so every path here
// is relative to it. The backend handoff quotes "/admin/packages"; writing that
// would produce /api/v1/admin/admin/packages and a 404.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every key PackagePatchSchema (admin.controller.ts:3732) will actually read.
 * Anything else is dropped in silence — see the throw below for why that is
 * dangerous rather than merely untidy.
 */
const PATCH_KEYS: readonly string[] = Object.freeze([
  "displayName",
  "description",
  "pricePaise",
  "thyrocareSkuId",
  "skuType",
  "requiresFasting",
  "fastingHours",
  "isActive",
  "displayOrder",
]);

/**
 * The last line of defence before the wire. Both checks exist because the
 * backend performs neither, and both failures return HTTP 200.
 */
function assertPatchBodyIsSafe(body: PackagePatchBody): void {
  // GUARD 1 (trap 2) — an unknown key.
  //
  // PackagePatchSchema is z.object(), NOT .strict(). Zod strips unknown keys
  // and the request succeeds. So `{ price: 292900, thyrocareSkuId: "X",
  // skuType: "SSKU" }` returns 200 with a row whose SKU changed and whose price
  // did NOT — and every customer is then charged the old ₹999 for the new
  // ₹2,929 panel, with a green toast on screen. Throwing here means such a body
  // never leaves the browser.
  for (const k of Object.keys(body)) {
    if (!PATCH_KEYS.includes(k)) {
      throw new Error(
        `Refusing to PATCH: "${k}" is not a field the backend reads. The Zod ` +
          `schema is z.object(), not .strict() — it drops unknown keys and still ` +
          `returns 200, so this would have looked like a success and changed ` +
          `nothing. If you meant "price", the wire field is "pricePaise".`,
      );
    }
  }

  // GUARD 2 (trap 1) — a half-sent SKU identity.
  //
  // Every field is .optional(), so sending an id without a type keeps the OLD
  // type on the new id. Thyrocare then rejects the order at placement — after
  // Razorpay has taken the money. The SkuPair union already makes this a
  // compile error; this catches the case where a body was assembled dynamically
  // and lost its type on the way.
  const hasId = "thyrocareSkuId" in body && body.thyrocareSkuId !== undefined;
  const hasType = "skuType" in body && body.skuType !== undefined;
  if (hasId !== hasType) {
    throw new Error(
      "Refusing to PATCH: thyrocareSkuId and skuType must be sent together. " +
        "Sending the id alone keeps the previous type on the new SKU, and " +
        "Thyrocare rejects that order after the customer has paid.",
    );
  }

  // GUARD 3 — an empty SKU id.
  //
  // `params.skuId || this.getSkuId()` in the order path means an empty string is
  // falsy and falls through to the environment default (FBS on dev). An empty
  // id does not fail loudly; it silently orders a different panel.
  if (hasId && body.thyrocareSkuId!.trim() === "") {
    throw new Error(
      "Refusing to PATCH: thyrocareSkuId is empty. An empty id is not ignored — " +
        "the order path falls back to the environment default SKU instead.",
    );
  }
}

/** What the read-back check concluded about a PATCH that returned 200. */
export type WriteOutcome =
  /** Every field we sent came back matching. The only green outcome. */
  | { kind: "switched"; row: Package }
  /** 200, but the row is byte-identical to what it was before. Nothing happened. */
  | { kind: "noOp"; row: Package }
  /** 200, and SOME of what we sent is not in the row. The dangerous outcome. */
  | { kind: "partial"; row: Package; drift: DriftEntry[] };

export interface DriftEntry {
  field: string;
  sent: unknown;
  stored: unknown;
}

/** Fields of a package row that decide whether anything actually changed. */
const IDENTITY_KEYS = [
  "displayName",
  "description",
  "pricePaise",
  "thyrocareSkuId",
  "skuType",
  "requiresFasting",
  "fastingHours",
  "isActive",
  "displayOrder",
] as const;

function sameRow(a: Package, b: Package): boolean {
  return IDENTITY_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

/**
 * PATCH a package and VERIFY the result field-by-field.
 *
 * THE GENERAL NET. Guards 1–3 above catch the two traps we know about; this
 * catches whatever breaks next, because it is field-name-agnostic — it simply
 * asks "is every value I sent now in the row the server handed back".
 *
 * A 200 ALONE NEVER PRODUCES A SUCCESS. That is the rule the rest of the screen
 * is built on: the caller gets a WriteOutcome, not a boolean, and `partial` is
 * rendered loudly in red rather than folded into an error toast — because in the
 * partial case the write DID land, half of it, and the operator needs to know
 * exactly which half is live.
 *
 * `before` is the row as we last saw it, used only to tell `switched` from
 * `noOp`. Pass it; without it a no-op save reports as a success and the operator
 * believes a change took effect that did not.
 */
export async function patchPackage(
  testType: string,
  body: PackagePatchBody,
  before: Package,
): Promise<WriteOutcome> {
  assertPatchBodyIsSafe(body);

  const r = await api.patch<Package>(`/packages/${testType}`, body);
  const row = r.data;

  const drift: DriftEntry[] = [];
  for (const [k, sent] of Object.entries(body)) {
    if (sent === undefined) continue;
    const stored = (row as unknown as Record<string, unknown>)[k];
    // description is the one field the server may normalise (undefined → null),
    // so compare it loosely; everything else must match exactly.
    const equal = k === "description" ? (stored ?? "") === (sent ?? "") : stored === sent;
    if (!equal) drift.push({ field: k, sent, stored });
  }

  if (drift.length > 0) return { kind: "partial", row, drift };
  if (sameRow(row, before)) return { kind: "noOp", row };
  return { kind: "switched", row };
}

/** GET /packages — note the response is an OBJECT with a `packages` key. */
export async function fetchPackages(): Promise<Package[]> {
  const r = await api.get<PackagesResponse>("/packages");
  const list = r.data?.packages;
  if (!Array.isArray(list)) {
    // Not the same as "no packages". A malformed payload must not render as an
    // empty, calm, everything-is-fine table.
    throw new Error("The server's package list came back in a shape we don't recognise.");
  }
  return list;
}

/** GET /packages/:testType — used to re-read a row after an ambiguous write. */
export async function fetchPackage(testType: string): Promise<Package> {
  const r = await api.get<Package>(`/packages/${testType}`);
  return r.data;
}

/**
 * GET /thyrocare/catalog. Returned RAW so the caller can distinguish an outage
 * from an empty result — see CatalogResponse's doc comment. Deliberately does
 * not throw on the `{ error }` shape, because that shape arrives with a 200 and
 * pretending it was a network failure would lose the server's message.
 */
export async function fetchCatalogPage(
  page: number,
  pageSize: number,
): Promise<CatalogResponse> {
  const r = await api.get<CatalogResponse>(
    `/thyrocare/catalog?page=${page}&pageSize=${pageSize}`,
  );
  return r.data;
}

export interface CreatePackageBody {
  testType: string;
  displayName: string;
  thyrocareSkuId: string;
  pricePaise: number;
  skuType: string;
  description?: string;
  requiresFasting: boolean;
  fastingHours: number;
  displayOrder: number;
  isActive: boolean;
}

/** POST /packages — 201 on success, 409 when the testType already exists. */
export async function createPackage(body: CreatePackageBody): Promise<void> {
  await api.post("/packages", body);
}

/**
 * The server's own words, or a fallback. Never a paraphrase of a message the
 * server did send.
 *
 * Both keys are checked because this API is inconsistent: a Nest exception
 * (400/404/409) serialises as `message`, while the controller's own catch blocks
 * return `error`. Reading only one of the two shows "Update failed" while the
 * server is sitting there explaining exactly what was wrong.
 */
export function serverMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { message?: unknown; error?: unknown } } })
    ?.response?.data;
  const m = data?.message ?? data?.error;
  if (typeof m === "string" && m.trim() !== "") return m;
  if (Array.isArray(m) && m.length > 0 && typeof m[0] === "string") return m.join("; ");
  return fallback;
}

/**
 * The host this admin console is talking to, e.g. "jiive-dev.isaam.dev".
 *
 * Exported so journal.ts can key its storage on it WITHOUT importing axios
 * itself — api.ts stays the module's only axios import. See journal.ts for why
 * a dev/prod-shared key would be actively dangerous rather than merely untidy.
 */
export function apiHost(): string {
  const base = api.defaults.baseURL ?? "";
  try {
    return new URL(base).host;
  } catch {
    // A relative or malformed base. Fall back to the raw string rather than a
    // constant: two different malformed bases must still produce two keys.
    return base || "unknown-host";
  }
}

/** HTTP status, or null when the request never got a response at all. */
export function statusOf(err: unknown): number | null {
  return (err as { response?: { status?: number } })?.response?.status ?? null;
}

/**
 * True when we never heard back. A timeout is NOT proof the write didn't land —
 * the request may have been applied and only the response lost. The UI must
 * offer "re-read the package", never a bare "retry".
 */
export function isNoResponse(err: unknown): boolean {
  return !(err as { response?: unknown })?.response;
}
