# Handoff → jiive-admin — per-collection tab endpoints are live on dev

**Date:** 2026-08-07
**From:** jiive-backend
**Answers:** `jiive-admin/docs/handoff-backend-user-detail-pagination.md`
**Status:** built, 44 tests, on `dev`. **Not yet on prod** — say the word and it goes with the next
promotion.

---

## TL;DR

Three new endpoints, one envelope, cursor-paged. `GET /users/:id` is **unchanged** — keep reading it
until your tabs are wired, exactly as you asked.

```
GET /admin/users/:id/conversations?limit=50&before=<cursor>
GET /admin/users/:id/bookings?limit=50&before=<cursor>
GET /admin/users/:id/results?limit=50&before=<cursor>
```

Credits already had one (`/users/:id/credit-transactions`) — see §5, we did **not** rename it.

---

## 1. The envelope

```jsonc
{
  "items":      [ /* … */ ],
  "total":      90,          // the REAL count for this user, always
  "hasMore":    true,        // observed, never inferred
  "nextCursor": "MjAyNi0wOC0wNlQwNjo0MzoyMi4xMjNafG03"   // null when exhausted
}
```

Two things worth knowing, because both are places the old code went wrong:

**`hasMore` is observed, not inferred.** We fetch `limit + 1` rows and report whether the extra one
came back. Your stopgap heuristic (`total > items.length`) is wrong on the *last* page of a long
list — 90 messages, page 2 of 2, `total 90 > items 40` says "there's more" and renders a Load More
that returns nothing. There is a test named after that case.

**`nextCursor` is OPAQUE.** base64url, treat it as a blob. Don't parse it, don't build one. It
encodes our sort key, and the moment you construct one by hand, changing what a list is ordered by
becomes a breaking change to your code. The API always hands you the next one.

---

## 2. Paging

`?before=<nextCursor>` walks **backwards in time**. Omit it for the newest page.

Keyset on `(createdAt, id)`, as you asked. The `id` tiebreak is load-bearing and not defensive
programming: `created_at` is millisecond-precision and one Lumi turn logs an inbound and an outbound
together, so identical timestamps happen in normal traffic. Without the tiebreak a cursor landing on
one of those pairs either repeats both rows forever or skips one.

`?limit=` defaults to 50, max 200. **Out of range is a 400, not a clamp.** Asking for 10,000 and
silently getting 200 is the accepted-and-ignored class we keep paying for — you'd have no way to
tell it from success. Same for a malformed `before`: 400, not a silent restart at page 1 (which
would make an infinite scroll loop the newest 50 forever).

---

## 3. Item ordering — read this one

| endpoint | `items` order | why |
|---|---|---|
| `conversations` | **ASCENDING** (oldest → newest within the page) | matches what the aggregate already gives you, so your transcript renderer is untouched — just prepend each page |
| `bookings` | descending (newest first) | matches the aggregate |
| `results` | descending (newest first) | matches the aggregate |

Conversations is deliberately the odd one out. Returning it newest-first would have been more
"consistent" and would have cost you a `.reverse()` that, if forgotten, renders somebody's
conversation backwards — a silent visual bug. Drop-in compatibility won.

The **walk** is backwards regardless: `nextCursor` always points at the oldest row on the page. For
chat that means it's the cursor for `items[0]`, not `items[items.length - 1]`.

---

## 4. Item shapes

Byte-identical to what `GET /users/:id` returns for the same collection, **plus `id`**. Nothing to
re-map — you can render both side by side during the migration and diff them.

`id` isn't cosmetic: it's half the keyset, and you want it as a React key anyway.

`results` keeps the full subject resolution — `patientId` / `patientName` / `relationship`
ID-joined via `Booking.patientId → FamilyMember`, never name-matched — and `reportUrl` from the
latest non-expired token (`null` if none; an expired link is never surfaced).

---

## 5. Credits — we did NOT rename it, and it stays offset-paged

You asked for `GET /users/:id/credits`. `GET /users/:id/credit-transactions` already exists, already
paginates, already states `total` and `hasMore`, and your credits tab is live against it. Renaming
it would break a working screen to buy nothing.

What we did instead: added **`items`** as an alias alongside `transactions`, so every list in this
API answers to one key. Additive — nothing breaks. Drop `transactions` whenever you've moved.

It stays **offset**-paged on purpose. Keyset exists because chat is append-heavy and a page boundary
moves under a scrolling operator. Credit transactions for one account are a short, cold list; offset
is stable there in practice and already shipped.

**So there are two paging modes, and the absence of `nextCursor` is how you tell them apart:**

```jsonc
{ "items": [...], "total": n, "hasMore": b, "nextCursor": "…" }   // cursor-paged
{ "items": [...], "total": n, "hasMore": b, "limit": 20, "offset": 0 }  // offset-paged
```

Both always carry `items` + a real `total` + a stated `hasMore`. That's the invariant that makes "a
page rendered as a total" impossible; the cursor mechanics are secondary.

---

## 6. Indexes — you asked us to check before paging bookings/results

**Conversations:** `@@index([userId, createdAt(sort: Desc)])` already exists. The keyset is
index-ordered. No migration.

**Bookings:** confirmed — `@@index([userId, status])`, no `(userId, createdAt)`. **No migration, and
that is the recommendation, not a deferral.** The index narrows to one account first, and the sort
then runs over single-digit rows (busiest account on prod is under twenty bookings). An index here
costs a migration and buys nothing measurable. Revisit if any single account passes ~1,000 bookings.

**Results:** `@@index([userId, testType, createdAt])`. `testType` sits in the middle so it doesn't
give a clean `(userId, createdAt)` ordering — same story, same answer: a user has single-digit
results.

We'd rather not carry two speculative indexes for a table whose real cardinality is "six".

---

## 7. What's still open

**The aggregate is untouched.** `GET /users/:id` still runs seven queries and still returns
`conversations` capped at 50, plus five unbounded collections. That's your §5 sequencing and we
agree with it: trimming it to the profile is the **last** step. Tell us the tabs are live and we'll
cut it in one commit.

**`incidents` / `callLogs` stay unbounded** on the aggregate, as you flagged. We deliberately did
*not* slap a `take:` on them — a silent cap is the exact defect this whole exercise is about. They
get the envelope when they get their own endpoints.

**Not built:** `?q=` search. Agreed it's not needed at 505 messages, and nothing in the envelope
blocks it later.

---

## 8. Quick smoke

```bash
TOKEN=...   # dev admin login
BASE=https://jiive-dev.isaam.dev/api/v1/admin
UID=...     # the 90-message user

curl -s -H "Authorization: Bearer $TOKEN" "$BASE/users/$UID/conversations?limit=10" \
  | jq '{total, hasMore, n: (.items|length), nextCursor}'

# walk one page back
C=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/users/$UID/conversations?limit=10" | jq -r .nextCursor)
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/users/$UID/conversations?limit=10&before=$C" \
  | jq '{total, hasMore, first: .items[0].createdAt}'
```

`total` must read 90 on both. The second call's newest message must be strictly older than the
first call's oldest.

---

Questions to isaamm@jiive.ai.
