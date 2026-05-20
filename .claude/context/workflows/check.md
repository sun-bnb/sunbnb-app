---
type: workflow
slug: context-check
status: stable
sources:
  - .claude/scripts/detect-drift.mjs
  - .claude/wiki/README.md
related:
  - workflow:context-sync
  - workflow:lint
  - workflow:ingest
  - workflow:prune
last_verified: 2026-05-20
---

# Workflow: /context check — stateless probe

Stateless, read-only discrepancy check across all AI context metadata layers. Answers: **"Is the current metadata consistent with the current code, right now?"**

This is the "linter" for context. It does not advance any cursor, does not consult any state, does not infer anything from git history. Every invocation is an independent snapshot.

## What it covers

| Layer | Files scanned |
|---|---|
| **wiki** | `.claude/wiki/**/*.md` (entities, flows, subsystems, workflows, README, index, log) |
| **canonical** | Root `CLAUDE.md`, `PROJECT_CONTEXT.md`, `apps/*/CLAUDE.md`, `packages/*/CLAUDE.md`, `.claude/rules/*.md` |

## What it detects (mechanical — no LLM)

- `sources:` frontmatter paths whose file no longer exists (wiki only — canonical has no frontmatter)
- Inline `` `path/file.ts[#symbol|:line]` `` refs whose file or symbol is gone (any layer; only paths starting with `apps/`, `packages/`, `.claude/`, `prisma/`)
- `[[type:slug]]` cross-refs to wiki pages that don't exist and aren't listed under "Planned" in `.claude/wiki/index.md` (any layer)

Fenced code blocks are stripped before scanning — examples and templates don't count.

## What it does NOT detect (needs LLM)

- Behavioural drift (a function still exists but its semantics changed)
- Invariants that quietly stopped holding
- "Common pitfalls" entries that are no longer possible
- Pages whose narrative is stale but whose paths/symbols still resolve

For those, escalate to `[[workflow:review]]` (LLM strategic pass) or run `/wiki lint` (full mode with LLM).

## How it serves the five qualities

The probe's gain side: a clean run confirms the metadata is *informed* (paths resolve), *reliable* (no broken cross-refs), and *deterministic* (no orphan refs creating ambiguity). Drift findings name exactly what to fix to restore those qualities. The probe itself is *concise* — pure script, no LLM, ~0 tokens.

## Procedure

### 1. Run the script

```sh
node .claude/scripts/detect-drift.mjs                  # default: --scope all
node .claude/scripts/detect-drift.mjs --scope wiki
node .claude/scripts/detect-drift.mjs --scope canonical
```

Exits `0` always (warn-only). The report is on stdout.

### 2. Read the report

Per layer, per file, per finding:

```
### Layer: wiki (N findings)

.claude/wiki/flows/foo.md
  [BROKEN]  inline ref: apps/user/services/bar.ts (file missing)
  [WARN  ]  unresolved cross-ref: [[entity:nonexistent]] (no wiki page, not in Planned)
```

`BROKEN` = file or symbol cited no longer exists. Always act.
`WARN` = unresolved cross-ref or heuristic symbol match. Triage — may be false positive.

### 3. Classify and hand off

The script prints suggested follow-up at the end:

```
Suggested for wiki:      /wiki ingest <pages>
Suggested for canonical: /update-knowledge (scope to affected files)
```

Decide per finding:
- Real drift → run the suggested ingest command (wiki: `/wiki ingest`; canonical: `/update-knowledge <scope>`)
- Dead content (concept no longer exists) → `/wiki prune` for wiki, manual edit for canonical
- False positive (heuristic missed something) → annotate or tighten the script

### 4. (Optional) Full mode with LLM

For the wiki only, `/wiki lint` runs the script first, then performs LLM-augmented checks for contradictions, freshness, semantic drift. There is no equivalent full-mode for canonical today — `[[workflow:review]]` partially covers this for the wiki.

## When to run

- **Pre-push** — automatically via `.claude/hooks/pre-push.sample` (warn-only; install once via `.claude/wiki/scripts/install-hook.sh`)
- **Manual** — `/context check` slash command
- **Before `[[workflow:review]]`** — clears mechanical noise so review can focus on semantic concerns
- **After a large code-change batch** — when several PRs land in a short window

Cheap to over-run; the bigger risk is under-running.

## Anti-patterns

- **Treating WARN as BROKEN.** WARN includes heuristic symbol-matches that can be false positives. Triage.
- **Auto-fixing without classifying.** A "broken" inline ref might be a typo (fix the ref) or a real removal (fix the doc). They look the same to the script.
- **Skipping fenced code blocks lint.** The script does this for you; if you add new doc patterns, make sure they don't introduce false-positives in code blocks.
- **Calling LLM on every drift finding.** Most drift is single-line patches the user can do manually faster than spinning up `/wiki ingest`.
