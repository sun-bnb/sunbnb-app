---
type: workflow
slug: ingest
status: stable
sources:
  - .claude/wiki/README.md
related:
  - workflow:lint
  - workflow:prune
  - workflow:review
  - workflow:query
last_verified: 2026-05-20
---

# Workflow: Ingest

Procedure for folding new information into the wiki. **Decision-led** — most of the work is deciding whether to ingest at all, and in what mode. Ingestion that fails the wiki-worthiness gate is bloat.

## The gate

Before any write, apply the canonical wiki gate (defined in `.claude/wiki/README.md` § Maintenance discipline):

> **"Will an agent doing typical project work be more *informed*, *effective*, *reliable*, *concise*, or *deterministic* after this update — without becoming less of any of these?"**

Gain at least one of (informed / effective / reliable). Sacrifice none of (concise / deterministic). If both halves aren't a confident yes, skip — doing nothing is a valid outcome of an ingest pass.

The YES/NO criteria below are the concrete cases that satisfy or fail the gate.

## Decision tree: is this wiki-worthy?

### YES — ingest if ANY of these is true

Each criterion below gains specific qualities (per the gate table). Picking the right `update mode` (see § Choose the update mode) preserves the constraint qualities.

1. **Invariant changed.** *(Gains: informed, reliable.)* A rule documented in an existing page is no longer true, OR a new load-bearing rule is now true.
   - *Examples:* fee direction reverses for a flow; a new status value is added to `reservation-status.ts`; auth model changes; a new `requireSudo()` requirement.
2. **New domain concept** that doesn't fit cleanly into an existing page. *(Gains: informed, effective.)*
   - *Examples:* a new entity (`Subscription`); a new external integration (third payment provider); a new sub-system (job queue, search index).
3. **Contract changed** for something currently cited in `sources:`. *(Gains: informed, reliable.)*
   - *Examples:* server-action signature changed; exported helper renamed; API response shape changed; status transition path altered.
4. **Hard-earned gotcha.** *(Gains: reliable.)* A bug was caused by a non-obvious behaviour the wiki didn't warn about.
   - *Test:* "If the wiki had said this, the bug wouldn't have happened."
   - Goes into the affected page's **Common pitfalls** section (bounded — see below).
5. **Source moved or renamed.** *(Preserves: concise, deterministic.)* Paths in `sources:` are now stale.
   - *Effect:* update `sources:` + bump `last_verified`. Usually no prose change.
6. **Ambiguity resolved.** *(Gains: deterministic.)* Two pages contradict, or a page documents "X or Y" without picking. The project's canonical pattern has been settled.
   - *Examples:* a previously open question about which payment provider is default; a status-naming convention that was inconsistent.

### NO — skip if ANY of these is true

1. **Bug fix without a new gotcha.** Git history is sufficient. Don't narrate the fix in the wiki.
2. **Pure refactor.** Same behaviour, same contract. The wiki documents behaviour, not implementation. Only `sources:` may need updating.
3. **One-off task.** Migration, data fix, temporary script. Not persistent knowledge.
4. **Performance / cosmetic change.** No behavioural impact.
5. **Documentation-only change.** Including this one — don't recursively document doc changes.
6. **Test addition for existing behaviour.** Unless the test exposed an undocumented invariant worth codifying.
7. **Dep bump, lint fix, formatting.** Never.
8. **WIP / experimental / unmerged.** Wait until landed.

### Tie-breakers

- "Two-strikes rule" for new pages: don't create a new page on the first occurrence of a concept. Wait until the same concept is asked about or referenced a second time — then it's earned its page. (Until then, list it under "Planned" in `index.md` if helpful.)
- "Pitfalls are bounded" — if the affected page's **Common pitfalls** is already at 7 entries, decide what to displace. Adding an 8th by appending is a failure mode.
- "When in doubt, lint first" — if you're unsure whether to ingest, run `[[workflow:lint]]` on the affected pages. The lint output often clarifies whether the change is a patch, a revise, a split, or nothing.

## Choose the update mode

(Modes are defined in `README.md` — Update Modes table.)

| Situation | Mode |
|---|---|
| A fact in a page is now wrong; one paragraph rewrite | **patch** |
| A whole section is now wrong; needs to be rewritten in place | **revise** |
| A new concept passed the gate AND no page is a natural home | **add page** |
| A page exceeded its size budget at a natural seam | **split** |
| Two pages overlap > 40% on a concept | **consolidate** |
| A concept no longer exists in code | **retire** (delegates to `[[workflow:prune]]`) |

If you're picking between `patch` and `revise`: if the fix is < 5 lines of edits, it's a patch.

If you're picking between `revise` and `add page`: if the change makes the existing page's scope incoherent, it's `add page` (split out the new concern). If the change fits the existing page's scope, it's `revise`.

## Procedure

### 1. Scope the change

What concept(s) changed? List them in plain language — *not* file names. "Added rental cancellation flow." "Changed service-fee resolution to allow per-product tier."

### 2. Apply the wiki-worthiness gate

Walk the decision tree above. If skip, **stop and log** ("[YYYY-MM-DD] ingest-considered | skipped — <reason>") so the decision is recoverable.

### 3. Find affected pages

```bash
grep -li "<concept-keyword>" .claude/wiki/**/*.md
```

For each match, decide the mode (table above).

### 4. Execute the mode

- **patch / revise:** edit the page; bump `last_verified`; rewrite (don't append).
- **add page:** create from the template for the page type (templates below); add to `index.md`; cross-link from at least one related existing page.
- **split:** create the new page; move sections; update cross-refs in both directions; update `index.md`.
- **consolidate:** copy the keep-worthy content into the dominant page; delete the other; replace all cross-refs to the deleted slug; update `index.md`.
- **retire:** delegate to `[[workflow:prune]]`.

### 5. Update the index

`index.md` reflects the catalog of *currently existing* pages with their *current* status. Anything you added/removed must be reflected.

### 6. Log it

Append to `log.md`:

```
## [YYYY-MM-DD] ingest | <one-sentence summary>
- mode: <patch | revise | add | split | consolidate>
- changed: <wiki files touched>
- reason: <what code change drove this; cite a commit if useful>
- by: <handle or "claude">
```

### 7. Sanity check

- Every claim traces to a `sources:` file?
- Every `[[…]]` cross-ref resolves (or is listed as Planned)?
- Page is under its hard cap? (preserves *concise*)
- **Common pitfalls** ≤ 7 entries? (preserves *concise*; rotate, don't append)
- No "X or Y" ambiguity introduced where the canonical pattern is known? (preserves *deterministic*)
- Did the update earn its place? Re-apply the gate: gained at least one of (informed/effective/reliable), sacrificed none of (concise/deterministic).

## Page templates by type

### Entity

```markdown
---
type: entity
slug: <name>
status: draft
sources:
  - packages/data/prisma/schema.prisma#model-<Name>
  - <where its logic lives>
related:
  - flow:<related-flow>
  - entity:<related-entity>
last_verified: <date>
---

# <Entity name>

One-paragraph definition.

## Schema essentials
- Key fields, FKs, indexes. Point at the schema file; do not duplicate.

## Status lifecycle (if applicable)
- States, transitions, terminal states.

## Invariants  (max 5–7)
- Things that MUST be true. Each should be checkable in code.

## Related entities / flows
- Cross-refs.

## Common pitfalls  (max 5–7, rotate as project evolves)
- Mistakes the LLM (or humans) have made before.
```

### Flow

```markdown
---
type: flow
slug: <name>
status: draft
sources:
  - <entry-point file>
  - <key downstream files>
related:
  - entity:<primary-entity>
  - subsystem:<involved-subsystem>
last_verified: <date>
---

# Flow: <Flow name>

One-paragraph what-and-why.

## Trigger / Pre-conditions
## Sequence  (numbered; each step cites `path/file.ts:LINE`)
## Side effects  (DB writes, emails, webhook calls)
## Failure modes  (table; what goes wrong, how recovered)
## Related  (cross-refs)
## Common pitfalls  (max 5–7)
```

### Subsystem

```markdown
---
type: subsystem
slug: <name>
status: draft
sources:
  - <key files>
related: …
last_verified: <date>
---

# Subsystem: <Name>

What this subsystem does, where its boundary is.

## Key files / Entry points / Configuration
## Invariants  (max 5–7)
## Related  (cross-refs)
## Common pitfalls  (max 5–7)
```

## Anti-patterns

- **Ingesting because something changed.** The trigger is "will this help future Claude," not "did code change."
- **Appending instead of rewriting.** "As of <date>, …" is the bloat signature.
- **Pasting code.** The wiki cites; the code base holds.
- **Adding a 6th pitfall without removing one.** Pitfalls are rotated, not stacked.
- **Creating a new page on the first occurrence.** Wait for the second.
- **Documenting bug fix narratives.** Git is for that.
- **Cross-linking defensively to every related page.** Cross-link the ones a reader will actually need next.
- **Bumping `last_verified` without re-checking sources.** Defeats the entire freshness signal.
