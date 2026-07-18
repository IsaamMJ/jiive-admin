# Handoff → jiive-backend — Customer Feedback (log + feed + export)

**Date:** 2026-07-18
**From:** jiive-admin (frontend)
**Verified against:** `origin/dev` — `prisma/schema.prisma` (`CallLog`, line 746), the live `/calls` endpoints.

## What this is

A lightweight **feedback log**, replacing the "Feedback Calls" queue framing. Feedback arrives from
anywhere — in person, phone, or WhatsApp — often unprompted. The operator logs it against any customer in
their own words. The team reads the feed when they have time; periodically it's **exported and fed to an
AI** to surface themes and improvements. That export path is the whole point, so the data must be clean and
aggregatable.

**Deliberately NOT in v1:** no queue, no CSAT score, no call ceremony, no in-app AI, no incremental
watermark, no rolling digest. Those earn their way in *after* we confirm the logging habit forms. Build the
smallest thing.

## Storage — reuse `call_logs`, add one column

A feedback entry is a `CallLog` row with **`disposition = "remark"`** (already exists: note-only,
non-terminal, no CSAT, excluded from CSAT stats) plus one new field:

- **Add `channel String?`** to `CallLog` (`@map("channel")`). Values: `"in_person" | "call" | "text"`.
  Plain string + a TS enum, per house convention. Additive migration, nullable (existing rows have none).

`queueReason` is currently required. Unprompted feedback has no queue reason — **accept `"manual"`** as a
valid `queueReason` value for these entries (or make the column nullable; `"manual"` is cleaner for filtering).

Everything else is already on the model: `userId`, `bookingId?`, `incidentId?`, `notes`, `tags[]`,
`calledByAdminId` (attribution, stamped server-side from the token), `createdAt`.

## Endpoints (all under `/api/v1/admin`, `RolesGuard` + `@Roles('admin')`, `identify()` for the actor)

### 1. `POST /feedback`
Body: `{ userId, channel, notes, tags?, bookingId?, incidentId? }`
- `userId` required; `channel` one of the three; `notes` required, non-empty (trimmed).
- Server stamps `calledByAdminId`/`calledByLabel` from the token, sets `disposition="remark"`,
  `queueReason="manual"`, `createdAt=now()`.
- Reject unknown keys with a clear 400 (the strict-schema behaviour you already have).
- Returns the created row: `{ id, createdAt, channel, userId, notes, tags }`.

### 2. `GET /feedback` — the feed
Query: `limit` (default 50), `offset`, `from?`, `to?` (ISO, filter on `createdAt`), `channel?`, `tag?`, `userId?`.
- Returns **only manual feedback** (`disposition="remark"` with a `channel` set) — NOT call-queue
  dispositions. Newest first.
- Shape: `{ total, feedback: [{ id, createdAt, channel, userId, userName, notes, tags, loggedByLabel, bookingId?, incidentId? }] }`
- `userName` resolved from the user; `loggedByLabel` = the admin who logged it.

### 3. `GET /feedback/export` — CSV download
Query: `from?`, `to?`, `includePii?` (**default false**).
- Returns `text/csv` with `Content-Disposition: attachment; filename="feedback-<range>.csv"`.
- Columns (PII off, the default): `date, channel, feedback, tags, logged_by`.
- Columns (PII on): prepend `customer_name, phone`.
- **Default no-PII matters:** the export is fed to an external AI, and this is health-adjacent personal
  data. Theme analysis doesn't need names. CSV-escape the free-text `notes` (commas, quotes, newlines).

### Tags
Reuse `GET /incidents/meta` → `callTags`. No new tag endpoint.

### Customer picker (no backend work for v1)
The "log against any customer" search uses the existing `GET /users?limit=200`, filtered client-side.
Fine under a few hundred users. **Scale follow-up (not now):** a `GET /users?search=<name|phone>` server
endpoint once the user count outgrows a client-side filter.

## Migration
Additive only: one nullable column on `call_logs`. Standard `prisma migrate`. No backfill.

## Out of scope (v1)
Queue · CSAT · attempt tracking on feedback · in-app AI summarize · incremental/watermark export · rolling
digest · server-side user search. All deferred until real usage justifies them.
