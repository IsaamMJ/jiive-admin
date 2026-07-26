<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:lattice -->
# Project Context (Lattice reads this file first — keep it current)

## Build checklist — MANDATORY before building any feature

Before writing code for any new feature or screen, read and satisfy **`docs/BUILD-CHECKLIST.md`**.
It front-loads the recurring issues (data modeling / grouping, every UI state, async+AI latency and
spinners, optional-vs-required fields, exact-backend-contract + live verification, mobile/craft, and a
verify-against-live definition of done). Apply it by default — and pass it to any subagent you dispatch
to build. Most rework in this repo has traced back to skipping item #1 (model the real-world concept,
e.g. a *visit* is a batch of bookings — not one booking).

## Purpose

Internal admin dashboard for the Jiive platform. Operators use it to view bookings, manage users, run Thyrocare orders, monitor credits/usage, and inspect infra/audit data.

## Module map

Top-level directories under `app/` (Next.js App Router) and their owners:

- `app/dashboard/` — landing dashboard (overview widgets, recent activity)
- `app/users/` — user list + per-user profile (`[id]/page.tsx`)
- `app/bookings/` — bookings (day-grouped + flat views, expandable detail)
- `app/incidents/` — incident log (list + file form + detail w/ timeline + RCA). The whole
  backend contract lives in `app/incidents/types.ts` + `app/incidents/api.ts` — no axios
  anywhere else in the module. Suspected-incidents panel is derived client-side from
  `GET /bookings`, so it works without the incidents backend.
- `app/results/` — lab results list + per-result detail
- `app/credits/` — balances, packs, action costs
- `app/audit-log/` — audit trail viewer
- `app/admins/` — admin user management
- `app/infra/` — infra widgets (AI/knowledge service health)
- `app/usage/` — AI cost + reliability metrics
- `app/debug/` — internal debug tooling
- `app/stuck-bookings/` — paid-but-unordered recovery (Retry / Reschedule / Cancel) plus a
  cautioned "manual order by booking ID" escape hatch (folded in from the old `app/thyrocare/`
  page, which was removed as a redundant, unguarded duplicate)
- `app/login/` — auth entry point
- `components/` — shared UI (AdminLayout, Sidebar, TopBar, StatusBadge, ui/*)
- `lib/` — `api.ts` (axios client + 401 interceptor), `auth.ts` (token storage), `utils.ts`
- `docs/superpowers/` — design specs and implementation plans

## Intentional decisions / removals

<!-- Anything deliberately not built or deliberately removed goes here so audits don't flag it as drift. -->

(none yet)

## Living-truth note

Lattice reads this file first. Keep it current — when modules are added, removed, or significantly restructured, update the module map and the intentional-decisions section in the same change.
<!-- END:lattice -->
