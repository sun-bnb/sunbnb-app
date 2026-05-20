---
id: 001-knowledge-store
title: Knowledge Store
status: active
created: 2026-05-20
updated: 2026-05-20
worktree: null
---

## Goal

A phased, enterprise-scalable retrieval layer beneath the wiki + memory: a vector store that
ingests high-volume operational "exhaust" — starting with Claude Code session transcripts —
as **distilled, searchable episodic records**, so any session can recall *"have we hit /
decided / tried this before?"* Free + keyless wherever possible.

## Resume here

- **Next action:** Phase 1 — stand up a Vercel **test-env log drain** and write a
  `source='vercel-log'` adapter mapping grouped error signatures → `knowledge_record`
  through a redaction gate.
- **Context needed:** ingest pipeline + schema in `.claude/scripts/knowledge-ingest.mjs`
  and `knowledge-schema.sql`; the adapter contract is "map any datasource → `knowledge_record`,
  only `source` distinguishes it." First sub-decision: drain destination (HTTP endpoint vs.
  file/blob sink). Vercel logs are ephemeral — capture-or-lose.
- **Blocked by:** —

## Roadmap

- ✅ **Phase 0 — Session-transcript adapter** (2026-05-20). Dedicated pgvector container
  `sunbnb-knowledge-postgres` (:5434); `knowledge_record(vector(384))` + `ingested_session`
  ledger; `knowledge-ingest.mjs` (core+CLI), `knowledge-hook.mjs` (SessionEnd, detached),
  `--sweep` backfill, `knowledge-recall.mjs` + `/recall`. Distill via `claude -p` (Haiku, no
  API key); embed locally via transformers.js `bge-small-en-v1.5` (keyless, zero egress).
- ✅ **Phase 0.1 — Chunked distillation + resilience** (2026-05-20). ~80k-char overlapping
  windows; per-chunk distill → merge + dedupe; non-array output is retryable (backoff) then
  skipped visibly — no silent data loss.
- ▶ **Phase 1 — Operational log adapter (Vercel test env).** Log drain → durable sink;
  `source='vercel-log'` adapter; redaction at ingestion; `/recall --source vercel-log`.
- ☐ **Phase 2 — Payment & reconcile adapters (with redaction).** `source='reconcile'`
  (persist `/api/reconcile` output); `source='payment-event'` (Stripe/Mollie, gated redactor).
- 💤 **Phase 3 — Scale + promotion pipeline.** Recurring-record clusters → promote into
  wiki/memory; semantic dedup; store metrics; `--embed-pending` for model migration; swap
  pgvector → managed only if scale demands; sweep should also scan worktree transcript dirs.

## Log

- **2026-05-20** — Built + verified Phase 0 and 0.1. Store live at ~68 records / 5 sessions.
  Key decisions: keyless/free (local embeddings + `claude -p` distill); dedicated container
  on :5434 (postgis image lacks pgvector; not coupled to the unrelated tartofu container).
  Design principles locked: distill-don't-dump, pull-not-push, provenance + git SHA per record,
  stable schema/adapter/retrieval contract with swappable backend/model. Residual: a chunk
  whose content reads like dialogue can make Haiku reply in prose → skipped with a warning.
- **2026-05-20** — Hardened local persistence: migrated the pgvector container to a named
  volume (`sunbnb-knowledge-data`) + `--restart unless-stopped`, preserving all 68 records via
  pg_dump/restore. Provisioning `docker run` now documented in `.claude/scripts/knowledge-schema.sql`.
  (Was an anonymous volume with no restart policy — fragile to `docker rm`/reboot.)

## Open decisions

- Storage location: local Docker is now durable (named volume + restart policy) — enough for
  solo dev. **Later: a common/shared store for a team** (Neon or a hosted vector DB) so multiple
  developers/agents share one knowledge base. Revisit when the team grows.
- Automate the promotion-to-wiki step (Phase 3) or keep it manual.

## Links

Infrastructure layer beneath `.claude/wiki/` + memory. Records reference domain entities
(`[[entity:settlement]]`, `[[entity:reservation]]`, `[[entity:invoice]]`). Design + status
also recorded in the `knowledge-store-phase0` memory. No sibling tracks yet.
