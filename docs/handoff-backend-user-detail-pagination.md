# Handoff → jiive-backend — `GET /users/:id` is a fat aggregate; conversations are capped at 50 with no way to ask for more

**Date:** 2026-08-07
**From:** jiive-admin (frontend)
**Trigger:** an operator opened a customer with 90 messages and could only read 50. There is no
parameter that returns the other 40.
**Ask:** not "raise the cap". Split the endpoint and give every list the same envelope.

---

## 1. What the operator sees

Customer `919895984115` ("Am"):

- Users list → **90** conversations
- Open her → tab reads **Conversations (50)**

Both numbers come from you, from the same relation, in the same session. The list uses
`_count.lumiConversations` (`admin.controller.ts:864`) which is uncapped. The detail uses a
hard-coded `take: 50`. Neither says it was truncated, so the tab presents a page as a total.

The 40 oldest messages are simply unreachable. Verified live: `?limit=`, `?messageLimit=` and
`?conversationLimit=` are all silently ignored — no error, no effect.

## 2. The real shape of the problem

`GET /users/:id` runs seven queries and returns all of them eagerly, whether or not the operator
opens that tab:

| collection | limit | source |
|---|---|---|
| conversations | `take: 50` | `admin.controller.ts:1656-1659` |
| creditTransactions | `take: 20` | `:1733-1736` |
| **bookings** | **none** | `:1668-1670` |
| **memories** | **none** | `:1685-1687` |
| **results** | **none** | `:1695-1697` |
| **incidents** | **none** | `incidents/incident.service.ts:1281-1284` |
| **callLogs** | **none** | `incidents/call.service.ts:497-500` |

Two are silently truncated. **Five are unbounded.** Every one of them grows for the life of the
account, and none of them is needed to render the page the operator actually lands on.

The cap is the symptom you noticed. The unbounded ones are the ones that will take the page down —
they just haven't grown yet.

Prod today: 505 messages across 15 users, busiest at 117. Small enough that nothing hurts, which is
exactly why this is the right moment.

## 3. What we're asking for

### 3.1 `GET /users/:id` returns the profile only

Identity, status, credit balance, `profileComplete`, timestamps. Bounded, fast, never grows. It is
the only thing needed to render the page on open.

### 3.2 One endpoint per collection, fetched when its tab opens

```
GET /users/:id/conversations
GET /users/:id/bookings
GET /users/:id/results
GET /users/:id/credits
```

**You have already done this once and it worked.** The Memories tab now reads
`GET /lumi/memory/:phone` (`memory-readback.service.ts`), which is why it can show subject, state
and confidence — things the aggregate had dropped. This finishes that pattern rather than inventing
a new one.

### 3.3 Cursor pagination, not offset

```
GET /users/:id/conversations?limit=50&before=<cursor>
```

Chat is append-heavy. With `skip`/`offset`, a message arriving while the operator scrolls shifts
every subsequent page — rows get re-shown or skipped, and neither is visible as a bug. Keyset on
`(createdAt, id)` is stable under concurrent writes. `id` is needed as the tiebreaker because
`createdAt` is not unique.

`take: 50` is a fine **page size**. It is only wrong as a **hard ceiling**.

### 3.4 One envelope for every list — this is the part that matters most

```jsonc
{
  "items":      [ ... ],
  "total":      90,        // the real count, not items.length
  "hasMore":    true,
  "nextCursor": "2026-08-06T06:43:22.000Z|3f2a…"   // null when exhausted
}
```

Never a bare array. Never a page without a total.

We keep fixing this defect one screen at a time — the users list inferring truncation from
"exactly 200 came back", the memories tab, this. Each fix is per-screen and the next endpoint
reintroduces it. **A mandatory envelope makes "a page rendered as a total" structurally impossible
instead of a thing we remember to check.** That is worth more than the pagination itself.

### 3.5 Indexes

`LumiConversation` **already has** `@@index([userId, createdAt(sort: Desc)])` (`schema.prisma:719`),
so conversations can be paged today with no migration. Consider adding `id` to make the keyset
tiebreak index-only.

`Booking` has `@@index([userId, status])` but **not** `(userId, createdAt)` (`:268-271`), and it is
ordered by `createdAt desc`. `Result` has `@@index([userId, testType, createdAt])` (`:314`) which
mostly covers it. Please check these before paging those two — keyset without a matching index is a
sequential scan, which is worse than the cap it replaces.

## 4. What we are NOT asking for

- **Not a bigger cap.** `take: 500` moves the cliff and keeps the lie.
- **Not search yet.** At a few thousand messages, scrolling stops being the real access path and
  `?q=` becomes necessary — but not at 505. Don't build it now; just don't design the envelope in a
  way that blocks it.
- **Not a rewrite of incidents/callLogs.** They're unbounded too, but they're small and they belong
  to another module. Flagging them so the same envelope reaches them eventually.

## 5. Suggested order

1. **Conversations** — the one biting us, and the index already exists.
2. **The envelope**, applied to the other three as they're split out.
3. **Trim `GET /users/:id`** to the profile once the tabs no longer read from it. Do this last so
   nothing breaks mid-flight; we'll keep reading the aggregate until you tell us the tab endpoints
   are live.

## 6. Frontend side

We'll do the corresponding work — lazy-load per tab, infinite scroll upward on chat, counts from
`total`. Small once the envelope exists.

In the meantime we can only render what arrives, so the tab will say **"50 of 90 — showing the most
recent"** using the `_count` from the list payload. That's a label fix, not a fix — the 40 oldest
messages stay unreachable until this lands.

Tell us the endpoint shapes when you've settled them and we'll build against them.

Questions to isaamm@jiive.ai.
