// ─────────────────────────────────────────────────────────────────────────────
// Money — rupees ↔ paise, in exactly ONE function
//
// Money is paise everywhere internally; humans see rupees. Before this file the
// conversion existed TWICE in page.tsx (savePrice() and submitAdd()), both as a
// bare `Math.round(parseFloat(x) * 100)`. Two copies of a conversion is how a
// 100× bug gets fixed in one place and left standing in the other, so both call
// sites now route through parseRupees() and there is no other `* 100` in the
// module.
//
// A misplaced decimal point is the one money error a human genuinely cannot see
// by eye — ₹99900 and ₹9990.0 look alike at a glance. The defence is not a
// prettier input; it is showing the operator the integer that actually goes on
// the wire (see the paise echo in SwitchPanelDialog / the inline price editor).
// ─────────────────────────────────────────────────────────────────────────────

declare const PAISE: unique symbol;

/**
 * An integer number of paise. Branded so it cannot be produced by arithmetic —
 * `pricePaise: someRupees * 100` does not typecheck. The ONLY mint is
 * parseRupees(); the only other way in is fromServerPaise(), which is explicit
 * about the fact that it is trusting the server's own integer.
 */
export type Paise = number & { readonly [PAISE]: true };

/**
 * The server already stores paise, so a value read off GET /packages is a Paise
 * by definition. Named rather than cast inline so every trust boundary is
 * greppable.
 */
export const fromServerPaise = (n: number): Paise => n as Paise;

/**
 * Accepts: "999", "999.5", "2929.00", "₹2,929", " 2929 ".
 * Rejects: "", "1e5", "-5", "999abc", "1.005", "12345678".
 *
 * ROUNDING BEHAVIOUR — THERE IS NONE, AND THAT IS DELIBERATE.
 * The old code did `Math.round(parseFloat(x) * 100)`, which is wrong three ways
 * and all three are reachable from the existing UI:
 *
 *   1. parseFloat("999abc") === 999. A typo with a trailing character is
 *      silently accepted as a different price than the operator can see.
 *   2. parseFloat("1e5") === 100000, i.e. ₹100,000 typed as four characters.
 *      <input type="number"> accepts exponent notation, so this is not
 *      hypothetical — it is one fat-fingered "e" away.
 *   3. 1999.99 * 100 === 199998.99999999997 in IEEE-754. Math.round hides it
 *      here, but only because the error happens to land under half a paise.
 *
 * We reject a third decimal rather than rounding it. Silently turning
 * "2929.999" into ₹2,930.00 hides a typo in the one field where the typo is the
 * whole problem — and this price is what a real customer is charged. Splitting
 * on the decimal point and doing integer arithmetic removes the float entirely.
 *
 * The 7-digit cap is ₹99,99,999 — far above any real panel, low enough that a
 * stuck key produces a refusal instead of a charge.
 */
const CLEAN = /^\d{1,7}(\.\d{1,2})?$/;

export type ParsedRupees =
  | { ok: true; paise: Paise }
  | { ok: false; reason: string };

export function parseRupees(raw: string): ParsedRupees {
  // Strip only presentation characters the operator may have pasted in — the
  // rupee sign, thousands separators, surrounding space. Nothing else is
  // forgiven, because every other "helpful" coercion above changed the number.
  const s = (raw ?? "").replace(/[₹,\s]/g, "");
  if (s === "") return { ok: false, reason: "Enter a price in rupees." };
  if (!CLEAN.test(s)) {
    return {
      ok: false,
      reason: 'Digits only, at most 2 decimals — no "e", no minus, no symbols.',
    };
  }
  const [whole, frac = ""] = s.split(".");
  // (frac + "00").slice(0, 2) pads "5" → "50", so "999.5" is ₹999.50 and not
  // ₹999.05. Getting this backwards is a 10× error on the paise.
  const paise = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return { ok: true, paise: paise as Paise };
}

/**
 * Table/label formatter. Byte-identical to the helper that was already in
 * page.tsx and to app/stuck-bookings/types.ts — kept rather than "improved" so
 * the price shown here matches the price shown on every other screen.
 * Drops a trailing .00 (₹999, not ₹999.00).
 */
export const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * Receipt formatter — ALWAYS two decimals. Used in the confirm dialog and the
 * post-write outcome, where "₹999" vs "₹999.00" being visually different from
 * the table is a feature: a receipt should look like a receipt, and a trailing
 * ".00" that never disappears makes a truncated number obvious.
 */
export const rupeesExact = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * Paise → the string we put IN the edit box. Must round-trip:
 * parseRupees(rupeeInputFromPaise(p)).paise === p for every non-negative
 * integer p. Uses integer division rather than /100 so no float is ever formed.
 */
export function rupeeInputFromPaise(paise: number): string {
  const whole = Math.floor(paise / 100);
  const frac = paise % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0")}`;
}

/**
 * How big is this price change? Returned as a plain ratio so the confirm can
 * say "×2.93" rather than making the operator divide two numbers in their head.
 *
 * `null` when the old price is 0 — a ratio against zero is infinite, and
 * rendering "×∞" is noise. An absent ratio must never read as "small change":
 * every caller that hides a ratio MUST still render the absolute delta, and
 * needsMagnitudeGate() below treats an unknown ratio as gate-worthy rather than
 * as a pass. (Until 2026-08-05 this comment claimed the delta covered the zero
 * case while both confirm surfaces gated the delta on `ratio !== null`, so
 * ₹0 → ₹99,900 was the ONLY large move on the screen with no friction at all
 * and no number shown. An unknown ratio is not a small one.)
 */
export function priceRatio(fromPaise: number, toPaise: number): number | null {
  if (fromPaise <= 0) return null;
  return toPaise / fromPaise;
}

/**
 * The magnitude gate. A 100× slip (₹999 typed as ₹99900, or the reverse) is the
 * error class that survives every other check in this screen: it is a valid
 * number, a valid price, and it verifies as landed. It is also the only one a
 * human cannot spot by reading the field back.
 *
 * Fires at ×10 or more in either direction. Deliberately rare — a gate that
 * fires on every save becomes muscle memory in a week and then protects nobody.
 *
 * IT MUST BE ON EVERY PATH THAT MOVES A PRICE. It used to live only inside
 * SwitchPanelDialog, while the pencil in the price column PATCHed straight from
 * a keystroke — so the shortest, most obvious way to reprice the live package
 * was the one route with none of this. The identical keystroke was stopped at
 * ×130 in the dialog and waved through in the table. page.tsx now imports this.
 *
 * fromPaise === 0 is GATED, not skipped: priceRatio() cannot express that move
 * as a number, and "we can't measure how big this is" is a reason for more
 * ceremony, not less.
 */
export const MAGNITUDE_GATE_FACTOR = 10;

export function needsMagnitudeGate(fromPaise: number, toPaise: number): boolean {
  if (fromPaise === toPaise) return false;
  const r = priceRatio(fromPaise, toPaise);
  // Unknown ratio (old price was 0 or negative) → treat as large. See above.
  if (r === null) return true;
  return r >= MAGNITUDE_GATE_FACTOR || r <= 1 / MAGNITUDE_GATE_FACTOR;
}
