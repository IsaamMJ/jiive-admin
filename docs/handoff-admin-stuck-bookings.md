# Handoff — Admin "Stuck Bookings" management (jiive-admin UI)

**For the jiive-admin frontend session.** The backend is built, tested, and being
deployed to prod (jiive-backend branch `feat/admin-stuck-bookings`, commit
`efdabe7`). This doc is everything you need to build the UI.

**Purpose:** let the operator self-serve paid-but-unplaced bookings from the admin
console (no manual DB/ECS work, no log-reading). A "stuck booking" = customer PAID
but no Thyrocare lab order was placed (prepaid wallet empty, slot filled, missing
data, etc.).

---

## Background (the incident this solves)

On 2026-06-20 a customer booked all 6 packages in one cart (₹10,096). The Thyrocare
prepaid wallet ran dry mid-batch, so only 2 of 6 placed; the rest sat at
`payment_completed` with no lab order. Today the only way to see/fix that is reading
CloudWatch logs and hand-calling endpoints. This feature surfaces those stuck
bookings + lets the operator Retry / Reschedule / Cancel them from the console.

---

## Backend changes already shipped

- New booking fields `last_order_error` / `last_order_error_at` — the classified
  reason a placement failed, persisted so the UI shows **WHY** without logs.
  Populated at the single choke point (`createForBooking`), cleared on success.
- 3 new admin endpoints (below). **Cancel** and **slot lookup** reuse existing endpoints.

---

## Endpoints

**Base:** `https://d3pvjhguhk37b0.cloudfront.net/api/v1/admin`
**Auth:** the admin **session bearer token** the console already uses to log in.
The mutation endpoints are `@Roles('admin')` + `RolesGuard` — a static
`ADMIN_TOKEN` will NOT work on them; a logged-in admin session will. (Same auth as
the existing booking endpoints you already call.)

### 1. List stuck bookings — `GET /bookings/stuck`
Read-only. Returns paid bookings with no lab order.
```jsonc
{
  "count": 2,
  "bookings": [
    {
      "id": "d5227265-…",
      "patientName": "Mohamed Jahir",
      "testType": "endocrine",
      "status": "payment_completed",          // or awaiting_reschedule_choice
      "appointmentDate": "2026-06-21T00:00:00.000Z",
      "appointmentTime": "08:00",
      "appointmentSlotId": "1",
      "paymentBatchId": "23b66701-…",         // null for single bookings
      "thyrocareCreateAttempts": 2,            // auto-retries burned (cap 6)
      "lastOrderError": "thyrocare_system_error: Insufficient Balance",
      "lastOrderErrorAt": "2026-06-20T11:57:24.000Z",
      "amount": 199900,                        // paise
      "createdAt": "2026-06-20T11:57:24.000Z",
      "user": { "whatsappPhone": "919489601444", "name": "Mohamed Jahir" },
      "address": { "pincode": "629001", "city": "Nagercoil" }
    }
  ]
}
```

### 2. Retry placement — `POST /bookings/:id/retry-order`
No body. Re-places via the canonical path (correct SKU, patient DOB, and it sends
the customer their booking-confirmation message). Use after a wallet top-up to
place immediately instead of waiting for the 30-min reconciliation cron.
```jsonc
// success
{ "success": true, "orderId": "VL1D9908", "leadId": "SP857…" }
// still failing (wallet still short / slot now full / missing data)
{ "success": false, "reason": "thyrocare_slot_unavailable",
  "message": "Given slot is not available. Please select available slot" }
// guard (already placed)
{ "error": "Booking already has a Thyrocare order", "orderId": "VL…" }
```

### 3. Reschedule + place — `POST /bookings/:id/reschedule-slot`
Body: `{ "date": "2026-06-21", "time": "08:20", "slotId": "2" }` (`slotId` optional).
Moves a stuck booking to a new slot **and** places the order there — for the "slot
filled before placement" case, no full customer re-book.
```jsonc
{ "success": true, "rescheduledTo": { "date": "2026-06-21", "time": "08:20" },
  "orderId": "VL…", "leadId": "SP…" }
// or { "success": false, "rescheduledTo": {…}, "reason": "...", "message": "..." }
// validation: { "error": "date must be YYYY-MM-DD" } / { "error": "time must be HH:mm" }
// guard: refuses if the booking already has a lab order
```

### 4. Cancel — reuse `POST /bookings/:id/patch`
Body: `{ "status": "cancelled" }`. Already exists, already admin-session gated.
Stamps `cancelledBy`. Stops the reconciliation cron from retrying it.

### 5. Available slots (for the Reschedule picker) — reuse `GET /thyrocare/slots`
`GET /thyrocare/slots?pincode=629001&date=2026-06-21`
```jsonc
{ "pincode": 629001, "date": "2026-06-21",
  "slots": [ { "id": "2", "time": "08:20", "label": "08:20 - 08:40", "recommended": true }, … ] }
```

---

## Suggested UI

A **Stuck Bookings** view (poll `GET /bookings/stuck`, e.g. every 30–60s or on open):

| Patient | Test | Slot | Why stuck | Tries | Actions |
|---|---|---|---|---|---|
| Mohamed Jahir | Endocrine | 21 Jun 08:00 | 🟠 Insufficient Balance | 2/6 | **Retry** · **Reschedule ▾** · **Cancel** |

- **Why stuck** — map `lastOrderError`:
  - contains `Insufficient Balance` → 🟠 "Wallet empty — top up, then Retry"
  - contains `slot is not available` → 🔴 "Slot full — Reschedule"
  - contains `missing_address` / `missing_dob` → ⚪ "Missing data — fix profile"
  - null → "Not yet attempted"
- **Retry** → `POST retry-order`; on `success:false` show `message`, refresh the row.
- **Reschedule ▾** → `GET /thyrocare/slots?pincode&date` for the booking's pincode +
  date, show open slots, on pick → `POST reschedule-slot`.
- **Cancel** → confirm dialog → `POST patch {status:cancelled}`, remove from list.
- Group rows by `paymentBatchId` so a multi-test cart's stuck tests show together.

---

## Notes / guardrails
- Retry & Reschedule **place real Thyrocare orders + debit the prepaid wallet** —
  they're admin-session gated and audited server-side
  (`[AUDIT] retry-order` / `reschedule-stuck`). A confirm dialog before each is wise.
- Both refuse if the booking already has a lab order (idempotent / no double-book).
- This is the recovery half (operator-driven). The prevention half (low-wallet
  alert + earlier failure alerts) is separate backend work, not part of this UI.
- `amount` is in paise — divide by 100 for ₹.
