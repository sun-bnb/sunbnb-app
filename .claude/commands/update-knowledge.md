---
description: Maintain the auto-loaded canonical docs (CLAUDE.md tree + .claude/rules) within budgets.json
argument-hint: [user|partner|admin|mobile|marketing|data|agent|ui|root|rules]
---
# /update-knowledge — Maintain the auto-loaded canonical docs

Update the **CLAUDE.md tree** and **`.claude/rules/`** files to reflect current architecture, conventions, and rules — applying a worthiness gate so the auto-loaded context stays tight, accurate, and not duplicative of the wiki.

> **Layer model.** Sunbnb's project knowledge sits in three layers:
>
> | Layer | Lives in | Loaded | Owner |
> |---|---|---|---|
> | **1. Code** | `apps/`, `packages/` | n/a | humans + LLM edits |
> | **2. Canonical schema docs** | `CLAUDE.md` tree, `.claude/rules/*.md` | **auto-loaded** (root + rules every session; a directory's `CLAUDE.md` whenever its files are read) | **THIS COMMAND** |
> | **3. Synthesis wiki** | `.claude/wiki/` (entities, flows, subsystems) | on-demand via `index.md` lookup | `/wiki ingest` |
>
> Adjacent artifacts (not owned by this command): `PROJECT_CONTEXT.md` (stable human narrative — leave alone), `.claude/knowledge/<agent>.md` (playbooks — written by the owning agent's retrospective and curated by `/groom <agent>`; promotions to canon arrive here as proposals from a groom).
>
> **What loads when** (the one statement; root `CLAUDE.md` § Context system): root `CLAUDE.md`, `.claude/rules/*.md` and the memory index load in every session; a directory's `CLAUDE.md` loads when a file under it is read; `TESTING.md`, `UI.md` and other siblings, the wiki, playbooks and tracks are pulled on demand.
>
> **Key fact:** layer 2 is auto-loaded, so every line costs tokens in every future session that touches it. Bloat here is more expensive than bloat in the wiki. Discipline is correspondingly stricter.

## Usage

- `/update-knowledge` — sweep all canonical docs (entire CLAUDE.md tree + `.claude/rules/`)
- `/update-knowledge user|partner|admin` — that app's `CLAUDE.md` only
- `/update-knowledge data|ui` — that package's `CLAUDE.md` only
- `/update-knowledge root` — root `CLAUDE.md` only
- `/update-knowledge rules` — `.claude/rules/*.md` only

`ARCHITECTURE.md` and `SECURITY.md` are **not** in scope. Their content lives in the wiki (`flows/`, `subsystems/`), `.claude/rules/`, and `PROJECT_CONTEXT.md`. Don't create them.

## The gate (apply before any write)

Same canonical gate as the wiki uses (defined in `.claude/wiki/README.md` § Maintenance discipline), applied to the auto-loaded layer:

> **"Will an agent doing typical project work be more *informed*, *effective*, *reliable*, *concise*, or *deterministic* after this update — without becoming less of any of these?"**

Gain at least one of (informed / effective / reliable). Sacrifice none of (concise / deterministic). If both halves aren't a confident yes, skip — and log the skip briefly.

The constraint side bites harder for this layer than for the wiki: **layer-2 (auto-loaded) bloat compounds across every session forever**, so every byte of *concise* lost is paid by every future agent every session. The bar for adding to a CLAUDE.md or `.claude/rules/` file is correspondingly higher than for adding to a wiki page.

## When to run

- A non-trivial PR landed that introduced or changed: a rule (auth guard requirement, status value, fee logic), a route/action contract, an architectural pattern, a new app/package
- A `.claude/rules/` rule no longer matches current code
- A CLAUDE.md file says something that's now false

## When NOT to run

- Bug fix without a contract/rule change → git history is enough
- Pure refactor that preserves behaviour → nothing to update
- Typo, formatting, dep bump, lint fix → never
- One-off task / migration / temporary script
- A new flow narrative or end-to-end concept landed → that's **`/wiki ingest`**, not this command
- A subtle implementation detail you're worried about losing → that's `.claude/knowledge/<agent>.md` (the owning agent's playbook; `/groom` curates it)

## Procedure

### Step 1 — Determine scope

Map `$ARGUMENTS`:

| Arg | Files in scope |
|---|---|
| (none) | root `CLAUDE.md` + every `apps/*/CLAUDE.md` + `packages/*/CLAUDE.md` + sweep `.claude/rules/*.md` (start from `context-health.mjs --scope canonical`) |
| `user` | `apps/user/CLAUDE.md` + its pulled siblings (`TESTING.md`, `UI.md`, `HW-API.md`, `PATTERNS.md`) |
| `partner` | `apps/partner/CLAUDE.md` + siblings (`TESTING.md`, `UI.md`, `ASSISTANT.md`, `PATTERNS.md`) |
| `admin` | `apps/admin/CLAUDE.md` + `UI.md` |
| `mobile` | `apps/mobile/CLAUDE.md` |
| `marketing` | `apps/marketing/CLAUDE.md` |
| `data` | `packages/data/CLAUDE.md` + siblings (`TESTING.md`, `EXPORTS.md`, `REFERENCE.md`) |
| `agent` | `packages/agent/CLAUDE.md` |
| `ui` | `packages/ui/CLAUDE.md` |
| `root` | root `CLAUDE.md` |
| `rules` | `.claude/rules/*.md` |

### Step 2 — Understand what changed

```bash
git log main..HEAD --oneline
git diff main...HEAD --stat
git diff main...HEAD
```

If on `main` with no upstream divergence:

```bash
git log -10 --oneline
git diff HEAD~5...HEAD
```

Identify **concepts** that changed, not files. Examples: "added a new always-required guard", "new status value", "new route", "renamed exported function".

### Step 3 — Apply the worthiness gate per file

For each file in scope, walk the diff. For each candidate update, ask the worthiness-gate question above.

Skip candidates fail the gate. Patch candidates that pass — but keep them in the smallest form that conveys the rule (one bullet, one row of a table, one short paragraph).

### Step 4 — Write with discipline

When editing:

- **Replace, don't append.** When a section is wrong because the world changed, rewrite it. No "as of <date>, this is now…" lines. Git history records when changes happened.
- **Cite, don't quote.** Point at `path/file.ts#symbol`. Don't paste code blocks. The wiki convention is `path/file.ts#symbol` for symbols, `path/file.ts:LINE` for line refs.
- **Defer to the wiki for narratives.** If you find yourself writing more than 3–4 paragraphs of end-to-end flow, stop — that belongs on a `[[flow:…]]` page. Add a one-line pointer here and recommend `/wiki ingest` instead.
- **Defer to `.claude/rules/` for cross-cutting rules.** A rule that applies to all three apps belongs in `.claude/rules/`, not duplicated across three CLAUDE.md files.
- **Cross-link rather than duplicate.** When CLAUDE.md needs to mention a concept the wiki covers, use a short pointer like *"see `.claude/wiki/flows/reservation-payment.md`"*, not a paragraph of synthesis.
- **Stay within size budgets — measured in BYTES, not lines.** A line budget cannot see a
  1,000-byte table cell, which is exactly how this layer reached 137 KB while every file "passed"
  its line target. Check with `wc -c`, not `wc -l`.

  The budgets live in **`.claude/context/budgets.json`** (`canonical.files`, `canonical.lineBytes`)
  — the single table shared with `context-health.mjs`. Today: root 12/16 KB, `apps/*` and
  `packages/data` 12/22 KB, other `packages/*` 4/8 KB, each rule 3/5 KB, any line 300/500 B
  (target/hard). Change a budget there, never here.

  The per-line cap is the load-bearing one: prose smuggled into a table cell is how the previous
  budget was defeated. Reflowing a long cell into short lines *increases* line count while
  *reducing* bytes — that is a win, not a regression.

  Check the whole layer with `node .claude/scripts/context-health.mjs --scope canonical` (bytes,
  long lines, stale version claims, workspaces without a `CLAUDE.md`).

  Hitting a cap is a smell. Split detail out to an on-demand sibling (`TESTING.md`, `UI.md`, `HW-API.md`,
  `ASSISTANT.md`, `EXPORTS.md` — pulled by a skill or read when relevant, never auto-loaded), or to the wiki if
  it is a narrative. Do not append and hope.

- **Never re-add `@` imports to the root `CLAUDE.md`.** Per-app context is read when working in
  that app; the root file is a router (see its *Context system* table). Importing the tree
  put ~97 KB in every session regardless of task and contradicted the pulled-depth doctrine the
  agent layer already follows.


### Step 5 — What belongs where

If you're unsure where an update goes:

| Content | Lives in |
|---|---|
| Project identity, workspace structure, top-level commands, tech stack, cross-cutting env vars, known quirks | root `CLAUDE.md` |
| Per-app: auth model summary, route map, API map, server actions list, state management overview, testing entrypoints | `apps/*/CLAUDE.md` |
| Per-package: exports, key functions, conventions, schema overview, testing | `packages/*/CLAUDE.md` |
| Cross-cutting declarative rules (auth, data access, payments) | `.claude/rules/*.md` |
| End-to-end flow narratives, entity deep-dives, subsystem walkthroughs | **wiki** (defer via `/wiki ingest`) |
| Hard-earned per-task learnings, novel bug fixes, gotchas surfaced while solving a problem | `.claude/knowledge/<agent>.md` (the owning agent appends; `/groom <agent>` curates — not this command) |
| Stable system-wide narrative reference | `PROJECT_CONTEXT.md` (don't auto-edit; human-curated) |

### Step 6 — Verify

Before declaring done, sanity-check the touched files:

- No section exceeds its size budget
- No duplication of content the wiki covers (replace with a pointer if found)
- No code blocks longer than ~10 lines (cite instead)
- No "as of <date>" or change-narrative phrasing
- Cross-refs to wiki pages use the `path/to/file.md` form so they remain navigable

### Step 7 — Report what changed

Brief, one-line-per-file summary:

- Which files modified
- The concept-level change in each (not a line-by-line diff)
- Anything intentionally left unchanged that you considered

### Step 8 — Suggest `/wiki ingest` if warranted

If the changes you just documented likely affect concepts that have wiki pages (entities, flows, subsystems — scan `.claude/wiki/index.md` for the catalog), append a one-line hint to your report:

> Consider `/wiki ingest <scope>` to sync the wiki's synthesis layer with these changes.

Where `<scope>` names the likely affected wiki pages or category. Do NOT run `/wiki ingest` yourself — the user decides whether the changes pass the wiki-worthiness gate.

Skip the hint if all updates were rule-level (auto-loaded layer only) and don't affect any synthesized concept.

## Anti-patterns

- **Adding narrative content to CLAUDE.md** ("the way bookings work is…"). That's wiki territory. Cross-link.
- **Pasting code into the canonical docs.** Cite `path/file.ts#symbol` instead.
- **Duplicating a rule across multiple CLAUDE.md files.** If it applies broadly, move it to `.claude/rules/` once.
- **Creating `ARCHITECTURE.md` or `SECURITY.md`.** This command no longer does that. Their content lives in the wiki, `.claude/rules/`, and `PROJECT_CONTEXT.md`.
- **Editing `PROJECT_CONTEXT.md`.** It's human-curated. Suggest manual edits if needed.
- **Editing `.claude/knowledge/<agent>.md`.** Playbooks are written by the matching agent's retrospective and edited only by `/groom <agent>`. When a groom proposes a curated → canon promotion, *this* command applies the canon side; the playbook entry is then trimmed to a pointer by the next groom.
- **Updating for a typo / refactor / dep bump.** Skip.
- **Logging "as of <date>" change history in the doc.** Git owns that.
- **Bumping every CLAUDE.md "just in case" when only one app changed.** Scope tightly.
- **Defending stale content for backward compatibility.** Canonical means current. Replace.
