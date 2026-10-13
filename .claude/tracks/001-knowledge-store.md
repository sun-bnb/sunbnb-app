---
id: 001-knowledge-store
title: Knowledge Store
status: paused
created: 2026-05-20
updated: 2026-10-12
worktree: null
---

## Goal

A phased, enterprise-scalable retrieval layer beneath the wiki + memory: a vector store that
ingests high-volume operational "exhaust" — starting with Claude Code session transcripts —
as **distilled, searchable episodic records**, so any session can recall *"have we hit /
decided / tried this before?"* Free + keyless wherever possible.

## Resume here

- **Next action:** none scheduled — the store is in steady state (ingest at SessionEnd incl.
  subagents; curated layers indexed by `knowledge-curated.mjs`; tiered recall + credits +
  `--candidates` delivered by [[track:031-context-system-v2]]). Phase 1 (Vercel log drain) is
  parked until an operational need appears; reopen with a handoff when it does.
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
- ✅ **Phase 0.2 — Retrieval hygiene + coverage** (2026-06-17 → 2026-09-12). Recency-decay
  re-ranking (`--recency/--halflife`); subagent transcripts (`<session>/subagents/agent-*.jsonl`)
  ingested by the hook and the sweep; `--embed-pending`; SessionStart `knowledge-ensure.mjs`
  launches Docker so a reboot no longer silently stops ingestion.
- ✅ **Phase 3 — Promotion pipeline** (2026-10-12, delivered as [[track:031-context-system-v2]]
  P2/P3). Curated layers (`playbook:<agent>`, `wiki`, `track`) indexed into the same store;
  tiered recall with status boost; `--credit` (raw → verified, hits); `--candidates <agent>`
  (near-duplicate clusters across sessions + credited records, minus what the playbook already
  covers) consumed by `/groom`; `type` validated on insert; store metrics in
  `context-health.mjs --with-store`.
- 💤 **Phase 1 — Operational log adapter (Vercel test env).** Log drain → durable sink;
  `source='vercel-log'` adapter; redaction at ingestion; `/recall --source vercel-log`. Parked.
- 💤 **Phase 2 — Payment & reconcile adapters (with redaction).** `source='reconcile'`
  (persist `/api/reconcile` output); `source='payment-event'` (Stripe/Mollie, gated redactor).
- 💤 **Later:** swap pgvector → managed only if scale demands; sweep worktree transcript dirs.

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
- **2026-10-12** — Roadmap refreshed by track 031: Phase 0.2 and Phase 3 recorded as done (the
  promotion pipeline shipped as 031 P2/P3: curated indexing, tiered recall, credits, candidates).
  Status → paused: nothing scheduled until an operational log source is wanted.

## Open decisions

- Storage location: local Docker is now durable (named volume + restart policy) — enough for
  solo dev. **Later: a common/shared store for a team** (Neon or a hosted vector DB) so multiple
  developers/agents share one knowledge base. Revisit when the team grows.
- Automate the promotion-to-wiki step (Phase 3) or keep it manual.

## Links

Infrastructure layer beneath `.claude/wiki/` + memory. Records reference domain entities
(`[[entity:settlement]]`, `[[entity:reservation]]`, `[[entity:invoice]]`). Design + status
also recorded in the `knowledge-store-phase0` memory. No sibling tracks yet.
