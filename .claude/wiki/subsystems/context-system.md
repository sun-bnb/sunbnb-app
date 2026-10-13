---
type: subsystem
slug: context-system
status: stable
sources:
  - CLAUDE.md
  - .claude/context/budgets.json
  - .claude/scripts/context-health.mjs
  - .claude/scripts/knowledge-recall.mjs
  - .claude/scripts/knowledge-curated.mjs
  - .claude/scripts/knowledge-ingest.mjs
  - .claude/settings.json
  - .claude/commands/groom.md
related:
  - workflow:ingest
  - workflow:lint
  - workflow:context-check
  - workflow:context-sync
last_verified: 2026-10-13
---

# Context system — how knowledge reaches, and stays fit for, every session

The machinery that gives each Claude Code task the sharpest relevant context and keeps that
context correct as the code moves. Built over tracks 001 (episodic store) and 031 (curation
loop). The **one** statement of what loads when lives in root `CLAUDE.md` § Context system;
this page is the mental model behind it.

## The six layers

| Layer | Lives in | Written by | Curated by | Loaded |
|---|---|---|---|---|
| Canon | root + per-surface `CLAUDE.md`, `.claude/rules/` | `/update-knowledge`, feature work | `/update-knowledge` within `budgets.json` | root + rules every session; a surface's `CLAUDE.md` when its files are read |
| Pulled siblings | `apps/*/{TESTING,UI,PATTERNS,…}.md`, `packages/data/{EXPORTS,REFERENCE}.md` | same | same | on demand only |
| Wiki | `.claude/wiki/` | `/wiki ingest`, `/groom` proposals | `/wiki lint` → `prune` → `review` | on demand; indexed into recall |
| Playbooks | `.claude/knowledge/<agent>.md` | the agent's retrospective | `/groom <agent>` | nav index at agent task start; indexed into recall |
| Tracks | `.claude/tracks/` | `create` / `handoff` / `close` workflows | the health check (status, staleness) | registry on demand; resume-heres indexed into recall |
| Episodic | pgvector store (`sunbnb-knowledge-postgres`, :5434) | SessionEnd hook distils every session + subagent | `--credit`, `--candidates` → `/groom` | via `/recall` only |

User-level memory (`~/.claude/projects/<repo>/memory/`) sits beside these and holds only what
the repo cannot: who the user is and how they want to work. Anything the repo documents is
deleted from memory, not duplicated.

## Trust and authority

Trust rises episodic → playbook → wiki → canon; authority runs the same way — canon always wins,
and a lower layer that contradicts the code is the bug. Knowledge moves **up** by recurring and
being verified: a credited or recurring episodic record becomes a playbook entry (inbound, in
`/groom`); an authoritative, cross-cutting playbook entry is **proposed** for the wiki or canon
(outbound, never applied silently — changing what every session loads is a human decision).

## Retrieval: one query, tiered

All of wiki (per `##` section), playbooks (per entry, `source=playbook:<agent>`), track
resume-heres and episodic records sit in **one** store, labelled by `source` and `status`
(`promoted` / `verified` / `raw`). `knowledge-recall.mjs "<topic>" --surface <agent>` returns them
grouped by tier with a status boost and recency decay; agents read that plus their playbook's
generated nav index, and open full entries by heading only when pointed at them. The curated
index refreshes detached at session start (`knowledge-curated.mjs`, SHA-upsert — only changed
units re-embed). Hits that helped are credited (`--credit <id,id>`: hits+1, raw → verified).

## Health: one signal, nag never block

`context-health.mjs` checks every layer mechanically in < 1 s (citations and symbols, budgets,
freshness, status vocabulary, edited-after-verified, generated-index drift, version claims,
workspaces without a `CLAUDE.md`; `--with-store` adds store counts). Its `--summary` line prints
at **SessionStart** (`.claude/settings.json`) and in **pre-push** (`.githooks/pre-push`), with the
fix command for the worst findings. Every threshold lives in `.claude/context/budgets.json`.
Curation workflows end with `--snapshot`, appending to `.claude/context/health-history.jsonl` —
the record of whether the system is actually getting better.

## Invariants

1. **One statement per fact.** Loading model in root `CLAUDE.md`; budgets in `budgets.json`;
   rules in `.claude/rules/`. Everything else points at them.
2. **Registries are generated, never hand-edited** — `tracks/index.md` (`tracks-index.mjs`),
   playbook nav blocks (`playbook-index.mjs`). The health check flags drift.
3. **Auto-loaded bytes are the scarce resource.** A surface `CLAUDE.md` keeps compact tables;
   narrative goes to a pulled sibling or the wiki, leaving a one-line pointer.
4. **Curation verifies against code before it deletes.** Grooms and lint passes open the cited
   file; low-confidence cuts are listed for the human, not made.
5. **Promotion upward is proposed, not applied** by the layer below.
6. **The pipeline is keyless and local** — distillation via `claude -p`, embeddings via a local
   model; the store is optional (every hook exits 0 without Docker).

## Cadence

| When | What runs |
|---|---|
| Every session start | health summary; Docker + store check; curated re-index (detached) |
| Every session end | ingest of the session + its subagents |
| Agent task start / end | tiered recall + nav index / `kb:` markers, credits, v2 playbook entry |
| Every push | health summary (warn-only) |
| Playbook over budget | `/groom <agent>` |
| After shipping something non-trivial | `/wiki ingest`; track `handoff` / `close` |
| Weekly-ish | `/context sync` (catch canon + wiki up to commits since the cursor) |
| Wiki feels heavy / monthly | `/wiki lint` → `prune`; `/wiki review` |

## Pitfalls

- **Writing without curating.** The failure mode track 031 fixed: every write path automated,
  no curate path ever run. A new writer needs a matching curator and a health check.
- **Copying canon into a lower layer** (playbook, agent definition, memory) — it drifts. Point.
- **Bumping `last_verified` without re-checking** — the health check cannot tell; the page lies.
- **Running the curated re-index or `--snapshot` from parallel agents** — the orchestrator runs
  them once after a batch (concurrent store writes).
- **Treating a recall hit as truth.** Episodic records describe the code as it was; verify.

## Cross-refs

- [[workflow:context-check]] · [[workflow:context-sync]] · [[workflow:ingest]] · [[workflow:lint]]
- [[track:031-context-system-v2]] (design + history) · [[track:001-knowledge-store]] (the store)
- Specs: `.claude/knowledge/README.md` (playbooks), `.claude/tracks/README.md`, `.claude/agent-protocol.md`
