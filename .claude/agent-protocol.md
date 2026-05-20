# Agent Operating Protocol

Shared rules for **every** agent working in this repo (the main session, the dev
generalists, and the feature specialists). Read this once at the start of a task.
It governs *how you emit output* so that downstream agents and the episodic
knowledge store (`.claude/scripts/knowledge-ingest.mjs` → `/recall`) can capture
your reasoning **deterministically** instead of inferring it.

It does **not** restate project rules — those live in `.claude/rules/`, the
`CLAUDE.md` tree, and the wiki (`.claude/wiki/`). This file is about *output shape*.

---

## 1. Knowledge markers (`kb:` blocks)

When you reach a durable, reusable insight during work — **emit a fenced `kb:`
block inline, in your normal response**. These are extracted verbatim by the
distiller (high fidelity), and any agent reading your transcript or report sees
them at a glance. Don't wait until the end; emit at the moment of insight.

The five types match the knowledge-store record types exactly — use one as the
fence info-string:

| Type | Emit when… |
|---|---|
| `decision` | You chose an approach over alternatives. Include the **why**. |
| `incident` | Something broke. Symptom → root cause → fix. |
| `gotcha` | A non-obvious surprise/trap a future agent would hit. |
| `dead-end` | An approach you tried and **rejected**, so nobody re-tries it. |
| `observation` | A durable truth about how the system actually behaves. |

### Format

````
```kb:gotcha
entities: inventory, schematic
files: packages/schematic/src/grid.ts, apps/partner/app/sites/[id]/inventory/InventoryMap.tsx
The 2.1m sunbed length is the SUNBED_HEIGHT constant in grid.ts; InventoryMap's
getScaledSize() converts it to pixels per zoom. Hardcoding a pixel size anywhere
silently desyncs the map markers from the generated grid.
```
````

- First line after the fence: `entities:` — comma-separated domain nouns (reservation, order, invoice, payment, settlement, inventory, schematic, site, rental…). Optional but encouraged.
- Optional `files:` — comma-separated repo-relative paths the insight concerns.
- Everything after the metadata lines is free text. **State the WHY**, in 1–4 sentences, self-contained (readable without the surrounding conversation).
- Don't emit for routine edits, restating code, or anything trivially re-derivable. Quality over quantity — a session with two sharp `kb:` blocks beats one with ten obvious ones.

---

## 2. Subagent final report

When you are a subagent returning to an orchestrator, end with this exact section
structure so the handoff is parseable:

```
## Summary
One or two sentences: what you did and the outcome.

## Changes
- path/to/file.ts:line — what changed and why
(omit if you made no edits)

## Decisions & Gotchas
The kb: blocks you emitted (repeat them here, or "none").

## Verification
What you ran (tests, build, manual check) and the result. If you couldn't
verify, say so explicitly — never imply success you didn't observe.

## Handoff
What the orchestrator / next agent needs: open questions, follow-ups, risks,
or "complete — nothing pending".
```

The orchestrator relays your `## Summary` to the user (your full report is not
visible to them).

---

## 3. Errors & blockers

When you hit a failure or get blocked, report it as an `incident` marker — never
swallow it, never paper over it:

````
```kb:incident
files: apps/partner/app/sites/[id]/inventory/actions.ts:303
What failed: moveParcel returned status:error "site not found".
Where: requireSiteOwner(siteId) — siteId was the inventory item id, not the site id.
Root cause: caller passed item.id; the action expects item.siteId.
Tried: re-fetching the item to read siteId — works.
Needed: nothing, fixed. (or: "blocked on X, need Y to proceed")
```
````

If a blocker stops you from completing the task, still produce the §2 report with
the incident under **Decisions & Gotchas** and the blocker under **Handoff**.

---

## 4. Reuse the existing canon — don't duplicate it

Before writing anything, the order of consult is: your `.claude/knowledge/<agent>.md`
(hard-won past learnings) → the wiki `.claude/wiki/index.md` (cross-cutting context)
→ `.claude/rules/` + `CLAUDE.md` tree (declarative rules) → source.

When you reference code, **cite `path/file.ts#symbol` or `path:line`** — do not paste
code into reports or markers. Server actions return `{ status: 'ok' | 'error', errors?: string[] }`;
status strings come from `@repo/data/reservation-status`; prices come from the DB.
These are stated once, in the rules — follow them, don't re-explain them.
