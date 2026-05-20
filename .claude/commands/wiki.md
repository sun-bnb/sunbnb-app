# /wiki — LLM wiki maintenance

Invoke a wiki workflow. The wiki lives at `.claude/wiki/`; workflows are the canonical procedures under `.claude/wiki/workflows/`.

> **Objective of every wiki operation:** after the operation, agents working with the project are more *informed*, *effective*, *reliable*, *concise*, and *deterministic*. Each workflow applies this gate before writing (see `.claude/wiki/README.md` § Maintenance discipline). Skip operations that don't pass — doing nothing is a valid outcome.

## Usage

- `/wiki ingest [scope]` — fold recent code changes into the wiki (decision-led; may decide no update)
- `/wiki lint` — full health check (mechanical script + LLM-augmented semantic checks)
- `/wiki lint --quick` — mechanical drift check only (no LLM, ~0 tokens; same as the pre-push hook)
- `/wiki prune [scope]` — actively remove dead / low-value content (post-lint, or on demand)
- `/wiki review` — periodic strategic re-pass: are pages still earning their keep?
- `/wiki` — without subcommand: suggest which operation to run, based on signals below

`scope` is optional and may be a page slug, a category, or a free-form description ("the recent settlement changes"). If omitted, the workflow operates on the whole wiki.

## Instructions

Parse `$ARGUMENTS` to get the subcommand (first whitespace-delimited token) and scope (remainder).

### Step 1 — Resolve the subcommand

Map to a workflow file:

| Subcommand | Workflow file |
|---|---|
| `ingest` | `.claude/wiki/workflows/ingest.md` |
| `lint`   | `.claude/wiki/workflows/lint.md` |
| `prune`  | `.claude/wiki/workflows/prune.md` |
| `review` | `.claude/wiki/workflows/review.md` |
| (none)   | see Step 1a |

**Special case `lint --quick`:** if the second token is `--quick`, do NOT load the full lint workflow. Instead, run `node .claude/scripts/detect-drift.mjs --scope wiki` directly via Bash and report its stdout verbatim. No LLM analysis, no synthesis. This is equivalent to `/context check --scope wiki` and matches what the pre-push git hook runs.

### Step 1a — Auto-suggest (no subcommand)

If no subcommand was provided, inspect the wiki state and recommend ONE operation:

1. Read `.claude/wiki/log.md` to find the date of the most recent entry per op.
2. Check git log for non-trivial code changes since the most recent `ingest` entry.
3. Apply this priority:
   - Outstanding code changes that pass the wiki-worthiness gate (per `workflows/ingest.md`) → suggest `/wiki ingest [scope]`
   - Last `lint` > 7 days OR never → suggest `/wiki lint`
   - Last `lint` produced unhandled medium+ findings → suggest `/wiki prune` or `/wiki ingest` per the lint's hand-off section
   - Last `review` > 30 days → suggest `/wiki review`
   - Nothing pressing → say so explicitly; do not invent work

Output the suggestion as a single sentence plus a one-line "why".

### Step 2 — Read the workflow file

Read the full workflow file. It is the canonical procedure — do not improvise.

### Step 3 — Apply the wiki-worthiness gate (for `ingest` only)

The ingest workflow opens with a decision tree. Walk it explicitly. If the answer is "skip", log the skip in `.claude/wiki/log.md` (per the workflow) and stop — do not silently do nothing, and do not ingest "just to be safe".

### Step 4 — Execute the workflow against `scope`

Follow the workflow's "Procedure" section to the letter. Use `scope` to narrow:

- For `ingest`: limit the affected-page scan to pages matching `scope`
- For `lint`: limit checks to pages matching `scope` (default: all)
- For `prune`: scope is usually a specific page or section name
- For `review`: scope is usually a category (`entities`, `flows`) or "all"

### Step 5 — Log

Every wiki write — including `ingest-considered | skipped` decisions — appends one line to `.claude/wiki/log.md` in the workflow's prescribed format.

### Step 6 — Report

Brief report back to the user:
- What was done (or explicitly: nothing, because <reason>)
- Which pages / sections changed
- Any follow-up workflow recommended (e.g., lint flagged criticals → suggest `/wiki ingest <page>`)

## Non-negotiables

- **Lint and prune are paired.** Lint reports; prune removes. Don't let prune act without a clear lint or user signal.
- **Ingest may decide to skip.** That's a successful ingest pass. Always log the skip.
- **Bounded sections are bounded.** When a page's `Common pitfalls` hits 7 and the ingest wants to add an 8th, rotate (remove one) — do not append.
- **Replace, don't append.** When a section is wrong, rewrite it. Never add "as of <date>, …".
- **No code in the wiki.** Cite `path/file.ts#symbol`. Snippet only if it teaches something the path won't.
- **Bump `last_verified`** only when you actually re-checked claims against code.

See `.claude/wiki/README.md` for the wiki schema and discipline rules.
