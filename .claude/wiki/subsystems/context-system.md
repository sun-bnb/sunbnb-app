---
type: subsystem
slug: context-system
status: stable
sources:
  - CLAUDE.md
  - .claude/settings.json
  - .claude/context/budgets.json
  - .claude/context/project.json
  - .githooks/pre-push
related:
  - track:033-context-system-plugin
  - track:031-context-system-v2
last_verified: 2026-10-13
---

# Context system — Sunbnb's instance of context-loop

How knowledge reaches every Claude Code session here and stays current. The machinery is the
**context-loop plugin** (github.com/vhalme/context-loop), extracted from this repo in
[[track:033]]. Its architecture — the six layers, trust ladder, tiered retrieval, health check,
invariants and cadence — is specified once in `.claude/context/engine/specs/context-system.md`.
This page covers only what is specific to Sunbnb. The loading model is stated in root
`CLAUDE.md` § Context system.

## Engine vs instance

| Engine (plugin, `.claude/context/engine` → installed copy) | Instance (this repo) |
|---|---|
| `scripts/` — health check, registries, knowledge store | `.claude/context/budgets.json` — thresholds, version claims, agent surfaces |
| `skills/` — `context`, `recall`, `groom`, `wiki`, `update-knowledge`, `track` | `.claude/context/project.json` — slug `sunbnb`, store, entity vocabulary |
| `specs/` — wiki, playbooks, tracks, context-system | `CLAUDE.md` tree, `.claude/rules/`, wiki pages, playbooks, tracks, agents |
| `hooks/` — SessionStart health line + link + store, SessionEnd ingest | `.githooks/pre-push` (health line via the engine link), `.claude/agent-protocol.md` |

The plugin is enabled for everyone through `.claude/settings.json` (`extraKnownMarketplaces` +
`enabledPlugins`). `.claude/context/engine` is a git-ignored link refreshed each session; a fresh
clone has it after its first session.

## Sunbnb specifics

- **Store:** `sunbnb-knowledge-postgres` on :5434, database `sunbnb_knowledge` (`project.json`);
  `scripts/bootstrap.sh` provisions it. Embeddings are local, distillation uses `claude -p`.
- **Surfaces:** five dev agents (`user-dev`, `partner-dev`, `admin-dev`, `data-dev`,
  `sunbed-inventory`); their path prefixes in `budgets.json` `agents.surfaces` drive
  `--surface` recall and `--candidates`.
- **Pulled siblings:** `apps/*/{TESTING,UI,PATTERNS}.md`, `apps/user/HW-API.md`,
  `apps/partner/ASSISTANT.md`, `packages/data/{EXPORTS,REFERENCE}.md`.
- **Health in pre-push:** `.githooks/pre-push` prints the summary line before the shared-TEST-DB
  migration guard; it never changes the hook's exit code.

## Pitfalls

- **Editing the engine here.** There is no local copy; change the plugin repo, release, and
  let Claude Code update it. A repo-specific value belongs in `budgets.json` or `project.json`.
- **A missing `.claude/context/engine`** (fresh clone, plugin not yet installed) makes the
  pre-push health line silently skip and agents' `node .claude/context/engine/…` calls fail —
  start a session with the plugin enabled first.
