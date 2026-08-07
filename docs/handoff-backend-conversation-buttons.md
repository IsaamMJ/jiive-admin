# Handoff → jiive-backend — store the buttons a bot message offered (show them in the conversation)

**Date:** 2026-07-18
**From:** jiive-admin (frontend)
**Scope:** `GET /users/:id` → `conversations[]` (and `GET /admin/conversations`), user detail → Conversations tab.

## What we want

Show interactive messages in the admin **exactly like WhatsApp**: when the bot sends a message that offers
buttons (e.g. "Hey! I'm Lumi… What would you like to do?" with **🧬 Know my Bio-Age** / **❓ How it works**),
those options render as button rows **under the bot message** — the same as the customer saw in WhatsApp.

The frontend is already built to render this (a `buttons` array on the message → WhatsApp-style rows with a
reply-arrow + the label). It just needs the data.

## The gap

The button set is not stored. When the bot sends an interactive message, only the **body text** is logged
to `lumi_conversations.content` (`whatsapp.service.ts` `logOutbound(to, msg.body, 'interactive', …)`) — the
buttons array is dropped. So there is nothing to render, and **old conversations cannot be rebuilt** (the
data was never captured).

## The ask

**1. On every OUTBOUND interactive message, store the buttons offered** — id + the title the customer saw —
in `lumi_conversations.metadata`, e.g. `{ buttons: [{ id: "disc_know_bioage", title: "🧬 Know my Bio-Age" }, …] }`.
Covers both button messages and list messages (for a list, the row title is the label). You already have the
button set at send time (the `{ id, title }[]` arrays the funnel passes to `sendInteractive`) — just persist it.

**2. Return it on the conversation payload** as `buttons: [{ id, title }]` per message (present on outbound
interactive messages that offered options; absent/null otherwise).

That's it — the frontend already renders `buttons` when present, and shows nothing when absent.

## Honest scope

- **Works for NEW conversations from the moment this ships.** Existing chats won't show buttons — the set
  was never saved.
- **Optional backfill:** if the funnel can deterministically say which buttons a given historical interactive
  message offered (many are fixed menus — the discoverability menu is always the same two), you *could*
  backfill `metadata.buttons` for known message types. Nice-to-have, not required; unknown ones just stay bare.

## Frontend (already done — nothing to build once the field ships)
Each outbound message with a non-empty `buttons` array renders WhatsApp-style option rows (reply-arrow + the
`title`) under the message body. No `buttons` → unchanged.
