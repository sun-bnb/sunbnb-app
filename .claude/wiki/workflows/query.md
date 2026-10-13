---
type: workflow
slug: query
status: stable
sources:
  - .claude/wiki/README.md
  - .claude/wiki/index.md
  - .claude/scripts/knowledge-recall.mjs
  - .claude/commands/recall.md
related:
  - workflow:ingest
  - workflow:debugging
last_verified: 2026-10-13
---

# Workflow: Query

When the user asks a question — about the architecture, how a flow works, where something lives, why something behaves the way it does — answer from the wiki first, then verify against code.

## Procedure

### 1. Decompose the question into concepts

"How does an order get paid?" → **order**, **payment** (provider rails: Mollie, Stripe Connect, Viva, demo), **invoice**.

"Why isn't the partner seeing their commission?" → **settlement**, **invoice (platform)**, **service-fee**.

### 2. Find candidate pages

Two entry points; use both when the question is fuzzy:

- **The index** — `index.md` is short; scan it for the concept slugs (`grep -i "<concept>" .claude/wiki/index.md`).
- **Recall** — `/recall "<question>"` (or `node .claude/scripts/knowledge-recall.mjs "<question>"`). Results come back tiered: **wiki** (canon) → **playbook** (curated) → **track** (intent) → **episodic** (raw past sessions). Wiki hits name the page and `##` section; `--layer wiki` restricts to the wiki, `--surface <agent>` keeps only that agent's playbook in the playbook tier.

### 3. Read the candidate pages

Read the matching pages (they're short) and follow `[[…]]` cross-refs the page marks as relevant. For per-surface detail, the page points at canon — the app/package `CLAUDE.md` and its pulled siblings (`PATTERNS.md`, `HW-API.md`, `ASSISTANT.md`, `EXPORTS.md`, `TESTING.md`, `UI.md`).

### 4. Check freshness

`last_verified` older than 90 days, or `status` `draft` / `stale` → treat the claims as **hypotheses**; verify against `sources:` before relying on them. Playbook and episodic hits are leads of lower trust — verify those too.

### 5. Drop down to source when needed

If the page doesn't answer fully, or you need a current line / signature / actual code:

- read the files in `sources:`; grep for symbols the page names;
- for DB state, use `/db` (read-only, env-tiered);
- delegate app-scoped digs to `data-dev`, `partner-dev`, `user-dev`, `admin-dev`.

### 6. Synthesize the answer with citations

Cite wiki pages and source files:

> Reservations create a gross PARTNER invoice plus a PLATFORM commission invoice on payment success (see `[[entity:invoice]]` and `packages/data/src/payment.ts#processConfirmedReservation`)…

If a recall hit materially helped, credit it: `node .claude/scripts/knowledge-recall.mjs --credit <id,id>` (feeds `/groom` promotion).

### 7. If you found a gap, ingest

Meaningful source reading to answer the question = the wiki has a gap. Add the insight to an existing page (preferred) or, if reusable and it passes the two-strikes rule, a new page — via `[[workflow:ingest]]`. Bump `last_verified` only on pages whose claims you actually re-verified.

## Quick patterns

| Question shape | Where to look first |
|---|---|
| "What is X?" (concept) | `entities/` |
| "How does X happen end-to-end?" | `flows/` |
| "How does the X module work?" | `subsystems/` |
| "Where is X handled?" | the matching entity/flow page, then its `sources:` |
| "Why does X behave this way?" | the page's **Invariants** / **Common pitfalls** |
| "Where does effort X stand?" | `.claude/tracks/index.md` (generated) → the track's **Resume here** |
| "What changed about X recently?" | `git log` first, then `log.md` for wiki-recorded changes |

## Anti-patterns

- **Quoting the wiki without verifying** anything load-bearing (auth checks, payment math, status logic).
- **Ignoring the wiki and grepping source for everything.** Try the wiki and recall first.
- **Treating an episodic hit as fact.** It's a lead from a past session; the code may have moved since.
- **Answering against the wiki without resolving the contradiction.** If the wiki is wrong, ingest the correction.
