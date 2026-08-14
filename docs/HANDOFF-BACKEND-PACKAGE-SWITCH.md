# Handoff → jiive-admin — the Packages screen now switches a real thing

**Date:** 2026-08-09
**From:** jiive-backend
**Status:** **LIVE ON PROD** (`4e8bad0`, 2026-08-09).
**TL;DR:** your Active toggles used to do nothing. They now switch which package every
customer is quoted and booked onto. The API is unchanged — but the semantics changed, and
the screen should change to match.

---

## What was wrong

`isActive` was decoration. Every backend caller asked the catalog for the literal testType
`'primary'`, so nothing ever asked which row was active. Toggling CARDIAC on changed
nothing; toggling PRIMARY off changed nothing either.

That is fixed. Exactly one package is live, and it drives the offer card, the price Lumi
speaks in conversation, the Razorpay amount, the Thyrocare SKU that decides which blood
panel is actually drawn, and how the results are processed.

Verified on dev end-to-end: with Primary live Lumi said *"The Bio-Age test is ₹999"*; after
flipping Combined Health live it said *"₹2,929"* on the very next conversation.

---

## The one rule: exactly one package is live

Not "at least one". Not "as many as you like". **Exactly one**, enforced inside a database
transaction rather than by the UI remembering to.

| you do | backend does |
|---|---|
| activate a package | deactivates every other row **and** activates this one, atomically |
| deactivate the only live one | **refuses** — HTTP 400 with a message you can show verbatim |
| create a package | creates it **INACTIVE**, even if you send `isActive: true`… |
| create with `isActive: true` | …then applies the exclusive switch, so it still ends up as the only live one |

The refusal message is written to be shown to the operator as-is:

> `Cannot deactivate 'combined_health': it is the only live package, and leaving none live
> would silently sell the env default. Activate another package instead — that switches
> over atomically.`

**Why "nothing live" is refused:** it does not stop sales. It silently falls through to an
env-configured default, so customers keep buying — just not the thing anyone chose. That is
worse than an error.

---

## API — no new endpoints, no shape changes

Everything below already exists and already works.

```jsonc
// Make a package live. Every other package is deactivated in the same transaction.
PATCH /api/v1/admin/packages/:testType   { "isActive": true }

// Deactivate. 400s if it is the only live one.
PATCH /api/v1/admin/packages/:testType   { "isActive": false }
DELETE /api/v1/admin/packages/:testType          // same thing, same refusal

// Create. Lands INACTIVE unless you explicitly pass isActive:true.
POST /api/v1/admin/packages
{
  "testType": "combined_health",        // lowercase [a-z0-9_]+, immutable once created
  "displayName": "Combined Health",
  "pricePaise": 292900,                 // PAISE. 292900 = ₹2,929
  "thyrocareSkuId": "COMHECHPA",
  "skuType": "SSKU"                     // OFFER | SSKU | PSKU
}
```

`isActive` is no longer an ordinary column write — it is routed through the exclusive
switch. If it is refused, **nothing else in that PATCH is written either**, so you never
get a half-applied edit. One request, one clear error.

---

## What we'd like the screen to become

Today it renders six rows with six independent toggles, which implies you can pick any
combination. You can't, and now the backend will actively refuse.

**A radio group, or a single "Live package" card with a switcher.** Whatever you prefer —
the point is that "exactly one" should be visible in the UI, not discovered through a 400.

Two smaller things:

- **Re-fetch the list after a switch.** Activating one deactivates the others server-side,
  so the other rows are stale until you reload. Right now they'd keep showing their old
  state.
- **Surface the 400 message verbatim.** It explains the refusal better than "something went
  wrong", and it tells the operator what to do instead.

Not blocking — the current toggles do work, they just look wrong for a beat after a switch.

---

## Two traps worth putting in the UI

**1. `skuType` must change with the SKU.** `PROJ1062813` is `OFFER`; a package SKU is
usually `SSKU`. Get it wrong and **Thyrocare rejects the order after the customer has
already paid** — it lands in Stuck Bookings with `lastOrderError`. We do not validate the
SKU against Thyrocare's catalog on save (Isaam gets SKUs directly from them and checks
them), so the UI is the last place a typo can be caught. Worth a confirm step showing the
SKU and type together before saving.

**2. Price is in PAISE.** `292900`, not `2929`. A missing pair of zeros is a 100× pricing
error in the direction that costs money.

---

## One behaviour change you should know about

If the catalog cannot be read at all — a database outage — the backend now **refuses to
book and declines to quote a price**, rather than falling back to a default package.

That is deliberate (Isaam's call): someone booked onto Combined Health because they asked
for it must never receive a bio-age panel because a query blipped. A delayed booking is
recoverable; blood drawn for the wrong panel is not. Customers see *"I couldn't confirm the
test details just now — give me a moment and try again. Nothing has been charged."*, and
ops gets an alert.

The Packages screen itself is unaffected — it reads the catalog directly.

---

## Also fixed on the way

While tracing this we found a latent defect in the family-booking path: it stamped the
catalog value `'primary'` onto `Booking.testType`, which the results pipeline does not
recognise as a bio-age. A completed family booking would have produced a results page with
markers and **no age at all**, for someone who paid for a bio-age.

It had never fired — dev held 14 such bookings and every one was expired, prod held none —
so it was latent rather than live. It would have fired on the first family booking that
completed on prod. Fixed in the same change.

---

Questions to isaamm@jiive.ai.
