---
type: workflow
slug: review
status: stable
sources:
  - .claude/wiki/README.md
related:
  - workflow:lint
  - workflow:ingest
  - workflow:prune
last_verified: 2026-05-20
---

# Workflow: Review

Strategic re-pass on the wiki as a whole. Lint asks "is this page consistent with code?"; review asks **"is this page still earning its keep?"** and **"is the wiki shaped right for the work we're doing now?"**

Less frequent than lint/prune; bigger lever when it runs.

## When to run

- **Monthly** — baseline cadence
- **After a major release / refactor** — when several concepts moved at once
- **When the wiki feels stale or heavy** — diffuse signal, often real
- **When the same question keeps getting asked** — likely a missing page
- **On demand** — `/wiki review` slash command

If lint/prune cycles aren't surfacing improvements but the wiki still feels off, review is the next escalation.

## Questions to ask

### Per page

- **Does it pay rent?** Has this page been read or cited (by me, in conversation, in code) in the last quarter? If no, why is it here?
- **Is its scope still right?** Has the concept fragmented (split candidate) or merged with a sibling concept (consolidate candidate)?
- **Are the invariants current?** Spot-check 2–3 against code. If stale, this is a critical lint finding.
- **Are the pitfalls still teaching?** Each pitfall should be a mistake that could *still* happen and would *still* matter. Rotate or prune.
- **Are the cross-references the right ones?** A reader at this page — what's the *next* page they'll want? Is that the one linked?
- **Are the `sources:` still the canonical files for this concept?** If the canonical implementation moved, update.
- **Did this page over-grow?** Approaching the hard cap means an unclaimed split is sitting in the page.

### Across the wiki

- **Are there missing pages?** Look at recent git activity, recent bug fixes, recent feature work. Is there a concept that came up repeatedly but has no page? Promote it (and add to `index.md`).
- **Are there redundant pages?** Two pages covering near-identical concepts. Consolidate.
- **Is the index honest?** Status flags match reality? Planned list current? Any orphans?
- **Is the workflow set still right?** New patterns of work the existing workflows don't capture? (Rare, but possible.)
- **Are bounded sections being honoured?** A creeping average pitfall count or page size across the wiki signals discipline drift.
- **Does the wiki shape match the project's shape?** As the codebase evolves, the wiki structure should follow. A new top-level concern (e.g., a new domain like "subscriptions") may warrant its own category folder.

### Quality signal questions — does the wiki still deliver the five qualities?

Map findings to the canonical gate (`.claude/wiki/README.md` § Maintenance discipline). For each quality, ask whether the current wiki delivers it:

- **Informed** — If I asked Claude "how does X work?" today, would it find the answer in the wiki within two page reads? *(Pick 3 random recent questions and try.)*
- **Effective** — If a new developer (or new agent) read only the wiki, could they make a meaningful change correctly? *(Pick a recent PR; would the wiki have prepared the author?)*
- **Reliable** — Pick a recent bug. Was there a pitfall in the relevant page that would have warned about it? If not, that's an ingest candidate.
- **Concise** — Are any pages over their size budget? Are any "Common pitfalls" lists past 7 entries? Are there pages that quote code instead of citing?
- **Deterministic** — Do any two pages give conflicting answers? Are there any "X or Y" formulations where the canonical pattern is now known?

A quality that the wiki *systematically fails* on is a structural issue — promote it to a top-priority revision plan item.

## Procedure

### 1. Run lint first

`[[workflow:lint]]` provides the baseline data — page sizes, freshness ages, contradictions, orphans. Review builds on it.

### 2. Sample, don't exhaustively re-read

Pick a sample (e.g., 5 pages across all types) and apply the "per page" questions. Spot-checks beat full reads — full reads of every page is the path to *not* doing reviews.

### 3. Wiki-wide scan

Walk `index.md` top to bottom. Ask the "across the wiki" questions. Note candidates, don't fix yet.

### 4. Propose a revision plan

Write a plan (in conversation, not a wiki file) categorizing findings into:

- **Patch** items (handle in this session)
- **Ingest** items (revise / add / split / consolidate via `[[workflow:ingest]]`)
- **Prune** items (delegate to `[[workflow:prune]]`)
- **Defer** items (logged but not acted on this pass — usually because they need a code change first, or need more data)

Get user approval if the plan is non-trivial (e.g., page splits, retirements, structural moves).

### 5. Execute

Apply patches inline. Hand off ingest/prune items to those workflows. Log each.

### 6. Log the review

```
## [YYYY-MM-DD] review | <scope>
- summary: <N pages reviewed, M revisions queued, K prunes queued, J deferrals>
- promoted: <Planned items that became pages>
- retired: <pages marked stale or removed>
- by: <handle or "claude">
```

## Anti-patterns

- **Full re-read every time.** Review is sampling + strategic; not exhaustive.
- **Reviewing without lint data.** You'll miss objective drift while chasing subjective unease.
- **Acting on review findings without classifying.** Inline edits during review bypass the ingest/prune workflows and skip their logs.
- **Treating planned pages as a to-do list.** They become pages when the two-strikes rule fires, not because they're sitting in `index.md`.
- **Reviewing too often.** Monthly cadence is the floor. Weekly review is busywork.
- **Reviewing too rarely.** Quarter-plus and the wiki shape drifts from the project shape without you noticing.
