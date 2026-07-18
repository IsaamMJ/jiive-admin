# Handoff → jiive-backend — expose the result report link on the admin Results tab

**Date:** 2026-07-18
**From:** jiive-admin (frontend)
**Scope:** `GET /users/:id` → `results[]`, rendered on the user detail page's Results tab.

## What we want

Each result row on the admin Results tab should have a **button to open that result's report** — the same
shareable `<cloudfront>/r/<token>` link the customer gets on WhatsApp — so an operator opens it in one click
instead of hunting for the link in the conversation.

## The gap

The report link isn't in the admin results payload. Verified in code
(`admin.controller.ts` user-detail results `select`, ~line 1162): it returns
`id, testType, calculatedAge, chronologicalAge, ageDelta, status, elevatedFlag, overflowCapped,
formulaVersion, retestReminderOptIn, retestReminderSentAt, createdAt` — **no token, no URL.**

The link exists in the DB as a separate `ResultToken` (`{ resultId, token, expiresAt, viewCount }`,
created with a 30-day expiry when the report is generated, `admin.controller.ts:2783`), but it's never
joined into the results response. So the frontend has nothing to link to.

## The ask

Include a **`reportUrl`** (full, ready-to-open) on each result in `GET /users/:id`:
- Resolve the result's **latest non-expired `ResultToken`** and return
  `reportUrl: "<REPORT_BASE_URL>/r/<token>"` (the same base the WhatsApp report link uses —
  `d3pvjhguhk37b0.cloudfront.net` in the sample). Return the **full URL**, not the bare token, so the
  frontend doesn't have to know the base or construct it.
- If a result has **no valid (non-expired) token**, return `reportUrl: null`. The frontend then shows no
  button (or a subtle "no report link" state) for that row — it must not render a dead/expired link.

That's the whole change — one nullable field on the existing results select. No new endpoint.

## Frontend (once `reportUrl` ships)

Trivial: each Results row with a non-null `reportUrl` gets an "Open report ↗" button that opens it in a new
tab (`target="_blank" rel="noopener noreferrer"`) — the same pattern just shipped for links in the
conversation view.

## Note
If a result can legitimately have multiple valid tokens, return the most recently created non-expired one.
Don't return an expired token — opening it would 404/expire-page the operator.
