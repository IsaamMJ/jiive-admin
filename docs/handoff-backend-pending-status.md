# Handoff → jiive-backend — status check on pending items

**Date:** 2026-07-20
**From:** jiive-admin (frontend)
**Ask:** a quick status + ETA on the three items below. Frontend is done/ready for all of them; these are
the only things gating them.

## 1. RAG mid-word-spaces (pdf-parse → Docling)
Styled/callout text in PDFs extracts with spurious mid-word spaces ("re turn", "af ter"). Single upload
uses `pdf-parse`; the fix is to route it through Docling (or add a normalization pass). Acknowledged, not
started when we last spoke. **Status / ETA?** Spec: `docs/backend-backlog-rag-ingestion.md`.

## 2. Conversation buttons under bot messages — NEEDS VERIFICATION
The frontend renders a message's `buttons: [{id,title}]` as WhatsApp-style option rows. But we scanned
**every** conversation on dev (200 users) and prod (6 users) and found **zero** messages with `buttons[]`
populated. So the *return* field ships, but the **storing** side may not be firing.
**Please confirm:** send one interactive bot message and check its `lumi_conversations.metadata` actually
gets the button set. If it does → we're done (renders automatically). If it stays empty on a fresh
interactive send → the store step needs fixing. Spec: `docs/handoff-backend-conversation-buttons.md`.

## 3. NEW, low-priority — feedback sentiment (for "who's unhappy at a glance")
To let the feedback feed show a mood dot per customer without opening each note, add a **`sentiment`**
(`happy | mixed | unhappy`) derived by the organize step, and include it on:
- `GET /feedback/customers` feed rows, and
- `GET /feedback/customers/:userId`.
Frontend will render a colored dot + sort "needs attention" first. Low priority — nice-to-have once
feedback volume grows.

---
**Summary:** (1) ETA on RAG spacing, (2) confirm the conversation-buttons *store* actually fires, (3) an
optional `sentiment` field on feedback. Nothing else is pending on the backend from our side.
