# Handoff → jiive-backend — Settings under-18 toggle is dead in the browser (CORS blocks PUT)

**Date:** 2026-07-26
**From:** jiive-admin (frontend)
**Severity:** the toggle cannot be used from the admin at all. Works from
curl/Postman, fails from every browser — which is likely why it passed testing.

## What's wrong

`PUT /admin/settings/allow-minors` is blocked by the browser before the request
is ever sent, because the API's CORS policy doesn't allow the PUT method:

```
Access-Control-Allow-Methods: GET,POST,PATCH,DELETE,OPTIONS
                                          ↑ no PUT
```

Same on **dev and prod**. The preflight OPTIONS returns 204, but the browser then
refuses the actual PUT, so the app gets a network failure with **no HTTP response
to show the operator** — hence the unhelpful "Couldn't update the setting." toast.

## Evidence

```
GET   /admin/settings/allow-minors → 200  {"allowMinors":true,…}
PUT   /admin/settings/allow-minors → blocked in browser (TypeError: Failed to fetch)
PATCH /admin/settings/allow-minors → 404  "Cannot PATCH …"   ← reaches the server
POST  /admin/settings/allow-minors → 404  "Cannot POST …"    ← reaches the server
```

PATCH/POST reach the server and 404 cleanly, so the route really is registered as
PUT and is correct — it's just unreachable from a browser.

CORS preflight, both envs:
```
OPTIONS (Request-Method: PUT) → 204 | Allow-Methods: GET,POST,PATCH,DELETE,OPTIONS
```
PUT missing from the list is the whole bug.

## The fix

Add `PUT` to the CORS allow-methods list. One line, applies to both environments.

**While you're there:** this is the only PUT the admin UI makes today, but any
future PUT endpoint hits the same wall. Worth adding PUT to the global CORS config
rather than per-route.

## Frontend status

No frontend change needed — the code is correct and will work the moment PUT is
allowed. We'll verify the toggle end-to-end on dev once it's deployed.
