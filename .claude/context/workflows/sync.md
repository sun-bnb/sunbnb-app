---
type: workflow
slug: context-sync
status: stable
sources:
  - .claude/context/state.json
  - .claude/scripts/context-health.mjs
  - .claude/commands/context.md
  - .claude/commands/wiki.md
  - .claude/commands/update-knowledge.md
  - .claude/commands/groom.md
related:
  - workflow:context-check
  - workflow:ingest
last_verified: 2026-10-13
---

# Workflow: /context sync — stateful change tracker

Reads a per-developer cursor to know **which commit the AI-context layers were last synced to**, walks every commit since, and decides what should be folded into canon and the wiki. Plan-first: it proposes, asks, executes accepted items through the per-layer commands, advances the cursor only on full success, and ends with a health snapshot.

It is the "follow-up after work" tool — run when you've stopped coding for a while and want the context current with everything that landed since your last sync. `/context check` (`[[workflow:context-check]]`) is the stateless counterpart: check often, sync when there's a batch to roll in.

## How it serves the five qualities

Walking *every* commit since the cursor (not just what you remember) keeps agents *informed*; dispatching each change through the per-layer gates adds only what makes them more *effective* or *reliable*; advancing the cursor only on success keeps re-runs *deterministic*; the gate stops bulk syncing from costing *concise*. Gate: `.claude/wiki/README.md` § Maintenance discipline.

## The cursor

`.claude/context/state.json` — **gitignored, one per developer and checkout** (it is never shared; a worktree or a fresh clone starts unsynced). Fields: `lastSyncedSha`, `timestamp`, `branch`, `by`; `null` values (or a missing file) mean "never synced". `/context status` pretty-prints it. It is a convenience marker, not authoritative state — the canon and wiki files are the truth.

## Procedure

### 1. Read the cursor and compute the window

```sh
LAST="$(jq -r '.lastSyncedSha // empty' .claude/context/state.json 2>/dev/null)"
git log  "${LAST:-HEAD~20}..HEAD" --oneline
git diff "${LAST:-HEAD~20}...HEAD" --stat
```

Never synced → use `HEAD~20` or `main..HEAD`, whichever is fewer commits, and tell the user the window. A cursor SHA that is no longer an ancestor of `HEAD` (rebased away) → say so and fall back the same way. Zero commits in the window → report "already in sync" and stop; don't touch the state file.

### 2. Read the mechanical signal

```sh
node .claude/scripts/context-health.mjs --summary
```

Findings that the window explains (a moved source, a stale page whose code changed) become plan items in step 3. Unrelated findings are listed in the plan as context, with the fix command the script prints (e.g. `/groom <agent>` for a playbook over budget, `node .claude/scripts/tracks-index.mjs` for a stale track registry) — sync doesn't fix them unless the user accepts that item.

### 3. Classify each change

Per concept (not per commit size), apply the gate:

| Bucket | Dispatched to | Typical trigger |
|---|---|---|
| `canonical` | `/update-knowledge <scope>` (budgets from `.claude/context/budgets.json`) | Rule/convention change; route or action contract change; new app or package |
| `wiki` | `/wiki ingest <pages>` | New entity/flow/subsystem; invariant change; gotcha worth recording; moved source |
| `both` | canonical first, then wiki | Cross-layer change |
| `skip` | — | Bug fix without a gotcha, pure refactor, formatting, dep bump, WIP |

Playbooks and tracks are not sync targets: agents write playbook entries via `kb:` markers and `/groom` curates them; tracks are updated by their `handoff` workflow.

### 4. Produce the plan — do not execute yet

```
/context sync — plan
Cursor: abc123 (2026-10-01) → HEAD def456, 12 commits.
Health: context-health: 0 broken · 2 warn (wiki 1 warn, playbooks 1 warn)
  [canonical] a1b2..d4e5 — new requireFoo() guard on partner site mutations → /update-knowledge apps/partner/CLAUDE.md
  [wiki]      f6a7 — subscription cancellation flow landed → /wiki ingest flows/subscription-cancellation.md (new)
  [both]      b8c9 — settlement gained a HOLD state → /update-knowledge packages/data/CLAUDE.md, then /wiki ingest entities/settlement.md
  [skip × 9]  formatting (2), dep bumps (3), bug fixes without gotchas (4)
  [unrelated] playbooks/partner-dev.md over soft budget → /groom partner-dev
Apply all? Per item? Change scope? Skip?
```

### 5. Wait for the user's decision

Apply all, a subset, a refined scope, or nothing. **No write to canon, wiki or the state file before confirmation.**

### 6. Execute the accepted items

Dispatch each to its command — those enforce their own per-layer gates as a second check; don't bypass or re-implement them. Order: canonical first (so wiki ingests cite current canon), wiki second. If any dispatched command fails → halt; the cursor stays put.

### 7. Advance the cursor

Only after every accepted item succeeded:

```sh
jq -n --arg sha "$(git rev-parse HEAD)" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      --arg br "$(git rev-parse --abbrev-ref HEAD)" --arg by "$(git config user.name)" \
      '{lastSyncedSha:$sha, timestamp:$ts, branch:$br, by:$by}' > .claude/context/state.json
```

### 8. Log it

Append to `.claude/wiki/log.md`:

```
## [YYYY-MM-DD] sync | cursor abc123 → def456
- changed: <canon + wiki files touched>
- skipped: <M changes, by reason>
```

### 9. Snapshot and report

Finish with `node .claude/scripts/context-health.mjs --snapshot` — it appends that run's metrics to `.claude/context/health-history.jsonl` (committed), the series that shows whether the context gets better over time. Then report: what was done, what was skipped and why, the new cursor SHA, any follow-up (often none).

## When to run

- After a stretch of coding without syncing — end of a feature, end of week
- After pulling others' commits — your cursor hasn't seen them
- Before opening a non-trivial PR, so review sees an aligned wiki
- On demand — `/context sync`

## Anti-patterns

- **Executing without showing the plan.** Surprises in context writes erode trust.
- **Advancing the cursor on partial failure.** Failed runs must be re-tryable from the same point.
- **Skipping the gate because "the commit was big".** Big commits are often mostly skip-worthy.
- **Re-implementing `/wiki ingest` or `/update-knowledge` in sync.** Sync dispatches.
- **Committing `state.json`** or treating it as shared state — it is per developer by design.
- **Manual `/wiki ingest` between syncs is fine**, but the next sync re-walks that window; its gate will skip what's already current.
