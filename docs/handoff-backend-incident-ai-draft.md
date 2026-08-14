# Handoff → jiive-backend — Incident AI-draft (dump a paragraph, AI fills the fields)

**Date:** 2026-07-18
**From:** jiive-admin (frontend)
**Depends on:** the existing incident log (live). This is **additive** — it does NOT change `POST /incidents`,
the alert logic, or the scorecard. It only adds one AI endpoint that pre-fills the file form.

## What this is

Filing an incident today means tapping severity, category, etc. This lets the operator instead **dump a
paragraph**, have the **AI draft every judgment field**, review it all in one bird's-eye card, pick the
order IDs, and click **File incident**. Laptop-only flow (no phone urgency concern).

## The flow (and where the human stays in the loop)

1. Operator dumps a free-text paragraph.
2. Frontend calls the new **`POST /incidents/draft`** → AI returns drafted fields.
3. Frontend shows a **review card**: title, severity, category, vendor, when — all pre-filled and editable —
   plus a searchable **order-ID multi-select** (order id · customer · date) the operator picks from, and the
   **original paragraph shown verbatim** underneath.
4. Operator glances, adjusts if needed, picks order IDs, clicks **File** → the EXISTING `POST /incidents`
   fires unchanged (alert + scorecard as today).

**Nothing is filed, no alert fires, nothing is counted until the operator clicks File.** The AI drafts; the
human commits. This matters because severity fires the alert and category feeds the Thyrocare scorecard —
a silent wrong value there is the exact failure the incident log exists to prevent.

## The ONE new endpoint

### `POST /incidents/draft`
Body: `{ text: string }` (the operator's paragraph; required, non-empty).
Returns the drafted fields — **frontend shows them for review, does not auto-file**:
```
{
  title:      string,                                   // one line, derived from the paragraph
  severity:   "S0" | "S1" | "S2" | "S3",
  category:   <exactly one of GET /incidents/meta categories>,
  vendor:     "thyrocare" | "internal" | "none",        // "who this lands on" / who's responsible
  occurredAt: string (ISO) | null,                      // only if the text states a time; else null (UI defaults to now)
  whatHappened: string                                  // the cleaned/tidied narrative; see rules
}
```

### Hard rules for the AI
- **Use the EXACT enum values** from `GET /incidents/meta` (severities, categories, vendors). Never invent a
  category or a severity outside the ladder — a value the file form can't submit is worse than none.
- **`whatHappened` must preserve every fact from the paragraph and invent nothing.** It tidies; it does not
  summarize away or embellish. (The frontend also keeps the operator's raw paragraph verbatim, separately.)
- **Severity, when unsure, rounds UP.** A borderline S2/S3 → return S2. The failure mode must be an alert
  that didn't strictly need to fire (harmless), never a serious incident that stayed silent (the danger).
- **Do NOT extract order IDs.** The operator picks those from a validated dropdown — a misread ID silently
  links the wrong customer, so that field stays human. Omit it from the response entirely.
- **Do NOT set the owner.** The internal owner (who chases it) defaults to the filer on the frontend; the AI
  can't know which admin should own it. `vendor` is the "who's responsible" field the AI does fill.
- **Best-effort, never a blocker.** If the AI errors or times out, return a clear error; the frontend falls
  back to the normal empty file form. AI-draft is an accelerator, never the only path to filing.

Uses your existing LLM infrastructure. `RolesGuard` + `@Roles('admin')` like every admin route.

## Frontend, for context (no backend work here)
- The order-ID **multi-select** is fed from existing booking data (order id · customer name · booking date),
  searchable by any of those. No new endpoint — reuses what the incident file form / bookings already load.
- The review card wires into the existing `FileIncidentDialog` / `POST /incidents`. Zero change to incident
  storage, alerts, or the scorecard.

## Out of scope
No change to `POST /incidents`, the alert channel, the scorecard, or incident storage. No auto-filing. No
order-ID extraction. No owner inference. Just the one draft endpoint.
