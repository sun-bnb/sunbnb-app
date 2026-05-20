---
type: workflow
slug: prune
status: stable
sources:
  - .claude/wiki/README.md
related:
  - workflow:lint
  - workflow:ingest
  - workflow:review
last_verified: 2026-05-20
---

# Workflow: Prune

Active removal of dead or low-value content. Prune is the ONLY workflow that deletes — keeping deletion in one explicit place ensures every removal is intentional.

Lint *detects*; prune *removes*. Run prune after lint, or any time the wiki feels heavy.

## How this workflow serves the gate

Prune is the workflow most often justified by **concise** and **deterministic** gains. Every prune candidate should answer: *"After removing this, will agents be more concise (less to read) or more deterministic (less conflicting/ambiguous content), without becoming less informed/effective/reliable?"* If the removal would lose a still-relevant fact, invariant, or pitfall, do not prune — revise via `[[workflow:ingest]]` instead.

The "What NOT to prune" list below is the constraint side of that gate.

## When to run

- **Triggered by lint** — lint surfaces medium-tier findings (oversized pages, bounded-section overflows, stale pages, orphans)
- **Concept retired in code** — an entity, flow, or subsystem no longer exists; its page should retire
- **After a major refactor** — old patterns that were documented are now gone
- **On demand** — `/wiki prune` slash command, scoped to a page or section

## What to prune

### Stale pitfalls (most common)

A "Common pitfalls" entry that describes a mistake the current code makes impossible (e.g., the relevant field was removed, the foot-gun was fixed in a type signature, the API was changed).

**Test:** can the pitfall still happen against current code? If no, prune.

### Stale invariants

An invariant that no longer holds. Either prune (the rule is no longer real) or revise via `[[workflow:ingest]]` (the rule still exists in different form).

### Dead cross-references

`[[…]]` links to slugs that no longer exist AND aren't in `index.md` "Planned" — they don't lead anywhere.

### Dead source citations

`sources:` paths that point to files that have moved or been removed. Either fix (if the symbol still exists at a new path) or remove (if the symbol is gone).

### Orphan pages

Pages that exist but aren't linked from `index.md` or any other page. Either:
- Add them back to the index (if they're earning their keep)
- Prune them (if they're not)

### Retired-concept pages

A page whose concept no longer exists in code. Procedure:
1. Mark `status: stale`
2. Remove from `index.md`'s main listing (optional: leave a one-liner under a "Retired" subsection for ~30 days)
3. Delete the file after the grace period

The grace period exists so that if the concept was retired by mistake (e.g., a half-finished refactor), the page can be recovered.

### Bloated common-pitfalls sections

If "Common pitfalls" has > 7 entries, rotate. Score each entry by: *how recently has this kind of mistake actually been made?* The lowest scorers get pruned.

### Over-cited sources

A `sources:` list with > 8 entries means the page's scope is too wide. Either:
- Drop refs that aren't actively cited in the body (pure decoration)
- Split the page (via `[[workflow:ingest]]` split mode)

### Sections that no longer pull weight

A section a future Claude would skim past without learning anything — content that doesn't synthesize, doesn't warn, doesn't cite anything load-bearing. Cut.

## What NOT to prune

- **A pitfall that's still possible**, even if no one has hit it recently. The wiki teaches; pitfalls don't have to be daily mistakes to be worth a line.
- **An invariant currently enforced by the code.** It's load-bearing.
- **A page on a concept still in active use**, even if rarely. The wiki is referenced unpredictably — rarity ≠ uselessness.
- **A source citation that resolves but is "boring."** If it's the canonical implementation, it stays.
- **The log.** `log.md` is append-only by design; never prune.

## Procedure

### 1. Identify candidates

Either:
- Open the most recent lint report (medium-tier findings are the prune queue), OR
- Open a specific page and walk it section-by-section against "What to prune"

### 2. Classify each candidate

For each candidate, write down (mentally or in a scratch buffer):
- What category (pitfall / invariant / cross-ref / source / orphan / retired / bloated / over-cited)
- Confidence (am I sure this is dead?)
- Cost of being wrong (low for a stale pitfall; high for an "orphan" page that was actually load-bearing)

If confidence is low or cost is high, escalate to `[[workflow:review]]` for a strategic decision instead of pruning unilaterally.

### 3. Apply removals

For each high-confidence, low-cost candidate:
- Delete the lines / file
- Update `last_verified` on edited pages
- Update `index.md` if a page was retired
- Update `related:` cross-refs anywhere that pointed at deleted content

### 4. Verify with lint

Re-run `[[workflow:lint]]` on the affected pages. The fix should reduce the issue count without introducing new findings (e.g., no fresh broken cross-refs).

### 5. Log it

Append to `log.md`:

```
## [YYYY-MM-DD] prune | <one-sentence summary>
- removed: <pages / sections / pitfalls — be specific>
- reason: <lint finding, retired concept, etc.>
- by: <handle or "claude">
```

For page retirements, mention the grace-period date so future-you knows when it's safe to delete the file entirely.

## Anti-patterns

- **Pruning to make a page shorter without reason.** Length isn't the enemy; *unjustified* length is. A 250-line page where every line earns its place is fine.
- **Pruning a pitfall because "no one hit it lately."** If it's still possible against current code, keep it.
- **Deleting a page because it's not linked from index.** Add it to the index first; if that doesn't feel right, *then* it's an orphan.
- **Skipping the grace period for retirements.** Half-finished refactors revert sometimes; the grace window saves you.
- **Pruning without logging.** Future-you needs the trail.
- **Pruning during an ingest pass.** Different workflows. Mixing them obscures intent in the log.
