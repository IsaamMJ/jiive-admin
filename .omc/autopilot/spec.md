# Jiive Admin Panel — Spec

## Overview
A Next.js 15 admin panel for Jiive, a WhatsApp-first wellness platform. Full CRUD over users, bookings, lab results, admin accounts, and debug tooling. Connects to a live CloudFront-fronted backend.

## Tech Stack
- Next.js 15 App Router, TypeScript strict mode
- Tailwind CSS
- shadcn/ui (button, card, table, tabs, dialog, input, label, badge, sheet, skeleton)
- Tremor (KPI cards + charts on dashboard)
- Axios for HTTP
- Dark mode default, light toggle via next-themes

## Backend
Base URL: `https://d3pvjhguhk37b0.cloudfront.net/api/v1/admin`
Auth: `Authorization: Bearer <token>` on all endpoints except POST /auth/login
Token stored in `sessionStorage`
TTL: 8 hours
On 401: clear token + redirect to /login

## Pages

### 1. /login
- Email + password form
- POST /auth/login → store token + name + role in sessionStorage
- Redirect to /dashboard on success
- Show error message on failure

### 2. /dashboard
- Stats cards (Tremor): total users, today's users, active this week, total bookings, today's messages
- Booking status breakdown (Tremor BarChart or DonutChart)
- Data from GET /dashboard

### 3. /users
- Paginated table (shadcn Table) with search/filter by name or phone
- Columns: name, phone, profile complete, conversations count, last activity, created at
- Click row → /users/:id
- Data from GET /users?limit=200

### 4. /users/:id
- shadcn Tabs: Profile | Conversations | Bookings | Results | Memories | Credits
- Profile tab: all user fields + credit balance
- Conversations tab: chat-bubble timeline (inbound left, outbound right)
- Bookings tab: table of bookings
- Results tab: table of results, click → /results/:id
- Memories tab: table of memories with type, content, relevance
- Credits tab: table of credit transactions
- Data from GET /users/:id

### 5. /bookings
- Table with status filter dropdown (all / pending_payment / confirmed / cancelled)
- Columns: patient, phone, test type, date+time, status (badge), amount, city
- Pagination (offset/limit)
- Data from GET /bookings

### 6. /results + /results/:id
- /results: table with status filter, columns: user, test type, bio age, chrono age, delta, status badge, date
- /results/:id: full detail — summary card, biomarker table, AI suggestions list, result tokens
- Data from GET /results and GET /results/:id

### 7. /admins
- Table of all admin users (GET /auth/admins)
- "Create Admin" button → Dialog with form (email, password, name, role)
- POST /auth/create-admin
- Deactivate button per row → DELETE /auth/admins/:id (confirm before)
- Cannot deactivate last active admin (show backend error)

### 8. /debug
- Env-check card showing boolean flags (GET /env-check)
- Thyrocare section with colored indicators (true=green, false=red)
- Clear history form: enter phone → DELETE /users/:phone/clear-history
- Test chat form: enter phone + message → POST /chat

### 9. /thyrocare
- Form: bookingId input
- POST /thyrocare/test-order
- Show success with order ID / lead ID, or error detail

## Routing & Auth
- Middleware: if no sessionStorage token → redirect to /login (client-side in layout)
- useAuth hook: reads token, provides logout (calls POST /auth/logout, clears sessionStorage)
- All API calls via axios instance with baseURL + auth interceptor + 401 handler

## Layout
- Sidebar nav (shadcn Sheet on mobile) with links to all sections
- Top bar: page title + dark/light toggle + logout button
- Dark theme default

## File Structure
```
src/
  app/
    layout.tsx          # root layout with ThemeProvider + AuthGuard
    (auth)/
      login/page.tsx
    (admin)/
      layout.tsx        # sidebar + topbar
      dashboard/page.tsx
      users/page.tsx
      users/[id]/page.tsx
      bookings/page.tsx
      results/page.tsx
      results/[id]/page.tsx
      admins/page.tsx
      debug/page.tsx
      thyrocare/page.tsx
  lib/
    api.ts              # axios instance
    auth.ts             # sessionStorage helpers
  hooks/
    useAuth.ts
  components/
    Sidebar.tsx
    TopBar.tsx
    StatusBadge.tsx
```
