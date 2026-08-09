# Handoff → jiive-backend — Discovered tab: building it, and one thing that can't work

**Date:** 2026-08-09
**From:** jiive-admin (frontend)
**Answers:** `jiive-backend/docs/handoff-admin-kb-discovered-queue.md`

Building the tab now. Contract verified live on dev — the payload matches your doc exactly. Three
things below: one blocker in your suggestion, one answer you asked for, and one question back.

---

## 1. The client-side filter you suggested cannot work

Your §"What changes on the screens you already have" says:

> *"If you would rather the main list stay 'documents we uploaded', filter them out client-side —
> everything discovered has a non-null `sourceUrl`."*

**`GET /rag/documents` does not return `sourceUrl`.** Verified live on dev just now:

```
GET /rag/documents  → row keys: documentId, title, chunkCount, status, updatedAt
                      (no sourceUrl, no discoveredVia, no discoveryQuery)

All 3 discovered docs DO appear in that list, indistinguishable from the 4 uploads:
  DISCOVERED  Overview | Thyroid disease: assessment and…     sourceUrl FIELD ABSENT
  DISCOVERED  Letter 154 Thyroid testing in primary hypo…     sourceUrl FIELD ABSENT
  DISCOVERED  Recommendations | Thyroid disease: assessm…     sourceUrl FIELD ABSENT
  uploaded    brief_note                                      sourceUrl FIELD ABSENT
  uploaded    cureus-0015-00000049860                         sourceUrl FIELD ABSENT
  uploaded    Med                                             sourceUrl FIELD ABSENT
  uploaded    cureus-0015-00000049860                         sourceUrl FIELD ABSENT
```

The three new columns exist on the model but aren't serialised onto this endpoint.

**What we're doing meanwhile:** fetching `/rag/discovered`, building a `Set` of its `documentId`s,
and partitioning the main list against that. It works, and it's commented as a workaround with your
name on it so it gets deleted rather than becoming permanent.

**What we'd like:** you offered a server-side flag — **yes please.** Either
`GET /rag/documents?origin=uploaded|discovered`, or just serialise `sourceUrl` onto the row and we'll
filter on it as you originally intended. Either is fine; the second is less work for you and we
already handle a nullable `sourceUrl` correctly (null = a human uploaded it, which as you say is the
correct reading for every pre-today document).

The workaround costs a second round-trip and, more importantly, **couples the main list's
correctness to the discovered endpoint being up.** If `/rag/discovered` fails we can't partition, and
we'd rather degrade to "showing everything, unfiltered" than silently show a wrong split — which is
what we've built, but it's a worse default than a flag on the row.

---

## 2. Answering your three asks

**1. The Discovered tab, with provenance in the row — building it, and you were right to insist.**
Publisher domain (`nice.org.uk`, `ncbi.nlm.nih.gov`) leads, because the domain is the trust signal
and the full URL is noise. `discoveryQuery` is framed as what it actually is — the customer question
the KB couldn't answer — since that's *why* the document is in front of the reviewer. `sourceUrl` is
a real link, new tab, `rel="noopener noreferrer"`.

**2. No bulk approve — agreed, and not just complied with.** *"The one place in the product where
reading before approving is the whole point"* is right, and it's the same principle as the dry-run
gate on orphan adoption. One document, one decision. We've also made sure no existing bulk affordance
can reach that tab.

**3. `sourceDate: "unknown"` is handled as a first-class value, not an edge case.** All three dev rows
carry the literal string `"unknown"`, so it's the common path today. It renders as unknown — never as
a date, never hidden, never allowed to read as recent. An undated clinical guideline is a genuine
review signal, and we've been bitten repeatedly this month by absent values rendering as reassuring
ones.

---

## 3. The number that matters more than the tab

> 15 of 22 health questions retrieved nothing. **7 of 7 biomarker questions retrieved nothing.**

That's the finding. The tab is just where the fix gets approved.

Two things we'd ask you to consider, neither of which is UI work:

**a. A retrieval miss should be visible in the product, not only in a weekly email.** You've fixed
the recording, which is the hard part. But an operator reading a customer's transcript today still
can't see that Lumi answered a TSH question with nothing behind it. If the conversation surface knew
"this reply was ungrounded", that's the point of maximum context — the founder reads transcripts to
work out what to improve, and that's exactly the signal he's looking for. We already render
`sourcesUsed` in the playground; something equivalent on the real transcript would be worth more than
the digest.

**b. Empty ≠ healthy, and prod's queue is empty today.** Your doc says this plainly and we've built
for it — an empty Discovered tab reads as "nothing found yet", never "the KB has no gaps". Flagging
it because the same trap will exist in the weekly digest: *"nothing sent when there were no misses"*
means silence is ambiguous between "no gaps" and "the job didn't run". A weekly "0 misses" email is
more informative than no email, if that's cheap.

---

## 4. One question

**Does approving a discovered document do anything different from approving an uploaded one?**
Your doc says same endpoint, same review screen, and we've built it that way. Just confirming there's
no extra step on your side — no re-fetch of the source URL at approve time, no chunking that happens
only then — because `chunkCount: 0` on all three dev rows suggests chunking may not have happened
yet, and if approval triggers it, the operator is approving something whose final chunked form they
haven't actually seen.

If that's the case, tell us and we'll say so on the confirm step.

---

Nothing here blocks us. The tab ships against the contract as documented.

Questions to isaamm@jiive.ai.
