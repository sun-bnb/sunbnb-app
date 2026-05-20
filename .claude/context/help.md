# /context — Operating Manual

How to use the AI context metadata tools for this project. Organized by what you're trying to do.

## One-time setup

```sh
.claude/wiki/scripts/install-hook.sh
```

Installs the pre-push drift check. From here on, every `git push` runs `/context check` automatically — warn-only, never blocks.

## Quick reference

| Command | What it does | Cost | When |
|---|---|---|---|
| `/context check` | Read-only drift probe, all layers | ~0 tokens | Pre-push (auto), or manual any time |
| `/context sync` | Walks commits since your cursor, plans updates, asks before executing | LLM, scoped | After a stretch of work, before opening a PR |
| `/context status` | Shows your sync cursor | ~0 | When you forget where you left off |
| `/context help` | This guide | ~0 | When you need a refresher |
| `/wiki ingest [scope]` | Fold a specific change into the wiki | LLM, scoped | Right after shipping something wiki-worthy |
| `/wiki lint` | Full LLM health check on the wiki | LLM | Before `/wiki review` |
| `/wiki lint --quick` | Wiki-only mechanical drift (alias of `/context check --scope wiki`) | ~0 | Quick spot-check |
| `/wiki prune` | Actively remove dead content | LLM, scoped | After lint surfaces medium-tier findings |
| `/wiki review` | Strategic re-pass — is each page earning its keep? | LLM | Monthly, or post-major-release |
| `/update-knowledge [scope]` | Sync the CLAUDE.md tree + `.claude/rules/` | LLM, scoped | After a non-trivial rule/convention change |
| `/review` | Pre-push code review against project rules | LLM | Before pushing |
| `/test`, `/migrate` | Test runner / migration assistant | — | As needed (pre-existing) |

## Daily flow — plan → code → push

1. **Start the task.** CLAUDE.md tree + `.claude/rules/` are already auto-loaded into the session. If the task is unfamiliar or complex, browse `.claude/wiki/index.md` first — entity / flow / subsystem pages give synthesis the auto-loaded layer can't.
2. **Code it.** If a sub-agent fits the scope (`user-dev`, `partner-dev`, `admin-dev`, `data-dev`), it gets dispatched automatically — each has its own knowledge base and tighter focus.
3. **Test.** `/test` runs the relevant suites.
4. **Pre-push review.** `/review` catches auth / payment / convention violations against the canonical rules layer.
5. **Push.** The pre-push hook runs `/context check` — warns if your changes broke any metadata claims (deleted file still cited, renamed symbol, etc.). Warn-only; doesn't block.
6. **Fold updates in (optional, on-demand).** If you know the change was wiki-worthy, `/wiki ingest <scope>` now. Or batch it for later (next step).

## End-of-week / end-of-feature flow

7. **Catch up the metadata.** `/context sync` reads your cursor, walks every commit since, applies the worthiness gate per change, and produces a plan:
   > *"Cursor: abc123 → HEAD, 12 commits. Proposed: 2 canonical-ingests, 1 wiki-ingest, 9 skipped per gate. Apply?"*
8. **You confirm or refine.** Sync dispatches to `/update-knowledge` and `/wiki ingest` for accepted items. Cursor advances only on full success.

## Specific situations

| What you're trying to do | Tool |
|---|---|
| "How does X work?" | Browse `.claude/wiki/index.md`, then the relevant page; drop to source if needed |
| "Did I just break something documented?" | `/context check` |
| "Is my doc layer current with the code?" | `/context check` (mechanical) then `/wiki lint` (semantic, LLM) |
| "I've been heads-down for a week" | `/context sync` |
| "I added something wiki-worthy" | `/wiki ingest [pages]` |
| "I changed a convention" | `/update-knowledge [scope]` |
| "The wiki feels heavy / cluttered" | `/wiki lint` → `/wiki prune` (paired: detect then remove) |
| "Are wiki pages still well-scoped?" | `/wiki review` (monthly) |
| "Where did I leave off syncing?" | `/context status` |

## Maintenance cadence

| Cadence | What |
|---|---|
| **Every push** | `/context check` (auto via hook) |
| **Per feature** | `/wiki ingest` or `/update-knowledge` if the change passes the gate (often: skip) |
| **Weekly-ish** | `/context sync` to catch up the cursor |
| **When wiki feels heavy** | `/wiki lint` → `/wiki prune` |
| **Monthly** | `/wiki review` — strategic re-pass |

## Two principles to keep in mind

1. **The gate applies to every write.** Gain at least one of *(informed, effective, reliable)*; sacrifice none of *(concise, deterministic)*. **Skipping is a valid outcome** — most changes don't warrant a metadata update, and that's the design.

2. **Sync is plan-first.** `/context sync` never writes without your confirmation. The cursor advances only on full success — partial failures leave it where it was, so re-runs pick up cleanly.

## What you don't need to invoke

- **Auto-loaded** every session: root `CLAUDE.md` + the `@` chain (app + package CLAUDE.md files) + `.claude/rules/*.md` + your memory index.
- **Auto-dispatched** when judgment says useful: sub-agents (user-dev, partner-dev, admin-dev, data-dev), the Explore agent for code search, Plan agent for non-trivial design.
- **Auto-fired** post-setup: the pre-push drift check.

Everything else is on-demand. The system is deliberately user-controlled at the metadata-write boundary — the gate works because *you* decide when to apply it.

## Where the canonical definitions live

- **The five-qualities gate:** `.claude/wiki/README.md` § Maintenance discipline
- **Wiki workflow procedures:** `.claude/wiki/workflows/`
- **Context workflow procedures:** `.claude/context/workflows/`
- **Slash command dispatchers:** `.claude/commands/`
- **Drift detector script:** `.claude/scripts/detect-drift.mjs`
- **Sync cursor (per-developer, gitignored):** `.claude/context/state.json`
