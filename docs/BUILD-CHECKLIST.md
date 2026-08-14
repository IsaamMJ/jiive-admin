# Build checklist — read before building any feature

Answer/satisfy all of this **before writing code**, then build it in one pass. This exists to catch,
up front, the things that otherwise surface one-by-one in review. Most rework traces to skipping #1.

## 1. Data model first (where most rework comes from)
- Model the real-world **concepts**, not the raw DB rows. Example: a **visit** is a *batch of bookings*
  (one appointment can bundle many test panels), not one booking. An **incident** may cover *many* orders.
- For every list / dropdown / table: should items be **grouped** (by visit, payment batch, customer, day)?
  Never show raw rows if they belong to a group — group them and show one entry per real-world thing.
- Identify the grouping key up front (paymentBatchId, appointment slot, userId). If the payload lacks it,
  decide the proxy (e.g. date+time) or ask the backend to add it.

## 2. Every state, not just the happy path
- **Loading**, **empty** (a calm "nothing yet" — never an error), **error**, and **"backend not built yet"**
  (a 404 while an endpoint ships in parallel — visibly distinct from a real outage).
- Lists must handle **0, 1, and many** items, and **very long** text (wrap/scroll, no overflow).

## 3. Anything async or AI
- AI/LLM or background work can take **30–60s**. **Never leave a spinner that can get stuck** — poll with a
  bounded backoff, then fall back to a manual "check now", never an infinite or frozen spinner.
- **Signal the AI at the input** (a sparkle + "AI will organize/draft this") so the user knows *before*, not
  only after they see the result.
- Async/AI must **never block** the primary action: save the raw thing instantly, process after; if the
  processor is down the raw thing is still safe and readable.

## 4. Required vs optional
- Decide which fields are **truly required** vs **optional**. Optional fields must **never block submit**.
  (Real cases we got wrong: order-less incidents; general feedback with no booking.)
- Disabled submit always shows **why** (visible reason), never a dead button.

## 5. Backend contract — verify, don't assume
- Use the **exact** param/field names. The backend is strict: an **unknown key is a hard 400**, which
  silently takes a whole page down (this has bitten us repeatedly — invented list params, wrong date format).
- **Verify every endpoint against live dev with a real request before calling it done.** Typecheck ≠ works.
- Confirm the **path** (the base already carries `/api/v1/admin` — don't double it).
- Surface the **server's real error message verbatim**, never a paraphrase.
- Keep all axios for a module in one `api.ts` + types in `types.ts`, so a contract change is a one-line fix.

## 6. Craft
- **Mobile-first** — works one-handed at ~375px, no horizontal scroll.
- **Double-submit guarded** (a ref); typed input **preserved on error**.
- **Destructive / medical / legal-sensitive** actions **confirm first**, spelling out the consequence.
- **No optimistic UI** for anything consequential — reflect the server response as the source of truth.
- Reuse the house vocabulary (`components/ui/*`, `InfoTip`, `StatusBadge`, sonner toast). Every non-obvious
  control gets a small "i" InfoTip that teaches the concept in plain language.
- Attribution where it matters (who filed / logged / changed it), stamped server-side from the token.

## 7. Definition of done
- `npx tsc --noEmit` exit 0, `npm run build` compiles, **no new lint findings**.
- **Driven end-to-end against live dev data** — not just typecheck — with an **honest list of what was NOT
  verified** (e.g. anything needing an endpoint that isn't live yet, or not clicked in a browser).
