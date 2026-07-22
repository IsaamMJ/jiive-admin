# Handoff → jiive-backend — sortable columns on `GET /bookings`

**Date:** 2026-07-22
**From:** jiive-admin (frontend)
**Status:** frontend is **built and shipped**. It sorts client-side today and shows an honest
"sorting these 50 rows only, not all N" warning whenever there's more than one page. The moment this
lands, we flip one constant and the warning disappears.

## The outcome we need

An operator clicks a column header in the bookings table and the **whole list** reorders — not just
the page they happen to be looking at. Today the list is paginated at 50/page, so a frontend sort is
only correct while the whole result fits on one page. Past that it silently lies, which is why we're
asking for this rather than shipping it ourselves.

## What that requires from the API

`GET /bookings` should accept two optional query params:

| Param | Values |
|---|---|
| `sortBy` | `patientName` · `whatsappPhone` · `testType` · `appointmentDate` · `appointmentTime` · `status` · `amount` · `city` · `thyrocareOrderId` |
| `sortDir` | `asc` · `desc` |

Both omitted → current default ordering, unchanged. Existing callers must keep working untouched.

Sorting is applied **before** pagination, so `limit`/`offset` page through the sorted result.

### Behaviour that matters to us

- **Sorting composes with the existing filters** (`status`, `cancelledBy`). Sort the filtered set.
- **Rows with no value sort last in both directions.** A booking with no Thyrocare ID hasn't got the
  "smallest" ID — it hasn't got one. Burying the real IDs under a wall of nulls when someone sorts
  descending makes the column useless. Same for city.
- **Name/test/city/status sort case-insensitively** — "aisha" and "Aisha" shouldn't split into two
  blocks.
- **The order must be stable/total.** Ties broken by something deterministic (e.g. `id`) so paging
  through a sorted list can't show or skip the same booking twice.
- **An unsupported `sortBy` should 400 with a clear message**, consistent with how unknown params are
  handled today — silently ignoring it would show us an unsorted list that looks sorted.

## Why these field names

They're the response fields the columns render, so the mapping is obvious from either side. Two
aren't top-level on the booking:
- `whatsappPhone` → `user.whatsappPhone`
- `city` → `address.city`

Sort on those nested values. If you'd rather name them `user.whatsappPhone` / `address.city`, that's
fine — tell us the strings and we'll change one line (they live in one map, `app/bookings/lib/sort.ts`).

---

# ✅ SHIPPED 2026-07-22 — and one follow-up

Sorting is live and verified from the browser against all 396 dev bookings: global order holds across
all four page boundaries, re-sorting resets to page 1, amount sorts numerically, `thyrocareOrderId`
descending puts real IDs first, and bad params 400 with the supported list. Flat field names retained.

## Follow-up: `cancelledBy` — yes please, add the filter

You asked. Confirmed live that it's currently accepted-and-ignored, which is worse than absent —
these four all return the identical 13 rows with `cancelledBy` values `user`, `system`, `thyrocare`
and `null` mixed together:

```
GET /bookings?limit=200&status=cancelled                        → total 13
GET /bookings?limit=200&status=cancelled&cancelledBy=user       → total 13   ← same rows
GET /bookings?limit=200&status=cancelled&cancelledBy=thyrocare  → total 13   ← same rows
GET /bookings?limit=200&status=cancelled&cancelledBy=null       → total 13   ← same rows
```

The admin UI had a "Cancellation source" dropdown wired to that param, so it had been silently doing
nothing. It now filters client-side as a stopgap and warns when the cancelled set spans pages.

**The outcome we need:** `cancelledBy` filters the result the way `status` does, so "how many did the
lab cancel on us this month" is answerable. That number feeds the Thyrocare scorecard — it's the
difference between a customer changing their mind and the vendor failing to show up.

- `cancelledBy=user` / `=thyrocare` / `=system` → exact match.
- Some way to ask for "no value" — whatever spelling you prefer, just tell us the string.
- `admin:<uuid>` cancellations exist in the data; a prefix match on `admin` would be useful but isn't
  required.
- Consistent with `sortBy`: an unsupported value should **400**, not be ignored. That's what hid this
  one for as long as it did.

## The two spec corrections — both accepted

`city` / `appointmentDate` / `appointmentTime` being NOT NULL is good news; nulls-last only ever
mattered for `thyrocareOrderId` and that's confirmed working.

## Case-insensitive sorting — leave it

Not worth forcing. Patient names come from WhatsApp onboarding and are effectively always
capitalised (0 lowercase-initial names in 396 dev bookings). If a lowercase name ever shows up
misfiled, we'll come back to it — not worth an index change on a hypothetical.

## Please confirm when done

Reply with the exact param names/values you shipped. We flip `SERVER_SORT` in
`app/bookings/lib/sort.ts` and verify against dev — no other frontend change needed.
