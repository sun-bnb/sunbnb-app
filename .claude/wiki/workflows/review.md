---
type: workflow
slug: review
status: stable
sources:
  - .claude/wiki/README.md
  - .claude/scripts/context-health.mjs
  - .claude/context/health-history.jsonl
  - .claude/scripts/knowledge-curated.mjs
related:
  - workflow:lint
  - workflow:ingest
  - workflow:prune
  - workflow:context-check
last_verified: 2026-10-13
---

# Workflow: Review

Strategic re-pass on the wiki as a whole. Lint asks "is this page consistent with code?"; review asks **"is this page still earning its keep?"** and **"is the wiki shaped right for the work we're doing now?"** Less frequent than lint/prune; bigger lever when it runs.

## When to run

- **Monthly** — baseline cadence (weekly is busywork; quarter-plus lets the wiki shape drift from the project shape)
- **After a major release / refactor** — several concepts moved at once
- **When the same question keeps getting asked** — likely a missing page
- **When lint/prune cycles stop surfacing improvements** but the wiki still feels off
- **On demand** — `/wiki review [category|all]`

## Questions to ask

### Per page

- **Does it pay rent?** Has it been read or cited in the last quarter? Wiki `##` sections are units in the knowledge store (`knowledge-curated.mjs`), so recall credits (`hits`, `last_hit`) are one usage signal; conversation and code citations are another. No signal → why is it here?
- **Is its scope still right?** Fragmented (split) or merged with a sibling (consolidate)?
- **Are the invariants current?** Spot-check 2–3 against code; a failure is a critical lint finding.
- **Are the pitfalls still teaching?** Each must be a mistake that could still happen and would still matter.
- **Are the cross-references the right ones?** What's the *next* page a reader here wants — is it linked?
- **Are `sources:` still the canonical files?** Implementations move (e.g. into `packages/floor-core`, `packages/agent`, `payment-providers/`).
- **Does it restate canon?** Since the canonical compaction, per-surface narrative lives in pulled siblings (`apps/user/{HW-API,PATTERNS}.md`, `apps/partner/{ASSISTANT,PATTERNS}.md`, `packages/data/EXPORTS.md`); a wiki page should point there, not duplicate it.

### Across the wiki

- **Missing pages?** Look at recent git activity, bug fixes, track logs, and `/groom` outbound proposals. A concept that came up repeatedly with no page → promote it from "Planned" (and add to `index.md`).
- **Redundant pages?** Near-identical concepts → consolidate.
- **Is the index honest?** Status flags match frontmatter? Planned list current? Orphans?
- **Is the workflow set still right?** New patterns of work the workflows don't capture? (Rare.)
- **Are bounds honoured?** A creeping average page size or pitfall count signals discipline drift.
- **Does the wiki shape match the project shape?** A new top-level concern may warrant its own category (≥ 3 pages, per README).

### Quality signals — does the wiki still deliver the five qualities?

Map findings to the gate (`.claude/wiki/README.md` § Maintenance discipline):

- **Informed** — pick 3 recent questions; does the wiki answer each within two page reads?
- **Effective** — pick a recent change; would the wiki alone have prepared its author?
- **Reliable** — pick a recent bug; did a pitfall warn about it? If not → ingest candidate.
- **Concise** — pages over target, pitfall lists past 7, quoted code instead of citations?
- **Deterministic** — any two pages in conflict, or "X or Y" where the pattern is now settled?

A quality the wiki *systematically* fails is a structural issue — make it the top item of the revision plan.

## Procedure

### 1. Mechanical baseline

```bash
node .claude/scripts/context-health.mjs --scope wiki          # findings, fix command per finding
node .claude/scripts/context-health.mjs --scope wiki --json   # metrics.wiki: pages, stale90, staleRatio
tail -n 5 .claude/context/health-history.jsonl                # trend across snapshots
```

Clear mechanical noise first (or run `[[workflow:lint]]` in full mode) so the review spends its tokens on judgement, not on what the script already reports.

### 2. Sample, don't exhaustively re-read

Pick ~5 pages across types (bias toward the oldest `last_verified` and the most-changed `sources:`) and apply the per-page questions. Full reads of every page is the path to *not* doing reviews.

### 3. Wiki-wide scan

Walk `index.md` top to bottom with the across-the-wiki questions. Note candidates; don't fix yet.

### 4. Propose a revision plan

In conversation (not a wiki file), categorize findings:

- **Patch** — handle in this session
- **Ingest** — revise / add / split / consolidate via `[[workflow:ingest]]`
- **Prune** — delegate to `[[workflow:prune]]`
- **Defer** — needs a code change or more data first

Get user approval if the plan is non-trivial (splits, retirements, structural moves).

### 5. Execute

Apply patches inline; hand ingest/prune items to those workflows (they log themselves). Re-run `context-health.mjs --scope wiki` on what changed.

### 6. Log the review

```
## [YYYY-MM-DD] review | <scope>
- summary: <N pages reviewed, M revisions queued, K prunes queued, J deferrals>
- promoted: <Planned items that became pages> · retired: <pages marked stale or removed>
```

## Anti-patterns

- **Full re-read every time.** Review samples.
- **Reviewing without the mechanical baseline.** You'll miss objective drift while chasing subjective unease.
- **Acting on findings without classifying.** Inline edits during review bypass the ingest/prune workflows and their logs.
- **Treating "Planned" as a to-do list.** Pages are earned by the two-strikes rule, not by sitting in `index.md`.
