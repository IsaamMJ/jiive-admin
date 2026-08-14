# Handoff → jiive-backend — make incident order IDs OPTIONAL

**Date:** 2026-07-18
**From:** jiive-admin (frontend)
**Priority:** blocking — an operator cannot file a real incident right now.

## The problem

`POST /incidents` **requires at least one order ID** (`affectedOrderIds` — verified: an empty array or an
omitted field is a 400 *"at least one Thyrocare order ID is required"*). But many real incidents have **no
order**, and the operator is currently blocked from filing them. Live example that triggered this:

> *"No available testing slots for pincode 629001 due to phlebo leave"* — a systemic availability issue.
> No customer could book, so there is no order to attach. It cannot be filed.

Whole classes of legitimate incidents have no order: no-slots / availability, app or backend outages,
systemic process failures, and **near-misses (S0)** caught before any order existed — which are exactly the
cheap-lesson incidents the log is meant to capture.

## The ask

**Make `affectedOrderIds` / `orderIds` optional on `POST /incidents`** — accept an empty array or an omitted
field, and file the incident with no linked orders.

- When orders ARE given: unchanged — resolve them, expand the payment batch, pull in customer/context.
- When NONE are given: file a standalone incident. `affectedOrderIds: []`, no resolved bookings/customer,
  empty context. The severity/category/vendor/alert/scorecard logic is unaffected.
- A **bogus** order ID should still fail loudly (unknown-ID 400) — that check stays. It's only the
  *at-least-one* requirement that should go.

That's the whole change: drop the min-1 constraint; keep everything else.

## Frontend

Already updated to match: the file form no longer requires an order ID (the "add at least one order ID"
block is gone), and order selection is presented as optional. Until this backend change ships, filing an
order-less incident will still hit the backend's 400 — so this is the gating item.
