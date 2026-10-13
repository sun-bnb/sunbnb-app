---
type: workflow
slug: prune
status: stable
sources:
  - .claude/wiki/README.md
  - .claude/scripts/context-health.mjs
  - .claude/context/budgets.json
related:
  - workflow:lint
  - workflow:ingest
  - workflow:review
  - workflow:context-check
last_verified: 2026-10-13
---

# Workflow: Prune

Active removal of dead or low-value content. Prune is the ONLY workflow that deletes — keeping deletion in one explicit place ensures every removal is intentional. Lint *detects*; prune *removes*.

## How this workflow serves the gate

Prune is justified by **concise** and **deterministic** gains (gate: `.claude/wiki/README.md` § Maintenance discipline). Every candidate must answer: *"After removing this, will agents read less or face less conflicting content, without becoming less informed, effective or reliable?"* If the removal would lose a still-relevant fact, invariant or pitfall, do not prune — revise via `[[workflow:ingest]]`. "What NOT to prune" below is the constraint side of that gate.

## When to run

- **After lint** — medium-tier findings (oversized pages, list overflows, stale pages, orphans) are the prune queue
- **Concept retired in code** — an entity, flow or subsystem no longer exists
- **After a major refactor** — documented patterns are gone
- **On demand** — `/wiki prune <page|section>`

## What to prune

| Candidate | Test | Action |
|---|---|---|
| **Stale pitfall** (most common) | Can the mistake still happen against current code? | No → delete |
| **Stale invariant** | Does the rule still hold, in any form? | Gone → delete; changed form → ingest revise |
| **Dead `[[…]]` cross-ref** | Slug missing and not under `index.md` "Planned" | Fix to the real slug, or delete |
| **Dead source citation** | `sources:` / inline path or symbol gone | Re-point if the symbol moved; delete if it is gone |
| **Orphan page** | Not in `index.md`, not linked from any page | Re-index if it earns its keep; otherwise retire |
| **Retired-concept page** | Concept no longer in code | Retire (below) |
| **Bloated pitfalls** (> 7) | Which entries describe mistakes least likely now? | Rotate out the lowest scorers |
| **Over-cited sources** (> 8) | Is each ref actually cited in the body? | Drop decoration; else split via ingest |
| **Section that doesn't pull weight** | Would an agent skim past it without learning anything? | Cut |
| **Restated canon** | Section repeats a `CLAUDE.md` / `.claude/rules/` rule | Replace with a pointer |

### Retiring a page

1. Mark `status: stale`.
2. Remove it from `index.md`'s main listing (optionally a one-liner under "Retired" for ~30 days).
3. Delete the file after the grace period — it exists because half-finished refactors sometimes revert.

## What NOT to prune

- **A pitfall that's still possible**, even if no one hit it lately.
- **An invariant the code currently enforces.** It's load-bearing.
- **A page on a concept still in use**, however rarely — rarity ≠ uselessness.
- **A source citation that resolves but is "boring"** — if it's the canonical implementation, it stays.
- **`log.md`** — append-only by design; never prune.

## Procedure

### 1. Mechanical pass — run the script

```bash
node .claude/scripts/context-health.mjs --scope wiki
```

Its `BROKEN` source/ref findings, freshness `WARN`s, and line/list-cap `WARN`s are the mechanical candidates (dead citations, oversized pages, over-cited sources). Thresholds: `.claude/context/budgets.json`. If a lint report already exists for this scope, start from its medium-tier findings instead.

### 2. Judgement pass (LLM)

Walk the scoped page(s) section by section against "What to prune" for what the script cannot see: stale pitfalls and invariants (open the cited code), orphans, restated canon, sections that don't pull weight. For each candidate note: category, confidence it is dead, cost of being wrong. Low confidence or high cost → hand to `[[workflow:review]]` instead of pruning unilaterally.

### 3. Apply removals

For each high-confidence, low-cost candidate:
- delete the lines / file;
- bump `last_verified` on edited pages (only those whose remaining claims you re-checked);
- update `index.md` if a page was retired;
- fix every `related:` / `[[…]]` that pointed at deleted content.

### 4. Verify and snapshot

Re-run `context-health.mjs --scope wiki` — the pruned pages must come back with fewer findings and no new ones (no fresh broken cross-refs). Then record the metrics: `node .claude/scripts/context-health.mjs --snapshot` (appends to `.claude/context/health-history.jsonl`, the over-time measure).

### 5. Log it

```
## [YYYY-MM-DD] prune | <one-sentence summary>
- removed: <pages / sections / pitfalls — be specific>
- reason: <lint finding, retired concept, …>
```

For retirements, give the grace-period end date so the final deletion is safe to do later.

## Anti-patterns

- **Pruning for length alone.** Unjustified length is the enemy, not length; a page where every line earns its place stays.
- **Pruning a pitfall because "no one hit it lately."** Still possible → keep.
- **Deleting a page because it's not in the index.** Index it first; only then judge it an orphan.
- **Skipping the retirement grace period.**
- **Pruning without logging**, or **pruning during an ingest pass** — different workflows; mixing them obscures intent in the log.
