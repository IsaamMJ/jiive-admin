# Handoff → jiive-backend — full user purge (right to erasure)

**Date:** 2026-07-27
**From:** jiive-admin (frontend)
**Severity:** compliance feature (DPDP right-to-erasure). Irreversible — needs care.

## The ask

A new endpoint that **erases a person's data** on request — heavier than
`clear-history` (which only wipes chat/AI state). One account is a household, so
this erases the account and everyone under it.

```
DELETE /users/:phone/purge
{ "confirm": true, "reason"?: "<optional audit note>" }
```

### Erase (all PII)

- Name, phone/whatsapp id
- All conversations
- AI memories
- Result **values / report content** (see retention note below)
- Saved addresses
- Family members
- Credit balance
- Incomplete / unpaid bookings

### Keep — deliberately, these must survive the purge

Deleting these would break the law or re-harm the user, so a purge must **not**
remove them:

1. **A de-identified stub of completed *paid* orders** — amount + date + order id,
   **no PII**. Financial/GST record-keeping requires retaining transaction records
   for years; a completed sale can't just vanish. Strip it to an anonymous
   skeleton, don't delete it.
2. **The phone-hash opt-out / suppression flag** — if the person had unsubscribed,
   the do-not-contact record must persist (keyed on a hash of the phone, not the
   phone itself) so a future re-import can't message them again.

If your data model makes either of these hard, tell us — but erasing them is the
one thing this feature must not do.

### Behaviour

- **`confirm: true` required** (same as clear-history). Without it → 400.
- **Audit it server-side**: who purged, when, the `reason`, and a count of what was
  erased. A right-to-erasure action must itself be logged (the log holds no PII —
  just "user <internal id> purged by <admin> on <date>").
- Idempotent-ish: purging an already-purged / unknown phone → a clean
  `{ success: false, error: "User not found" }` (200), not a 500.
- Response:
  ```jsonc
  {
    "success": true,
    "erased": { "conversations": 12, "memories": 3, "results": 2, "bookings": 1, "addresses": 1, "familyMembers": 2 },
    "retained": { "paidOrderStubs": 2, "optOut": true }
  }
  ```

## Frontend status

Built and shipped on the Debug page, **gated OFF** (`PURGE_SUPPORTED = false`) until
this endpoint exists. Guardrails already in place: a separate card, the erase-vs-keep
breakdown shown up front, a **type-the-phone-number-again-to-confirm** arm step, and
a final confirmation dialog. Flip one constant when the endpoint is live and confirm
the response shape above (or tell us yours and we'll match).
