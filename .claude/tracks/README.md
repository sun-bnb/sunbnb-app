# Tracks

Durable, resumable, parallelizable units of long-horizon work. A **track** is the
agentic-architecture primitive for an effort that outlives a single session: a goal, its
roadmap, its current position, and its trajectory — persisted *outside* any session so any
future session (or a parallel agent) can pick it up exactly where the last one stopped.

## Where it fits

The **intent layer** of the context system — the only layer that points at the future:

| Layer | Question | Lives in |
|---|---|---|
| Canonical | what are the rules | `CLAUDE.md`, `.claude/rules/` |
| Semantic | how does the system work | `.claude/wiki/` |
| Episodic | what happened in sessions | knowledge store (pgvector) |
| Factual | what's true about us | memory |
| **Intentional** | **what are we doing, where are we** | **`.claude/tracks/` (here)** |

## Anatomy of a track

One file per track: `NNN-slug.md`. Frontmatter is machine-readable (drives the registry);
the body is the agent-readable contract.

```markdown
---
id: 001-knowledge-store
title: Knowledge Store
status: active        # proposed | active | blocked | paused | done | abandoned
created: 2026-05-20
updated: 2026-05-20
worktree: null        # path/branch when run in isolation
---

## Goal          — the end state and why it matters
## Resume here   — Next action · Context needed · Blocked by   ← the cold-start contract
## Roadmap       — phases/steps, each marked ✅ done / ▶ current / ☐ next / 💤 backlog
## Log           — append-only, dated: decisions, deviations, completed phases
## Open decisions
## Links         — [[subsystem:x]] / [[entity:y]] wiki refs · [[track:NNN-slug]] siblings
```

### The Resume-here contract (the load-bearing part)

A cold agent with zero memory of the last session must, from **Resume here** alone, know
**the single next action** and **the exact context it needs** (files, prior decisions,
commands). Humans don't need this — we remember; agents do. If you write nothing else well,
write this. It is what makes "advance step-by-step across sessions" actually work.

## Lifecycle

```
proposed ──▶ active ──▶ done
              ▲  │
       paused ┘  └─▶ blocked ──▶ active
   any state ───────────────────▶ abandoned
```

Status lives in frontmatter; `index.md` is the control plane derived from it.

## Parallelism

Each active track may bind to a git **worktree** (`worktree:` in frontmatter) so parallel
agents on different tracks never collide. One worktree + one track per concurrent effort;
the registry shows them all.

## Conventions (shared with the wiki)

- Frontmatter + status discipline, append-only `Log`, `[[type:slug]]` cross-refs.
- Cross-ref types: the wiki's (`entity`, `flow`, `subsystem`, `workflow`) plus `track`.
- One concern per track; split if it sprawls.
- **Sub-documents.** A track may own companion files (a design, a baseline, a manual test
  plan): `NNN-slug.<part>.md` or any name, with frontmatter `parent: NNN-slug` (+ optional
  `title:`). They are listed under the parent in the registry, never as rows, and the health
  check flags any `.md` here that is neither a track nor a sub-document.
- **Status is frontmatter only.** `context-health.mjs` enforces the vocabulary, flags an
  `active` track untouched for 45 days (handoff it or set `paused`/`done`), and flags a
  registry that no longer matches the files.

## Operating it

See `workflows/`: **create** · **resume** · **handoff** · **close**. The **handoff** step
(update roadmap → append log → rewrite Resume-here) is what keeps a track resumable — the
*curated* complement to the knowledge store's *automatic* session capture.

## Registry

`index.md` lists every track with its status, next action (the first line of its **Resume
here**, capped at 220 chars), and worktree. **Start there.** It is **generated** — run
`node .claude/scripts/tracks-index.mjs` after every handoff/close (`--check` tells you if it
is stale; the session-start health line does too). Never edit it by hand.

Legacy phased plans in `.claude/plans/` predate this layer and are not tracks; migrate one
only if/when it becomes an active effort.
