# Handoff → jiive-backend — selective "Clear User History" (+ a live bug)

**Date:** 2026-07-26
**From:** jiive-admin (frontend)

## 0. Live bug we just fixed on our side (FYI, no action)

`DELETE /users/:phone/clear-history` now requires `{ confirm: true }` for the
destructive op — but the admin was still calling it with no body, so **Clear
History was 400-ing for everyone** (`"confirm: true required for destructive
operations"`). We now send `confirm: true`. Flagging in case other callers exist.

## 1. The ask — let the operator clear only some categories

Today the endpoint clears all three (conversations, memories, flow states). We
want checkboxes so an operator can clear, say, just flow states (to re-test an
onboarding path) without nuking the AI's memories.

The UI is built but **locked to all-three** because the endpoint doesn't honor a
selection yet — and it **silently ignores** unknown body keys rather than
rejecting them (confirmed live: `{confirm:true, scopes:['conversations']}` and
`{confirm:true, memories:false}` both return 200 and clear everything). That makes
partial-select unsafe to ship: untick "memories" and it gets wiped anyway. So we
gated it off until you honor it.

### Proposed contract

Accept per-scope booleans in the body alongside `confirm`:

```jsonc
DELETE /users/:phone/clear-history
{
  "confirm": true,
  "conversations": true,
  "memories": false,
  "flowStates": true
}
```

- **All omitted → clear all three** (backwards compatible; today's behaviour).
- Any present → clear only the ones set `true`; leave `false`/omitted ones alone.
- Response keeps the existing shape, and `cleared` should reflect **only what was
  actually cleared**:
  ```jsonc
  { "success": true, "cleared": { "conversations": 12, "memories": 0, "flowStates": 3 } }
  ```

### One thing that would make it bulletproof

Right now unknown keys are silently ignored. If instead the endpoint **echoed the
scopes it honored** (or rejected unknown ones), the frontend could detect support
and never mis-clear. Not required — we're gating with a flag — but it's the kind
of silently-accepted-param that already bit us on `cancelledBy`.

## Frontend status

Checkboxes + a confirm dialog listing exactly what will be removed are built and
shipped, currently locked to all-three. Flipping one constant
(`SCOPED_CLEAR_SUPPORTED`) activates them the moment the contract above is live.
Confirm the body shape and we unlock.
