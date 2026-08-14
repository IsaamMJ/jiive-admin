# Handoff → jiive-backend — customer uploads are missing from the conversation log

**Date:** 2026-07-26
**From:** jiive-admin (frontend)
**Severity:** the admin can't see what a customer actually sent. For a diagnostics
company where customers upload lab report PDFs, that's a real hole.

## What's wrong

When a customer sends a **document / image / any media** over WhatsApp, it never
appears in the conversation view. The bot clearly receives it — but the log shows
nothing.

Concrete case, prod user **Imrana** (`37bd4a1d-17a2-42cd-a168-1e1c2bf73a95`),
2026-07-26:

```
06:58:20  inbound   "I already have results bro"
06:58:23  outbound  "It looks like I couldn't find any existing suggestions…"
   ⟶ [customer uploads a PDF report here — 25-second gap, NOTHING in the log]
06:58:48  outbound  "Got your report! 📄 Analyzing it now… this takes about 30 seconds."
06:58:52  outbound  "Not enough credits. Report upload costs 10 credits, you have 0."
```

The bot literally says "Got your report!" — so a document arrived and was processed.
But `GET /users/:id` returns no message for it.

## It's not a one-off

Scanned **every** prod conversation via the API:

```
9 users · 346 messages
messageType distribution: { "text": 285, "template": 61 }
```

Not a single `image`, `document`, `audio`, `video`, or `location` message in the
entire history. So inbound media is either never persisted, or persisted but
excluded from the `conversations` array on `GET /users/:id`.

## What we need

Inbound (and outbound) media messages included in the `conversations` array, with
enough to render them. Proposed shape — **please confirm or correct, we render to
whatever you return**:

```jsonc
{
  "type": "chat",
  "direction": "inbound",
  "messageType": "document",          // document | image | audio | video | location
  "createdAt": "2026-07-26T06:58:40Z",
  "media": {
    "filename": "my_report.pdf",      // if the sender provided one
    "mimeType": "application/pdf",
    "caption": "",                    // WhatsApp media caption, if any
    "url": "https://…"                // authenticated URL, OR:
    "mediaId": "…"                    // an id we fetch via a media endpoint
  }
}
```

Whatever we display, the file has to be **fetched with the admin bearer token** —
a plain `<img src>` / `<a href>` can't send auth headers, so if these are
protected we need either a token-bearing endpoint we call via axios, or a
short-lived signed URL. Tell us which and we'll wire it.

### Questions

1. Are inbound media messages **stored** today (just not returned), or not stored
   at all? That decides whether history is recoverable or only new uploads appear.
2. Media URL vs. media-id-we-fetch — which?
3. Are these behind auth (they must be — it's health data)? Signed URL or
   bearer-token endpoint?

## Frontend status

Ready to render file/image bubbles the moment the shape is confirmed. Holding the
build until then rather than guessing the contract — an unknown-key guess here
would just 400 or render blank.
