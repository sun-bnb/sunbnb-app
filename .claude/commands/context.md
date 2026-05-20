# /context — AI context metadata management

Multi-layer operations across the AI context metadata: wiki, CLAUDE.md tree, `.claude/rules/`, and `PROJECT_CONTEXT.md`. Workflows are canonical under `.claude/context/workflows/`.

> **Objective of every context operation:** after the operation, agents working with the project are more *informed*, *effective*, *reliable*, *concise*, and *deterministic*. The gate is defined in `.claude/wiki/README.md` § Maintenance discipline and applies identically to all layers.

## Usage

- `/context check` — **stateless probe.** Runs the mechanical drift detector on all layers (or a specific scope). Read-only, ~0 tokens. Same script the pre-push hook runs.
  - `/context check --scope wiki` — wiki only
  - `/context check --scope canonical` — canonical only (CLAUDE.md tree, rules, PROJECT_CONTEXT.md)
  - `/context check --scope all` (default) — both
- `/context sync` — **stateful tracker.** Reads `.claude/context/state.json`, computes `git log <cursor>..HEAD`, plans updates (dispatches to `/wiki ingest` and `/update-knowledge`), asks for confirmation, advances the cursor only on success.
- `/context status` — show the current cursor state (last synced SHA + timestamp + branch + by). Read-only.
- `/context help` — print the full operating manual (`.claude/context/help.md`). Read-only.

## Instructions

Parse `$ARGUMENTS` to get the subcommand (first whitespace-delimited token) and any flags.

### Step 1 — Resolve the subcommand

| Subcommand | Workflow file | Behavior |
|---|---|---|
| `check`  | `.claude/context/workflows/check.md` | Run `node .claude/scripts/detect-drift.mjs [--scope <s>]`; report stdout verbatim. No LLM analysis. |
| `sync`   | `.claude/context/workflows/sync.md`  | Read state, plan, ask, execute, advance cursor. **Plan-first — never write without user confirmation.** |
| `status` | (no workflow file — trivial)         | Read `.claude/context/state.json` and pretty-print. If missing, report "never synced." |
| `help`   | (no workflow file)                   | Read `.claude/context/help.md` and print verbatim. No analysis, no synthesis — just display the manual. |
| (none)   | (suggest based on signals — see below) |

### Step 1a — Auto-suggest (no subcommand)

If no subcommand was provided, inspect state and recommend ONE operation:

1. Read `.claude/context/state.json` if present
2. Compute commits since `lastSyncedSha` (if any)
3. Run `node .claude/scripts/detect-drift.mjs` quickly
4. Suggest the most relevant:
   - Drift findings ≥ 1 → `/context check` (and surface the broken count)
   - Commits since cursor ≥ 5 (or never synced and not on a clean main) → `/context sync`
   - Both → `/context check` first (cheap), `/context sync` after triage
   - Neither → "Context is in sync and clean. Nothing to do."

Output the suggestion as a single sentence + a one-line "why".

### Step 2 — Read the workflow file (for check / sync)

Read the full workflow file. It is the canonical procedure — do not improvise.

### Step 3 — Execute the workflow

Follow the workflow's "Procedure" section to the letter.

For `check`: invoke the script via Bash and pass the output through. Optionally summarize.

For `sync`:
- Read the state file (or treat as empty if missing)
- Compute the commit window
- Apply the wiki-worthiness gate per change
- **Produce the plan and wait for user confirmation** — do not execute without explicit approval
- On approval, dispatch to `/wiki ingest` and `/update-knowledge` in deterministic order (canonical first, then wiki)
- On success, write the new SHA to `.claude/context/state.json`
- On any dispatched command failure: halt, do not advance the cursor

### Step 4 — Log (sync only)

Append a `[YYYY-MM-DD] sync` entry to `.claude/wiki/log.md` per the format in `.claude/context/workflows/sync.md` § Step 8.

### Step 5 — Report

Brief report back to the user: what was done, what was skipped (with reasons), new cursor SHA (for sync), follow-up suggestions if any.

## Non-negotiables

- **Check is read-only.** Never modify files during `/context check`.
- **Sync is plan-first.** Never write without user confirmation.
- **Cursor advances only on full success.** Partial failures leave the cursor where it was so re-runs are clean.
- **Dispatch, don't reinvent.** `/context sync` calls `/wiki ingest` and `/update-knowledge`; do not bypass their per-layer worthiness gates.
- **The five qualities are the gate** (see top of this file). An operation that fails the gate is a no-op, properly logged as such.

## Related

- `.claude/wiki/README.md` § Maintenance discipline — defines the five-qualities gate
- `.claude/commands/wiki.md` — wiki-specific operations (ingest, lint, prune, review)
- `.claude/commands/update-knowledge.md` — canonical-layer ingest
- `.claude/scripts/detect-drift.mjs` — the script invoked by check and the pre-push hook
