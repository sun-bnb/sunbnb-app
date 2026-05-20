---
type: workflow
slug: context-sync
status: stable
sources:
  - .claude/context/state.json
  - .claude/scripts/detect-drift.mjs
  - .claude/commands/wiki.md
  - .claude/commands/update-knowledge.md
related:
  - workflow:context-check
  - workflow:ingest
last_verified: 2026-05-20
---

# Workflow: /context sync — stateful change tracker

Reads a persistent cursor (`.claude/context/state.json`) to know **what git state the AI context metadata was last synced to**, then walks every commit since and decides what should be folded into the wiki and canonical layers. Plan-first: surfaces a proposal, asks before executing, advances the cursor only on success.

This is the "follow-up after work" tool — invoked when you've stopped coding for a while and want to bring the metadata up to date with everything that's landed since you last synced.

## How it serves the five qualities

Sync's gain side: by walking *every* commit since the cursor (not just what you remember), agents stay *informed* on what changed in code. By applying the wiki-worthiness gate per commit, it adds only what makes them more *effective* or *reliable*. By advancing the cursor only on success, it stays *deterministic* — re-runs pick up cleanly from where the last successful run left off. Bound-checked by the gate so the act of syncing doesn't sacrifice *concise* through bulk updates.

## State file shape

`.claude/context/state.json` (gitignored — per-developer cursor):

```json
{
  "lastSyncedSha": "abc123def456...",
  "timestamp": "2026-05-20T14:00:00Z",
  "branch": "main",
  "by": "vhalme"
}
```

Empty / missing state file = "never synced." First run treats `HEAD~20` (or branch divergence from `main`, whichever is shorter) as the implicit cursor to bound the initial window.

## Procedure

### 1. Read the cursor

```sh
test -f .claude/context/state.json && cat .claude/context/state.json
```

If missing: this is a first run. Use `HEAD~20` or `main..HEAD` (whichever is fewer commits) as the implicit baseline. Surface this to the user so they know the window.

### 2. Compute the change window

```sh
LAST="$(jq -r .lastSyncedSha .claude/context/state.json 2>/dev/null)"
git log "${LAST:-HEAD~20}..HEAD" --oneline
git diff "${LAST:-HEAD~20}...HEAD" --stat
```

If the window has zero commits → report "already in sync" and exit. Do not write to state file (already current).

### 3. Walk the commits and classify

For each commit (or for the aggregate diff, depending on size), apply the **wiki-worthiness gate** (see `.claude/wiki/README.md` § Maintenance discipline):

> *"Will an agent doing typical project work be more informed, effective, reliable, concise, or deterministic after this update — without becoming less of any of these?"*

Classify each change into one bucket:

| Bucket | Target command | Notes |
|---|---|---|
| `canonical-ingest` | `/update-knowledge <scope>` | Rule/convention change; route/action contract change; new app or package |
| `wiki-ingest` | `/wiki ingest <pages>` | New entity, flow, subsystem; new gotcha worth recording; invariant change |
| `both` | both, in order: canonical first, then wiki | Cross-layer changes |
| `skip` | (none) | Fails the gate: bug fix without gotcha, pure refactor, formatting, dep bump, WIP |

### 4. Produce the plan

Output a structured plan (do NOT execute yet):

```
/context sync — plan
Cursor: abc123 (2026-05-15) → HEAD (2026-05-20), 12 commits in window.

Proposed actions:
  [canonical-ingest] commits a1b2..d4e5 — added requireFoo() guard on partner site mutations
    → /update-knowledge partner

  [wiki-ingest]      commit f6a7 — new "subscription cancellation" flow landed
    → /wiki ingest flows/subscription-cancellation.md (new page)

  [both]             commit b8c9 — Settlement DRAFT→PAID lifecycle gained a HOLD state
    → /update-knowledge data, then /wiki ingest entities/settlement.md

  [skip × 9] formatting (2), dep bumps (3), bug fixes without gotchas (4)

Apply all? Per-item? Modify scope? Skip?
```

### 5. Wait for user decision

The user can: apply all, accept a subset, refine a scope, or skip entirely. **Do not write to any wiki / canonical / state file until the user confirms.**

### 6. Execute the accepted items

For each accepted item, dispatch to the matching command — these enforce their own per-layer worthiness gates as a second check. Do not bypass them.

Execute in deterministic order: canonical first (so wiki ingests cite up-to-date sources), wiki second.

If any dispatched command fails → halt. Do not advance the cursor. The user can retry after fixing.

### 7. Advance the cursor

**Only after all accepted items executed successfully:**

```sh
NEW_SHA="$(git rev-parse HEAD)"
NEW_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > .claude/context/state.json <<EOF
{
  "lastSyncedSha": "$NEW_SHA",
  "timestamp": "$NOW",
  "branch": "$NEW_BRANCH",
  "by": "$(git config user.name)"
}
EOF
```

### 8. Log it

Append to `.claude/wiki/log.md`:

```
## [YYYY-MM-DD] sync | cursor advanced abc123 → def456
- mode: sync
- changed: <wiki + canonical files touched, summarized>
- reason: rolled in N commits worth of accepted changes; M skipped per worthiness gate
- by: <user>
```

### 9. Report

Brief summary back to the user: what was done, what was skipped (with reasons), new cursor SHA, suggested next action (often: nothing — you're in sync).

## When to run

- **After a stretch of coding without syncing** — e.g., end of week, end of feature
- **After pulling teammate's changes** — your local cursor hasn't advanced for their commits
- **Before opening a non-trivial PR** — bring metadata current so the PR review sees an aligned wiki
- **On demand** — `/context sync`

Per `[[workflow:context-check]]` cadence: check often (cheap); sync when there's a meaningful batch to roll in.

## Anti-patterns

- **Auto-executing without showing the plan.** Always plan-first. Surprises in metadata writes erode trust.
- **Advancing the cursor on partial failure.** Cursor advances only on full success; failed runs are re-tryable.
- **Skipping the wiki-worthiness gate because "the commit was big".** Big commits often contain mostly skip-worthy changes (refactors, formatting bundled with one real change). Gate applies per concept, not per commit size.
- **Re-implementing `/wiki ingest` or `/update-knowledge` logic in sync.** Sync dispatches; those commands own their per-layer discipline.
- **Bypassing the cursor by manually running `/wiki ingest` between syncs.** Fine to do, but the next `/context sync` will re-walk the same window — its worthiness gate will skip what's already current, but you waste a planning pass. Better: let `/context sync` own the cadence.
- **Treating the cursor as authoritative state.** It's a per-developer convenience marker, gitignored. The wiki + canonical files are the truth.
