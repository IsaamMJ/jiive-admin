import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Purge (right-to-erasure) ─────────────────────────────────────────────────
//
// A customer who exercises their right to erasure keeps their row; the phone is
// replaced with a tombstone. Verified live, GET /users returns:
//   { id: "50113eba-…", whatsappPhone: "purged:50113eba-…", name: null,
//     profileComplete: false, _count: { lumiConversations: 0 } }
//
// That string must never be treated as a phone number — stripped to digits the
// UUID still yields digits, so it produces a garbage-but-well-formed `tel:`
// link (see telHref in app/calls/types.ts) and is substring-matchable in the
// customer pickers, which would let an operator select an erased person and log
// new personal data against them. That's a compliance problem, not a cosmetic
// one.
//
// This lives in lib/ rather than any feature module because three modules need
// it (users, feedback, incidents) and the alternative — importing it from
// app/feedback/api.ts — would drag that module's axios client across a boundary
// AGENTS.md draws deliberately ("no axios anywhere else in the module").
const PURGED_PREFIX = "purged:";

export function isPurgedUser(whatsappPhone: string | null | undefined): boolean {
  return (whatsappPhone ?? "").startsWith(PURGED_PREFIX);
}
