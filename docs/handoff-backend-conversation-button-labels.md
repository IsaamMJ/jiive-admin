# Handoff → jiive-backend — show button LABELS in the conversation log, not raw IDs

**Date:** 2026-07-18
**From:** jiive-admin (frontend)
**Scope:** the admin Conversations view (`GET /users/:id` → `conversations[]`, rendered on the user detail
page). Applies to **every** interactive button/list tap, in every funnel — not a per-case fix.

## The problem

When a customer taps an interactive button or picks a list option in WhatsApp, the admin conversation
shows the raw **payload ID** — `disc_know_bioage`, `confirm_name_change_yes`, `ben_rel_spouse` — instead of
the human label the customer actually saw and tapped (`🧬 Know my Bio-Age`, `Yes, update it`, `Spouse`).
It's unreadable, and it happens anywhere buttons appear.

## Root cause

On an inbound interactive reply, the message is stored with `content = <the payload id>`. But **Meta's
webhook already includes the human title** the customer tapped:
- `interactive.button_reply` → `{ id, title }`
- `interactive.list_reply` → `{ id, title, description }`

That `title` is exactly what the customer saw. It's being discarded — only the `id` is kept.

## The fix (general by construction — no per-funnel registry needed)

**1. On inbound interactive taps, persist the title Meta sends.**
Store `interactive.button_reply.title` / `interactive.list_reply.title` (+ `description` for lists) — in
`lumi_conversations.metadata` (e.g. `{ interactiveTitle, interactiveId }`), keeping `content` as-is so
nothing existing breaks. Because Meta sends the label for **every** button and list everywhere, this covers
all funnels automatically, forever, with no button dictionary to maintain.

**2. Return a display label from `GET /users/:id` conversations.**
For each message, expose a `displayLabel` (or similar) the frontend renders:
- Interactive reply with a stored title → the title.
- Historical rows that only have the id (pre-fix) → best-effort resolve the id against the known funnel
  button definitions (the `{ id, title }` arrays already in the Lumi modules — a small central lookup).
  If unknown, fall back to the raw id (honest — never guess a wrong label).
- Normal text messages → unchanged.

Keep the raw `id` available too (frontend may show it small/as a tooltip for debugging), but the primary
display is the label.

## Why NOT do this on the frontend

The button definitions live in the backend and change as the funnel evolves. A hardcoded id→label map in the
admin UI would silently drift and show **wrong** labels after any funnel change — worse than the honest id.
The backend owns the truth (and Meta hands it the title for free), so resolution belongs there.

## Explicitly out of scope

- **Showing ALL options presented + highlighting the selected one:** not possible for existing chats — the
  full button set shown was never stored (outbound interactive messages log only their body text). Would
  require logging the button set on every outbound interactive going forward, for a smaller gain that helps
  no past conversation. Deferred unless specifically wanted later.

## Frontend

Trivial once the label ships: the conversation renderer shows `displayLabel` instead of `content` for
interactive replies. No frontend label mapping (see above).
