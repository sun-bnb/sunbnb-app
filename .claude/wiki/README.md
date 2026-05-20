# LLM Wiki — Sunbnb

This is an LLM-maintained knowledge layer for the Sunbnb codebase. It exists to give AI assistants (Claude Code and its sub-agents) **fast, structured access** to the architecture, domain concepts, and operational workflows of this project — without re-deriving the same understanding from raw source on every task.

It is modelled on Karpathy's three-layer wiki pattern (raw sources → wiki → schema). This file is the **schema**.

> **Primary objective of any maintenance action** (ingest, prune, revise, review, lint follow-up): agents working with the project afterward are more *informed*, *effective*, *reliable*, *concise*, and *deterministic*. The operational gate is defined in [Maintenance discipline](#maintenance-discipline) below — every wiki edit must pass it. The same gate applies to the auto-loaded canonical docs maintained by `/update-knowledge`.

---

## The three layers

| Layer | Lives in | Owner |
|---|---|---|
| Raw sources | The codebase (`apps/`, `packages/`, schema, migrations, tests) and human-authored docs (`CLAUDE.md` tree, `PROJECT_CONTEXT.md`, `.claude/rules/`, `packages/docs/`) | Humans + LLM (code edits) |
| Wiki | `.claude/wiki/` — this directory | LLM (curated, never authoritative on its own) |
| Schema | This file (`.claude/wiki/README.md`) + `index.md` + `log.md` | LLM, structurally stable |

**Key rule:** the wiki **never replaces** canonical sources. It *points at them*. If a wiki page contradicts the code or a `CLAUDE.md`, the code/`CLAUDE.md` wins — and the wiki page is the bug.

---

## Why this exists (alongside the other docs)

The project already has several well-loved knowledge artifacts:

- `CLAUDE.md` tree — auto-loaded into every Claude Code session; **schema-level overview** of each app/package
- `PROJECT_CONTEXT.md` — a single dense reference for system-wide architecture (562 lines)
- `.claude/rules/` — short, declarative rules (auth, data-access, payments)
- `.claude/knowledge/<agent>.md` — per-agent learnings appended after solving novel problems
- `.claude/agents/<agent>.md` — agent profiles with embedded reference material
- `packages/docs/` — human-authored architecture + security notes

The wiki adds three things these don't provide:

1. **Domain-oriented synthesis.** The existing docs are organized by *location* (which file, which app). The wiki is organized by *concept* (Reservation, Invoice, Settlement, Stripe flow). When the task is "explain how X works end-to-end," the wiki answers it without spelunking.
2. **Cross-references.** Every wiki page links to related pages and to canonical source files. The web of `[[type:slug]]` links + `path/to/file.ts:line` references lets the LLM walk from a question to the relevant code in 1–2 hops.
3. **Operational workflows.** `workflows/` documents *how* the LLM should approach recurring tasks (ingest new info, query the wiki, lint for drift, design a feature, debug a problem, implement a feature). These are procedures — they live with the wiki because they reference it.

---

## Directory layout

```
.claude/wiki/
├── README.md            # this file — the schema
├── index.md             # catalog of every wiki page, one-line summary, status
├── log.md               # append-only chronological record of wiki changes & ingests
├── workflows/           # how-to procedures the LLM follows
│   ├── ingest.md          # adding new info to the wiki
│   ├── query.md           # answering a question from the wiki
│   ├── lint.md            # health-checking the wiki
│   ├── feature-design.md  # designing a new feature
│   ├── debugging.md       # diagnosing a problem
│   └── implementation.md  # implementing a feature
├── entities/            # core domain concepts — one page per concept
│   └── *.md
├── flows/               # end-to-end journeys spanning multiple files/services
│   └── *.md
└── subsystems/          # cross-cutting modules (auth, payments, …)
    └── *.md
```

Add new directories only when a category has at least 3 pages. Until then, place orphan pages in the closest existing category.

---

## Page conventions

Every page starts with a frontmatter block:

```yaml
---
type: entity | flow | subsystem | workflow
slug: reservation             # matches filename (no extension)
status: stable | draft | stub | stale
sources:                      # canonical files this page synthesizes
  - packages/data/prisma/schema.prisma#model-Reservation
  - apps/user/app/sites/[id]/actions.ts
related:                      # other wiki pages — use [[type:slug]] anywhere
  - flow:reservation-payment
  - entity:invoice
last_verified: 2026-05-20     # date the page was last reconciled against the code
---
```

After the frontmatter, page bodies follow type-specific structures (see `workflows/ingest.md`).

### Cross-reference syntax

- `[[entity:reservation]]` — link to another wiki page (slug matches filename)
- `path/to/file.ts:42` — point at a specific line in the codebase
- `path/to/file.ts#symbol` — point at a symbol (function, model, component)

These are not real markdown links — they're a recognizable, greppable convention. Use them liberally; the LLM resolves them at query time.

### Page status

- **stable** — verified against current code within the last 30 days; safe to cite
- **draft** — newly written, not yet verified
- **stub** — placeholder; only the frontmatter and a TODO list exist
- **stale** — known to be out of date; do not cite without re-verifying

Update `status` and `last_verified` whenever you touch a page.

---

## Page sizing & bounded sections

Bloat is the wiki's main failure mode. Bounds force splits and consolidations before growth dilutes clarity.

### Page size budgets

| Page type | Target | Hard cap |
|---|---|---|
| `entity`     | 80–200 lines  | 300 |
| `flow`       | 100–300 lines | 400 |
| `subsystem`  | 100–200 lines | 300 |
| `workflow`   | 100–250 lines | 350 |
| `index.md`   | < 200 lines (the harness truncates entries past ~200) | 200 |

Hitting the hard cap is an automatic `split` or `consolidate` trigger — never an "append and hope".

### Bounded sub-sections

| Section | Max entries | Rule when exceeded |
|---|---|---|
| `sources:` frontmatter | 8 | Page is doing too much — split, or drop refs that aren't actively cited in the body |
| `related:` frontmatter | 8 | Same |
| **Common pitfalls** | 5–7 | Rotate: when adding, decide what to displace. Pitfalls that no longer reflect current code get removed, not preserved for history. |
| Invariants | 5–7 | Same as pitfalls — keep the load-bearing ones |
| Inline code blocks | as few as possible | Wiki cites code (`path/file.ts#symbol`); it does not reproduce code. Exceptions only when the snippet teaches something the file path won't convey. |

### Replace, don't append

When a section is wrong because the world changed, rewrite it. Do NOT add "as of <date>, this is now …" lines. The wiki documents *current truth*; git history records *when truth changed*.

### Cite, don't quote

When something is in the code, cite it (`path/file.ts#symbol`). Do not paste it. The wiki is a synthesis layer, not a mirror.

---

## Core operations

These are the workflows that keep the wiki alive. Each has a dedicated page under `workflows/`. All are invokable via the `/wiki <op>` slash command.

| Operation | Purpose | Cadence | Effect |
|---|---|---|---|
| `[[workflow:ingest]]`  | Fold new info into the wiki | After non-trivial code change | Writes |
| `[[workflow:query]]`   | Answer a question from the wiki | Per question | Read-only |
| `[[workflow:lint]]`    | Detect drift, bloat, contradictions | Weekly or pre-review | Read-only report |
| `[[workflow:prune]]`   | Actively remove dead/low-value content | After lint, or when wiki feels heavy | Deletes |
| `[[workflow:review]]`  | Periodic strategic re-pass — is each page still earning its keep? | Monthly, or post-major-release | Restructures |
| `[[workflow:feature-design]]`  | Use wiki when designing a feature | Per design | Read + maybe ingest after |
| `[[workflow:debugging]]`       | Use wiki when diagnosing a bug | Per bug | Read + maybe ingest after |
| `[[workflow:implementation]]`  | Use wiki when implementing | Per feature | Read + ingest after |

**Lint and prune are paired.** Lint *detects*; it doesn't delete. Prune is the only operation that removes content. This separation ensures every removal is intentional.

## Update modes

When updating the wiki, classify the change first. Mixing modes confuses the diff and tempts append-style bloat.

| Mode | When | Effect |
|---|---|---|
| **patch**       | Single fact correction, status flag, broken cross-ref | Inline edit, bump `last_verified` |
| **revise**      | A section is wrong because the world changed | Rewrite the section (replace, don't append). Bump `last_verified` |
| **add page**    | A new concept passes the wiki-worthiness test AND has no natural home in an existing page | New file with type-appropriate template; add to `index.md`; log it |
| **split**       | A page exceeded its size budget along a natural seam | Move sections to a new page; update cross-refs and index |
| **consolidate** | Two pages cover overlapping ground; one is dominant | Merge content into the dominant page; delete the other; update cross-refs and index |
| **retire**      | A concept no longer exists in code | Mark `status: stale`; remove from index's main listing; delete after a grace period (~30 days) |

`[[workflow:ingest]]` selects the right mode using a decision tree.

---

## How to use the wiki (for the LLM)

When the user asks a question or assigns a task:

1. **Look at `index.md` first.** It is always loaded via reference from this README. Scan the catalog for relevant slugs.
2. **Read the matching wiki page.** Pages are intentionally short (target: 100–300 lines) and dense with cross-references.
3. **Follow `[[…]]` links** to related entities/flows/subsystems as needed.
4. **Drop down to `sources:` files** only when the wiki page is insufficient.
5. **If you learned something the wiki should have told you,** ingest it (see `workflows/ingest.md`).

**For sub-agents** (`user-dev`, `partner-dev`, `data-dev`, `admin-dev`): your existing `.claude/knowledge/<agent>.md` knowledge base remains your **first** stop for hard-earned past learnings. The wiki is your **second** stop — consult it when you need cross-cutting context (a flow that spans apps, an entity that touches multiple subsystems).

---

## What the wiki does NOT contain

- **Code.** No code lives here. Snippets are fine for illustration, but the canonical version is in `sources:`.
- **Long prose.** If a page exceeds ~400 lines, split it.
- **Per-agent learnings.** Those live in `.claude/knowledge/<agent>.md`.
- **In-progress task state.** Use task-tracking tools, not the wiki.
- **Speculation.** Plans, dreams, and "we should" items belong elsewhere (issue tracker, `packages/docs/TODO.md`).
- **Duplicated content from `CLAUDE.md`.** The wiki *summarizes and indexes*; the canonical statement of every architectural rule stays in `CLAUDE.md` or `.claude/rules/`.

---

## Maintenance discipline

The wiki rots without active care, AND it bloats without active restraint. Both kill its utility. The gate below filters both failure modes against a single principle.

### The gate (apply before every write)

> **"Will an agent doing typical project work be more *informed*, *effective*, *reliable*, *concise*, or *deterministic* after this update — without becoming less of any of these?"**

Gain at least one. Sacrifice none. If both halves aren't a confident yes, skip — *doing nothing is a valid outcome*.

### The five qualities — what each means, and how updates affect them

| Quality | What it means for an agent doing project work | Update that increases it | Update that decreases it |
|---|---|---|---|
| **Informed** | Has the right facts when it needs them | Add a load-bearing fact the agent would otherwise miss; correct a wrong one | Omit a real invariant; leave a stale fact in place |
| **Effective** | Can act on the task without re-deriving understanding from source | Synthesize a flow end-to-end; add a cross-ref that shortcuts to the right page | Add info that's true but not actionable; scatter related info across pages |
| **Reliable** | Doesn't make confident mistakes; respects invariants and known pitfalls | Codify an invariant; document a pitfall it could hit and would otherwise miss | Drop a pitfall that's still possible; leave an invariant tacit; let two pages contradict |
| **Concise** | Uses fewer tokens to reach the same correct outcome | Cross-link instead of duplicating; replace prose with citation; remove dead content | Append "as of \<date\>" history; paste code; duplicate a rule across pages; bloat past the size budget |
| **Deterministic** | Produces consistent outputs across sessions and agents | Pick one approach and document it; resolve ambiguity; codify the canonical pattern | Document "X or Y" without picking; leave two equally-valid-looking paths; allow drift between code and claim |

**The first three are gains** an update can deliver. **The last two are constraints** an update must respect. Karpathy's growth-oriented pattern doesn't constrain — this project adds the constraints because layer-2 (auto-loaded) bloat compounds across every session and layer-3 (wiki) drift erodes trust.

`[[workflow:ingest]]` and `/update-knowledge` both operationalize this gate.

### Non-negotiable rules

- **Every non-trivial change to the code or `CLAUDE.md`** triggers a wiki-worthiness check via `[[workflow:ingest]]`. The check may decide *no update*. That's a valid outcome.
- **Every claim of "current behaviour"** must be checkable against a `sources:` file. Untraceable claims get deleted or qualified, not left.
- **Every page touched bumps `last_verified`.**
- **Every wiki write appends to `log.md`** — one line per change.
- **Every removal** goes through `[[workflow:prune]]`, never as a side effect of an ingest.

### Preferences when in doubt

- Fewer, denser pages over many thin ones
- Cross-references over duplication
- Pointing at code over describing code
- Marking a page `stale` over silently leaving it wrong
- A `[[workflow:prune]]` pass over leaving dead content "for history"

### Bloat indicators to watch

- A page approaches its hard cap → consider `split`
- A "Common pitfalls" section grows beyond 7 → rotate (remove old, keep load-bearing)
- Two pages have >40% overlap on a concept → `consolidate`
- A page's `sources:` exceed 8 entries → scope is too wide; `split`
- A page has not been read or cited in 6 months → `[[workflow:review]]` candidate

### What "success" looks like for the wiki

- An agent asked "how does X work?" answers from the wiki in one or two page reads, without source spelunking
- Bug-fix sessions cite a "Common pitfalls" bullet that warned them in advance
- New features extend existing entity/flow pages cleanly because the structure was right
- The total wiki line count stays roughly stable as the project grows — *because pruning happens*
