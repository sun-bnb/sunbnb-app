---
type: workflow
slug: context-check
status: stable
sources:
  - .claude/scripts/context-health.mjs
  - .claude/context/budgets.json
  - .claude/wiki/README.md
related:
  - workflow:context-sync
  - workflow:lint
  - workflow:ingest
  - workflow:prune
last_verified: 2026-10-13
---

# Workflow: /context check — stateless probe

Stateless, read-only health check across every AI-context layer. Answers: **"Is the context consistent with the code and within its budgets, right now?"**

This is the "linter" for context. It does not advance any cursor, does not consult any state beyond git dates, and never writes. Every invocation is an independent snapshot. Its `--summary` line is what every session start and every `git push` prints; `check` is the full report behind it.

## What it covers

| Layer | Files scanned | Checks beyond citations |
|---|---|---|
| **wiki** | `.claude/wiki/**/*.md` + `.claude/context/workflows/*.md` | status vocabulary · `last_verified` freshness (stable ≤ 30 d, stale > 90 d) · edited after `last_verified` · line caps · `sources:`/`related:` ≤ 8 · `log.md` heading format · index length |
| **canonical** | Root `CLAUDE.md`, `AGENTS.md`, `PROJECT_CONTEXT.md`, `apps/*/CLAUDE.md`, `packages/*/CLAUDE.md`, `.claude/rules/*.md` | byte caps (soft → WARN, hard → BROKEN) · lines > 500 B · tech-table version claims vs installed majors · workspaces without a `CLAUDE.md` |
| **playbooks** | `.claude/knowledge/<agent>.md` | byte + entry budgets (→ `/groom <agent>`) · duplicate `##` sections · dated `##` headings · entries missing from the navigation index · v2 `tags:` lines |
| **tracks** | `.claude/tracks/*.md` | frontmatter fields + status vocabulary · id = filename · `Resume here` present · active but untouched > 45 d · files that are neither a track nor a `parent:` sub-document · `index.md` ≠ generated registry |
| **agents** | `.claude/agents/*.md`, `.claude/commands/*.md` | frontmatter present · `maxTurns` aligned · cited paths exist |
| **store** (`--with-store`) | the knowledge Postgres | counts by status · unembedded · exact duplicates · off-vocabulary types · last ingest age |

All thresholds come from `.claude/context/budgets.json` — change them there, never in the script.

## What it detects (mechanical — no LLM)

- `sources:` frontmatter paths whose file no longer exists
- Inline `` `path/file.ts[#symbol|:line]` `` refs whose file or symbol is gone (any layer; only paths starting with `apps/`, `packages/`, `.claude/`, `prisma/`, `e2e/`)
- `[[type:slug]]` cross-refs to wiki pages that don't exist and aren't listed under "Planned" in `.claude/wiki/index.md`; `[[track:NNN-slug]]` refs resolve against `.claude/tracks/`
- Everything in the table above

Fenced code blocks are stripped before scanning — examples and templates don't count. Severity: **BROKEN** = a claim that is false now; **WARN** = drift that will mislead soon; **INFO** = housekeeping. Every finding carries the command that fixes it.

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
node .claude/scripts/context-health.mjs                  # default: --scope all
node .claude/scripts/context-health.mjs --scope wiki     # wiki|canonical|playbooks|tracks|agents
node .claude/scripts/context-health.mjs --with-store     # add knowledge-store checks (Docker pg)
node .claude/scripts/context-health.mjs --summary        # the one-liner the hooks print
node .claude/scripts/context-health.mjs --json           # findings + metrics for tooling
node .claude/scripts/context-health.mjs --snapshot       # append metrics to .claude/context/health-history.jsonl
```

Exits `0` always (warn-only). The report is on stdout. `--snapshot` is run by the orchestrator after curation (once after a batch of `/groom` runs — never from inside a groom — and at the end of `/context sync` and `/wiki prune`), not per session — the history file is how "better over time" is measured.

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

- **Every session start** — the `--summary` line, via the committed `.claude/settings.json` SessionStart hook
- **Every push** — the same line from `.githooks/pre-push` (warn-only; the hook's exit code is the migration guard's alone)
- **Manual** — `/context check` slash command for the full report
- **Before `[[workflow:review]]`** — clears mechanical noise so review can focus on semantic concerns
- **After a large code-change batch** — when several PRs land in a short window

Cheap to over-run; the bigger risk is under-running.

## Anti-patterns

- **Treating WARN as BROKEN.** WARN includes heuristic symbol-matches that can be false positives. Triage.
- **Auto-fixing without classifying.** A "broken" inline ref might be a typo (fix the ref) or a real removal (fix the doc). They look the same to the script.
- **Skipping fenced code blocks lint.** The script does this for you; if you add new doc patterns, make sure they don't introduce false-positives in code blocks.
- **Calling LLM on every drift finding.** Most drift is single-line patches the user can do manually faster than spinning up `/wiki ingest`.
