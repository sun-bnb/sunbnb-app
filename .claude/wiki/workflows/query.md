---
type: workflow
slug: query
status: stable
sources:
  - .claude/wiki/README.md
  - .claude/wiki/index.md
related:
  - workflow:ingest
  - workflow:debugging
last_verified: 2026-05-20
---

# Workflow: Query

When the user asks a question — about the architecture, how a flow works, where something lives, why something behaves the way it does — answer from the wiki first, then verify against code.

## Procedure

### 1. Decompose the question into concepts

"How does an order get paid?" → concepts: **order**, **payment**, **stripe/mollie/demo**, **invoice**.

"Why isn't the partner seeing their commission?" → concepts: **settlement**, **invoice (platform)**, **service-fee**.

### 2. Scan the index

`index.md` is intentionally short. Read it top-to-bottom; identify candidate pages by concept.

```bash
grep -i "<concept>" .claude/wiki/index.md
```

### 3. Read the candidate pages

Read full pages (they're short). Follow `[[…]]` cross-refs that the page suggests are relevant to your question.

### 4. Check freshness

If a page's `last_verified` is older than 90 days, or its `status` is `draft` / `stale`, treat its claims as **hypotheses**, not facts. Verify against `sources:` before relying on them.

### 5. Drop down to source when needed

If the wiki page doesn't answer the question fully, or you need a current line number / type signature / actual code:

- Read the files listed in `sources:`
- Use `Grep` / `Glob` for symbols the wiki page mentions
- Prefer `data-dev`, `partner-dev`, `user-dev`, `admin-dev` sub-agents for app-scoped digs

### 6. Synthesize the answer with citations

Cite both wiki pages and source files in your answer:

> Reservations create two invoices on payment success (see `[[entity:invoice]]` and `packages/data/src/payment.ts#processConfirmedReservation`)…

This lets the user verify and lets future-you find the citation again.

### 7. If you found a gap, ingest

If you had to do meaningful source reading to answer the question, the wiki has a gap. Either:

- Add the new insight to an existing page (preferred), or
- Create a new page for it (only if it's reusable; see `[[workflow:ingest]]`)

Update `last_verified` on any page whose claims you re-verified.

## Quick patterns

| Question shape | Where to look first |
|---|---|
| "What is X?" (concept) | `entities/` |
| "How does X happen end-to-end?" | `flows/` |
| "How does the X module work?" | `subsystems/` |
| "Where is X handled?" | the relevant entity/flow page; then `sources:` |
| "Why does X behave this way?" | the **Invariants** or **Common pitfalls** section of the matching page |
| "What changed about X recently?" | `git log` first, then `log.md` for wiki-recorded ingests |

## Anti-patterns

- **Quoting the wiki without verifying.** Wiki pages can drift. For anything load-bearing (auth checks, payment math, status logic), verify against `sources:` before claiming current behaviour.
- **Ignoring the wiki and grepping source for everything.** The wiki exists so you don't have to. Try it first.
- **Synthesizing an answer that contradicts the wiki without resolving the contradiction.** If you find the wiki wrong, ingest the correction; don't just route around it.
