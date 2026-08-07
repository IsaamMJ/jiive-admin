# Credits Module — Admin Frontend Handoff

**Repo:** `jiive-admin` (Next.js 15 App Router)
**Backend spec:** `jiive-backend/docs/admin-console-credits-spec.md` (Phase 1 + 2, 2026-04-30)
**Status:** First pass shipped on `main` — see "What was built" below.

---

## 1. What was built

| Page | Route | Endpoints used |
|---|---|---|
| Credit Balances | `/credits/balances` | `GET /credits` (paginated, search, sort) |
| Credit Packs | `/credits/packs` | `GET /credit-packs`, `PATCH /credit-packs/:id` |
| Action Costs | `/credits/action-costs` | `GET /credit-action-costs`, `PATCH /credit-action-costs/:actionType` |
| Audit Log | `/audit-log` | `GET /audit-log` (action / targetId / adminUserId filters) |
| User Detail (Credits tab) | `/users/[id]` | `GET /users/:id/credit-transactions` (paginated) + `POST /users/:id/grant-credits` |

All five entries are wired into `components/Sidebar.tsx`.

> **Routing convention:** this app does NOT prefix admin routes with `/admin` — pages live at `/credits/...` and `/audit-log` (matching the existing `/users`, `/bookings` flat structure). Backend paths stay as documented (`/api/v1/admin/...`).

---

## 2. Conventions to keep using

- **Base URL & auth:** `lib/api.ts` already targets `https://d3pvjhguhk37b0.cloudfront.net/api/v1/admin` and injects the bearer token from `lib/auth.ts`. Never construct URLs by hand.
- **Money:** backend stores **paise** (integer). Display as `pricePaise / 100`, submit as `Math.round(rupees * 100)`. Never `parseFloat` round-trip.
- **Action key:** `PATCH /credit-action-costs/:actionType` uses the *string* (`regenerate_suggestions`), NOT the UUID `id`.
- **Toasts:** use `toast.success` / `toast.error` from `sonner` (already wired in `app/layout.tsx`).
- **Error reading:** `(err as { response?: { data?: { error?: string } } })?.response?.data?.error` — same shape used everywhere else.
- **Server-paginated tables:** track `offset` + `total` returned by the API, not client-side slicing.
- **Lint gotcha:** the React 19 lint rule `react-hooks/set-state-in-effect` flags any function called inside `useEffect` whose body invokes `setState`. Inline the `api.get(...).then(...)` pattern inside the effect (see `app/users/[id]/page.tsx`). For refresh-after-action paths (e.g. after PATCH/POST), call a `load()` helper from the event handler — that's fine.
- **Select onValueChange:** the `base-ui` Select sometimes passes `null`. Use `(v) => setX(v ?? "<fallback>")`.

---

## 3. Pages built — implementation notes

### 3.1 `/credits/balances`
- Search input is debounced 250ms, resets `offset` to 0.
- Sort dropdown: `updatedAt` (default) or `balance`. Order: `desc` (default) or `asc`.
- Row click → `/users/:id` (existing user detail).
- No edit on this page — balances change only via the credit service (Module Rule 6).

### 3.2 `/credits/packs`
- Renders all packs (active + inactive) so an admin can re-enable a hidden one.
- Edit dialog converts paise ↔ rupees in display, validates `credits > 0` and `priceRupees > 0`.
- PATCH only sends fields that actually changed (diffed against the loaded row) — keeps the audit log clean.

### 3.3 `/credits/action-costs`
- Single-row table today (`regenerate_suggestions`). Future actions appear automatically when seeded.
- `creditsCost: 0` keeps an action available but free; uncheck "Active" to hide it (callers see "unknown action type").

### 3.4 `/audit-log`
- Filters: action dropdown, targetId, adminUserId. All AND together. URL-state not yet wired — feel free to add `useSearchParams` if you want shareable links.
- Diff renderer: `JSON.stringify(before[k]) !== JSON.stringify(after[k])` per top-level key. For `credit.grant` (no `beforeJson`), it shows everything in `afterJson`.
- Actor column shows admin name + email when available, falls back to `actorLabel` (e.g. `system:admin-token`).

### 3.5 User Detail — Credits tab
- "Grant credits" button → modal (credits, reason, notify checkbox) → confirmation modal showing computed new balance + WhatsApp notice.
- Reason is required and is logged on both the transaction `description` and the audit row's `reason`.
- After success, both the user payload and the transaction list reload.
- Transaction table now uses `GET /users/:id/credit-transactions?limit=20&offset=0` with prev/next pagination. Type-colored badges: purchase=green, manual_grant=blue, usage=orange, expiry=red. Credits column is signed (`+50` / `-5`).

---

## 4. Things still TBD / nice-to-haves

- [ ] **URL state for filters and pagination** on Balances + Audit Log (so refresh / back button preserve view).
- [ ] **Click-through from audit log** — when `targetType === "User"`, link `targetId` to `/users/:id`; when `CreditPack` / `CreditActionCost`, link to those pages.
- [ ] **Confirm before deactivating a pack** (toggling `active: false` in the edit dialog) — currently no warning, but it hides the pack from all paying users.
- [ ] **CSV export** on balances / audit log — finance has been asking.
- [ ] **Empty state polish** — generic "No data" today, could use illustrations.
- [ ] **Audit log presets** — "Last 24h", "My changes", etc.

---

## 5. Hard constraints (do not violate)

These come straight from the backend spec §6 — repeated here for posterity:

1. **Don't write directly to `credit_balance` / `credit_transaction`.** Only `CreditService` writes. The frontend never touches Prisma; this just means: don't add a "manual balance edit" button. Use grant-credits.
2. **Don't hardcode pack pricing.** Always render from `GET /credit-packs` so admin tuning takes effect without a deploy.
3. **Don't retry `POST /grant-credits` on partial failure.** WhatsApp send failures return success=true with `notified=false` — that's not a retry condition. Retrying would double-credit.
4. **`actionType` is the path key for action costs, not the UUID.**
5. **Routing:** keep new pages flat (`/credits/...`, `/audit-log`), not `/admin/credits/...`.

---

## 6. Quick test plan for QA

After deploy, walk through:

1. **Balances** — load page, search by partial name, sort by balance asc, paginate.
2. **Packs** — change Starter price by ₹1, save, refresh; check audit log shows `credit_pack.update` with `pricePaise: X → Y`.
3. **Action costs** — bump `regenerate_suggestions` from 5 → 6, save, refresh; revert.
4. **Grant credits** — pick a test user, grant 10 credits with reason "QA test", confirm, see toast, see new transaction with `+10` and type=`manual_grant`. Test user receives WhatsApp message.
5. **Audit log** — filter by `action=credit.grant`, see the grant from step 4 with the reason.
6. **Negative case** — grant 0 credits → 400; grant with empty reason → 400; grant to non-existent user id → 404.

---

## 7. Files touched

```
app/credits/balances/page.tsx       (new)
app/credits/packs/page.tsx          (new)
app/credits/action-costs/page.tsx   (new)
app/audit-log/page.tsx              (new)
app/users/[id]/page.tsx             (added Grant Credits + paginated tx history)
components/Sidebar.tsx              (added 4 nav entries)
docs/credits-admin-frontend.md      (this doc)
```

No backend changes. No new dependencies. No env vars added.
