# Handoff → jiive-backend — a Thyrocare SERVER_TIMEOUT is being parked as a permanent failure

**Date:** 2026-08-05
**From:** jiive-admin (frontend)
**Severity:** High. A real customer's completed blood report is sitting at Thyrocare
and our system has given up on it forever, on purpose, after one attempt.

---

## The case

Order `VLC5D31A`, lead `SP86410123` — **Juveira A H, 22, female**, collected
2026-08-04 12:40 IST. Her report is ready. She has not received it.

Your own alert, verbatim:

```
REPORT_FULL retry for order VLC5D31A (event ca549298-…) hit a permanent error:
No booking found for Thyrocare orderId VLC5D31A. Parked (no further retries).
```

## What the live payload actually says

`GET /admin/thyrocare/orphan-reports/VLC5D31A`, prod, just now:

```jsonc
reportAvailable: false
reportDiagnostic: {
  step: "mint",
  kind: "http_error",
  httpStatus: 500,
  vendorBody: "{\"errors\":[{\"code\":\"SERVER_TIMEOUT\",\"message\":\"EXECUTION TIMEOUT EXPIRED.  THE TIMEOUT PERIOD ELAPSED PRIOR TO COMPLETION OF THE OPERATION OR THE SERVER IS NOT RESPONDING.\"}]}",
  ourSide: false,
  retryable: false          // ← this is the bug
}
patients: [{
  leadId: "SP86410123", name: "Juveira A H", age: 22, gender: "FEMALE",
  isReportAvailable: true,  // ← Thyrocare says the report EXISTS
  adopted: false, linkedBookingId: null
}]
```

**The payload contradicts itself.** The order-level fetch reports no report; the
patient roster inside the same response says the report is available.

## The defect

`SERVER_TIMEOUT` is classified `retryable: false`.

A timeout is the canonical *retryable* error. Thyrocare's server did not say the
order was unknown — it said it ran out of time answering. `ourSide: false` is
correct (their leg failed, not ours), but `ourSide` answers *whose network*, not
*does this order exist*, and the retry decision is being made from it.

Net effect: one slow response from the lab permanently strands a paying customer's
result, with no automatic recovery.

## What we need

1. **Treat 5xx and timeout bodies as retryable.** Any `httpStatus >= 500`, and any
   `vendorBody` carrying `SERVER_TIMEOUT` / `EXECUTION TIMEOUT` / "not responding",
   should retry with backoff. Reserve `retryable: false` for a definitive vendor
   answer — 404 / `DATA_NOT_FOUND` — where the vendor is telling us the report
   genuinely is not there.

2. **Un-park `VLC5D31A` and re-run it.** Please confirm when Juveira's result has
   been delivered — this one is not theoretical, she is waiting.

3. **Reconcile the two signals inside your own payload.** If
   `patients[].isReportAvailable` is true while `reportAvailable` is false, the
   report exists and the fetch failed. That is a strong retry signal you already
   have and are not using.

4. **Please check the same classification elsewhere.** If the REPORT_FULL webhook
   retry path shares this logic, every transient lab outage is silently converting
   into permanently stranded results across all orders, not just this one.

## What we've changed on our side

The admin was rendering `ourSide: false` as *"Thyrocare has no report for this
order… this isn't a connection problem, so retrying gives the same answer. Usually
a demo or mistyped order that never existed at Thyrocare."*

Every clause of that was wrong for this case, and it is our copy, not your data —
we owned and fixed it. The admin now classifies the vendor's actual answer
(our-failure / transient-vendor-failure / definitive-no-report), surfaces the
roster contradiction, and no longer hides the link form when the roster says the
report is available.

One thing to note: **we deliberately do not trust `retryable` any more.** We treat
it as advisory and derive retryability from `httpStatus` and `vendorBody`, because
it is demonstrably wrong for the case above. We would rather go back to trusting a
single authoritative field — tell us when it is fixed and we will.

## The pattern, for what it's worth

This is the same shape as the ones we swept last week: a field that means one thing
where it is written (`ourSide` = which network leg failed) and is read as something
else downstream (= whether the order exists), with nothing flagging the mismatch.
`retryable` then inherits the wrong answer and makes it permanent.

Questions to isaamm@jiive.ai.
