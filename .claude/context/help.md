# /context — Operating Manual

How to work with the AI-context system day to day. The model behind it — layers, trust ladder,
retrieval, health signal, invariants — is `.claude/wiki/subsystems/context-system.md`; read that
once before changing anything under `.claude/`.

## Setup

None beyond Docker for the optional recall store. The committed `.claude/settings.json` prints a
one-line context-health summary at every session start and keeps the store indexed;
`.githooks/pre-push` prints the same line on every push (warn-only, never blocks).

**Loading:** root `CLAUDE.md`, `.claude/rules/*.md` and the memory index load in every session; a
directory's `CLAUDE.md` loads when a file under it is read; `TESTING.md`, `UI.md` and other
siblings, the wiki, playbooks and tracks are pulled on demand.

## Quick reference

| Command | What it does | Cost | When |
|---|---|---|---|
| `/context check` (`health`) | Full health report, every layer, fix command per finding | ~0 | When the session-start line shows findings |
| `/context sync` | Walk commits since your cursor, plan canon + wiki updates, ask, apply | LLM, scoped | Weekly-ish, or after a stretch of work |
| `/context status` | Show your sync cursor | ~0 | When you forget where you left off |
| `/recall <q> [--surface <agent>]` | Tiered recall: wiki → playbook → track → past sessions; `--credit <ids>` when a hit helped | ~0 | Task start; "have we hit this before?" |
| `/groom <agent>` | Curate one playbook; promotion proposals both ways | LLM | When the health line says a playbook is over budget |
| `/wiki ingest [scope]` | Fold a change into the wiki (may decide "skip") | LLM | After shipping something wiki-worthy |
| `/wiki lint` · `prune` · `review` | Semantic health → remove dead content → strategic re-pass | LLM | When the wiki feels heavy; monthly |
| `/update-knowledge [scope]` | Keep the `CLAUDE.md` tree + rules correct and inside `budgets.json` | LLM, scoped | After a convention change, or a canonical health finding |
| `/review`, `/test`, `/migrate`, `/db`, `/ui` | Code review · test runner · migrations · DB inspection · design language | — | As needed |

## Daily flow

1. **Start.** Read the health line. Check `.claude/tracks/index.md` if the work spans sessions,
   and resume that track. For an unfamiliar area, `/recall <topic>` before reading code.
2. **Delegate scoped work** to the surface agent (`partner-dev`, `user-dev`, `admin-dev`,
   `data-dev`, `sunbed-inventory`); each pulls a tiered recall + its playbook index and credits
   what helped.
3. **Test, review, commit** (`/test`, `/review`, `/commit`). Commit playbook changes with the work.
4. **After shipping:** `/wiki ingest` if the change passes the gate; track `handoff` (or `close`)
   and `node .claude/scripts/tracks-index.mjs`.
5. **Push.** The pre-push line shows whether the change left the context worse.

## Maintenance cadence

| Cadence | What |
|---|---|
| Every session / push | health summary (automatic) |
| Per feature | `/wiki ingest` or `/update-knowledge` if the gate passes — skipping is valid |
| When nagged | `/groom <agent>` (playbook budget) · `/update-knowledge <file>` (canonical budget) |
| Weekly-ish | `/context sync` |
| Monthly | `/wiki lint` → `/wiki prune`; `/wiki review` |
| After any curation batch | `node .claude/scripts/context-health.mjs --snapshot` (trend in `health-history.jsonl`) |

## Two principles

1. **The gate applies to every write.** Gain at least one of *informed, effective, reliable*;
   sacrifice none of *concise, deterministic* (`.claude/wiki/README.md` § Maintenance discipline).
   Doing nothing is a valid outcome.
2. **Curation is plan-first and verified.** Sync and groom propose before they write, delete only
   after opening the cited code, and never promote into canon silently.

## Where things live

- Model: `.claude/wiki/subsystems/context-system.md` · budgets: `.claude/context/budgets.json`
- Scripts: `.claude/scripts/` (`context-health`, `knowledge-{ingest,curated,recall,ensure,hook}`,
  `playbook-index`, `tracks-index`)
- Procedures: `.claude/context/workflows/`, `.claude/wiki/workflows/`, `.claude/tracks/workflows/`,
  `.claude/knowledge/workflows/groom.md`
- Cursor (per developer, gitignored): `.claude/context/state.json`
