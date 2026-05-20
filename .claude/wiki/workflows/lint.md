---
type: workflow
slug: lint
status: stable
sources:
  - .claude/wiki/README.md
related:
  - workflow:ingest
  - workflow:prune
  - workflow:review
last_verified: 2026-05-20
---

# Workflow: Lint

Read-only health check on the wiki. **Detects** drift, bloat, and contradictions — does NOT remove or rewrite content (that's `[[workflow:prune]]` and `[[workflow:ingest]]`).

## Two modes

| Mode | Invocation | What runs | Token cost |
|---|---|---|---|
| **Quick** | `/wiki lint --quick` (alias of `/context check --scope wiki`); also the pre-push git hook | Mechanical script `.claude/scripts/detect-drift.mjs --scope wiki` — checks `sources:` paths, inline `path/file.ts#symbol` refs, `[[type:slug]]` cross-refs. No LLM. | ~0 |
| **Full** | `/wiki lint` | Runs the script first, then performs LLM-augmented checks (contradictions, freshness narrative, semantic drift, bloat indicators) on what remains. | Real |

**Use quick mode** for routine wiki drift detection. For multi-layer (wiki + canonical) drift, use `/context check`. **Use full mode** before a strategic `[[workflow:review]]` pass or when something feels off but quick lint reports clean.

## When to run

- **Weekly** — quick baseline scan
- **Before `[[workflow:review]]`** — feeds the strategic pass
- **After a large code-change batch** — when several PRs land in a short window
- **On demand** — `/wiki lint` slash command

Lint is cheap and read-only — over-running it costs almost nothing. Under-running it is the bigger risk.

## Severity tiers (use these in the report)

Severity reflects which of the five qualities (see `.claude/wiki/README.md` § Maintenance discipline) the finding compromises. Critical and high primarily threaten *informed* and *reliable*; medium threatens *concise* and *deterministic*; low is hygiene.

| Tier | What | Qualities at risk | Examples | Default action |
|---|---|---|---|---|
| **critical** | Wiki contradicts current code; agents would write incorrect code | informed, reliable | Invariant inversion; renamed exported function still cited as canonical; status string that no longer exists | Immediate `[[workflow:ingest]]` revise |
| **high** | Source file moved/renamed, or signature drifted | informed, reliable | Stale `sources:` path; function rename; model field removed | `[[workflow:ingest]]` patch |
| **medium** | Page past freshness window or oversized; bounded section overflowed | concise, deterministic | `last_verified` > 90 days; page > hard cap; common pitfalls > 7; two pages with overlapping/conflicting claims | Schedule revise or split via `[[workflow:ingest]]`; or `[[workflow:prune]]` candidate |
| **low** | Cosmetic / hygiene | (none materially) | Broken cross-ref to a typo'd slug; missing index entry for an existing page; orphan page | Auto-fix during lint |

The lint pass classifies and reports. The user (or follow-up workflow) decides what to act on for medium/high/critical.

## Procedure

### 0. Snapshot health metrics

Quick numeric scan — these are the leading indicators of wiki health.

| Metric | Healthy range | Compute |
|---|---|---|
| Total page count (excl. README/index/log) | growth roughly linear with project | `find .claude/wiki -name '*.md' \| wc -l` |
| Pages over hard cap | 0 | per-type cap (see `README.md` table) vs `wc -l` |
| `Common pitfalls` lines per page | ≤ 7 entries | grep & count list items under that header |
| Oldest `last_verified` | ≤ 90 days | `grep -H "^last_verified:" .claude/wiki/**/*.md \| sort -t: -k3` |
| % of pages older than 90 days | ≤ 25% | same data, percentage |
| Planned-but-not-created pages | growing list = active project, but > 15 suggests gaps | `index.md` "Planned" section |
| Orphan pages | 0 | (see step 2) |
| Critical-tier findings | 0 | (see step 3) |

Surface anything outside the healthy range in the report.

### 1. Page-level checks

For every `.md` file under `.claude/wiki/`:

- **Frontmatter present and well-formed.** All required keys: `type`, `slug`, `status`, `sources`, `related`, `last_verified`.
- **Slug matches filename.**
- **`sources:` resolve.** Every path exists (account for `#symbol` and `:line` suffixes). Flag missing.
- **`related:` slugs exist.** Every `[[type:slug]]` in `related:` and in the body refers to a page that exists OR is listed under "Planned" in `index.md`. Flag others.
- **Length sanity.** Pages over 400 lines are split candidates.
- **Freshness.** Pages with `last_verified` older than 90 days are stale candidates.

### 2. Cross-page checks

- **Index coverage.** Every page under `.claude/wiki/` (except `README.md`, `index.md`, `log.md`) is listed in `index.md`. Orphans get reported.
- **Status consistency.** A page listed as `stable` in `index.md` should have `status: stable` in its frontmatter.
- **Contradictions.** Run text comparison on pages that share `related:` cross-refs — flag any directly contradictory claims (e.g. one page says "fee added to customer", another says "fee deducted from partner" for the same flow).
- **Duplication.** Two pages covering the same concept with significant overlap — merge candidate.

### 3. Code-vs-wiki spot checks

For each entity page, sanity-check a sampled claim against current code:

- Open the first file in `sources:`
- Confirm at least one specific claim from the page still holds (a field exists on the model, a function still has the documented signature, a status transition is still implemented)
- If the spot check fails, mark the page `stale`

For flow pages, walk the `Sequence` section and confirm each cited `file:line` reference is still meaningful (file exists; line is in the same function).

### 4. Report

Output a structured report:

```
## Wiki lint report — YYYY-MM-DD

### Broken sources (N)
- entities/foo.md → sources references `apps/old/path.ts` (file missing)

### Broken cross-refs (N)
- flows/bar.md → references [[entity:baz]] (no such page; not listed as planned)

### Stale pages (N)
- subsystems/quux.md — last_verified 2025-12-01 (171 days)

### Orphans (N)
- entities/orphan.md — exists but not in index.md

### Contradictions (N)
- flows/a.md says "X is Y" but entities/b.md says "X is Z"

### Long pages (split candidates) (N)
- flows/payment.md — 478 lines

### Spot-check failures (N)
- entities/foo.md claims `model Foo` has field `bar`; schema.prisma has no such field
```

### 5. Decide what to fix now vs flag for human

Apply directly without asking:
- Fix `index.md` entry for orphans (add them)
- Fix dead `[[…]]` to a typo of a real slug
- Update `last_verified` for pages where the spot check passed

Flag and surface to user before changing:
- Marking pages `stale`
- Splitting long pages
- Resolving contradictions (need to know which side is right)
- Deleting orphan pages

### 6. Log the lint

Append to `log.md`:

```
## [YYYY-MM-DD] lint | <N issues found, M auto-fixed>
- changed: <files auto-fixed>
- reason: scheduled lint pass
- by: claude
- metrics: pages=<N>, over-cap=<N>, oldest-verify=<N days>, critical=<N>, high=<N>, medium=<N>, low=<N>
```

### 7. Hand off

For every critical / high finding, propose the follow-up workflow in the report:

- Critical → `/wiki ingest <page>` (revise mode)
- High → `/wiki ingest <page>` (patch mode)
- Medium / oversized / stale → `/wiki review` (strategic re-pass)
- Medium / dead content → `/wiki prune <page>`

Lint *only* detects; the follow-up is explicit.

## Tooling shortcuts

Useful one-liners for a lint pass:

```bash
# All wiki pages with their last_verified date
grep -H "^last_verified:" .claude/wiki/**/*.md

# Find broken source references (rough)
grep -hoE '^\s*-\s+[a-z][a-zA-Z0-9_/.[\]-]+' .claude/wiki/**/*.md | sort -u

# All cross-refs in the wiki
grep -hoE '\[\[[a-z]+:[a-z0-9-]+\]\]' .claude/wiki/**/*.md | sort -u

# Pages not listed in index
comm -23 \
  <(find .claude/wiki -name '*.md' -not -name 'README.md' -not -name 'index.md' -not -name 'log.md' | sed 's|.claude/wiki/||' | sort) \
  <(grep -oE '\(([a-z]+/[a-z0-9-]+\.md)\)' .claude/wiki/index.md | tr -d '()' | sort -u)
```
