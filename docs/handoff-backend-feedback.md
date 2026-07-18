# Handoff → jiive-backend — Customer Feedback (per-customer living note, AI-organized)

**Date:** 2026-07-18 (supersedes the earlier v1 in this file)
**From:** jiive-admin (frontend)
**Verified against:** `origin/dev` — `prisma/schema.prisma` (`CallLog`, line 746), the live `/calls` endpoints, `GET /users`.

## What this is

A feedback log where the operator **clicks a customer, dumps whatever they know in a paragraph, and the
AI organizes it** into a clean, readable note. Come back later, dump more, and the AI folds it into the
same note and improves it. So each customer builds **one living, AI-organized feedback note** over time.
The team reads these; periodically the whole set is exported and fed to an AI for themes/improvements.

**Where it lives:** a dedicated Feedback page (not the customer profile).

### The non-negotiable

**Every raw dump is stored append-only and kept verbatim, forever.** The AI-organized text is a *derived
view on top* — never the only copy. "AI improves it" means the AI rewrites, and a rewrite can silently drop
a detail the operator typed; the raw dumps are the recovery path. Same principle as the knowledge base:
keep the source, let AI assist, never let AI be the sole record of the truth.

### Two more guardrails

- **The dump saves instantly; the AI organizes AFTER, in the background, best-effort.** If the AI is slow or
  down, the raw dump is already saved and readable — the organized view catches up later or on retry. **AI
  must never block or fail the save.**
- The AI organize step must **preserve every fact and invent nothing** — it groups and tidies, it does not
  summarize away or embellish.

## Storage

**1. Raw dumps — reuse `call_logs`.** Each dump is a `CallLog` row with `disposition = "remark"` (already
exists: note-only, non-terminal, no CSAT, excluded from CSAT stats) plus:
- **Add `channel String?`** (`in_person | call | text`) — additive, nullable, plain string + TS enum.
- Accept `queueReason = "manual"` for these (or make the column nullable).
- `userId`, `bookingId?`, `notes` (the raw dump), `calledByAdminId` (stamped from token), `createdAt` — all already present. Append-only; never edited or deleted.

**2. Organized note — NEW table `feedback_summaries`** (one row per customer):
- `userId` (unique FK → User), `organizedText` (the AI-organized note), `organizedAt` (when last regenerated),
  `sourceDumpCount` (how many raw dumps it was built from — lets the UI show "organizing…" when a newer dump
  isn't reflected yet), `organizeStatus` (`ok | pending | failed`).

## Endpoints (`/api/v1/admin`, `RolesGuard` + `@Roles('admin')`, actor via `identify()`)

### 1. `POST /feedback` — log a raw dump
Body: `{ userId, channel, notes, bookingId? }` (`notes` required, non-empty; reject unknown keys with a 400).
- Stores the raw dump immediately, stamps actor + `createdAt`, returns it: `{ id, createdAt, channel, userId, notes }`.
- **Then kicks off the AI organize for that customer in the background** — the response does NOT wait for it.

### 2. `GET /feedback/customers` — the feed (customers with feedback)
Query: `limit`, `offset`, `from?`, `to?`, `channel?`, `search?`.
- Newest-activity first: `{ total, customers: [{ userId, userName, lastDumpAt, dumpCount, organizedPreview, organizeStatus }] }`.
- `organizedPreview` = first ~200 chars of the organized note (for the feed row).

### 3. `GET /feedback/customers/:userId` — the living note
- `{ userName, organizedText, organizedAt, organizeStatus, dumps: [{ id, createdAt, channel, notes, loggedByLabel }] }`.
- `dumps` newest-first — the raw record, always available under the organized view.

### 4. `POST /feedback/customers/:userId/organize` — (re)run the AI organize
- On-demand refresh / retry when the background organize failed or the operator wants it re-run.
- Returns the refreshed `{ organizedText, organizedAt, organizeStatus }`. Best-effort: on AI failure, return
  `organizeStatus: "failed"` with the last-good `organizedText` intact — never 500 the caller, never wipe the note.

### 5. `GET /feedback/export` — CSV download
Query: `from?`, `to?`, `includePii?` (**default false**), `mode?` (`dumps` | `organized`, default `dumps`).
- `text/csv`, `Content-Disposition: attachment`. Default no-PII (`date, channel, feedback, logged_by`); PII on
  prepends `customer_name, phone`. `organized` mode exports one row per customer's organized note instead.
- **Default no-PII matters:** the CSV is fed to an external AI, this is health-adjacent personal data, and
  theme analysis doesn't need names. CSV-escape the free text.

## The AI organize step

- **Input:** all raw dumps for the customer, chronological, each with its channel + date.
- **Output:** one organized note — grouped by theme (service, phlebo, results, pricing, requests…), every
  fact from every dump preserved, channel/date retained where useful, nothing invented or dropped.
- **Runs:** in the background after each `POST /feedback`, and on demand via endpoint 4. Uses your existing
  LLM infrastructure. Idempotent — re-running over the same dumps yields the same organized note.
- **Failure is survivable:** raw dumps are untouched; the note shows the last-good version + a `failed` flag;
  a retry (endpoint 4, or the next dump) tries again.

### Tags / customer picker
- Tag chips (optional) reuse `GET /incidents/meta → callTags`.
- Customer picker uses existing `GET /users?limit=200` (verified: returns `{ users: [{id, name, whatsappPhone}] }`),
  filtered client-side. Server-side `?search=` is a scale follow-up, not now.

## Migrations
Additive: one nullable column on `call_logs` (`channel`) + one new table (`feedback_summaries`). No backfill.

## Retention
Raw dump `notes` are health-adjacent — apply the **same 12-month scrub** you already do for call notes. When
a customer's dumps are scrubbed, regenerate (or clear) their organized note so it can't outlive its sources.

## Out of scope (still)
No queue, no CSAT, no attempt tracking, no incremental/watermark export, no rolling cross-customer digest
(the export→external-AI path covers themes for now). These come later if usage justifies them.
