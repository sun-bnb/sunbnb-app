# Agent Knowledge Layer — Sunbnb

`.claude/knowledge/<agent>.md` is each agent's **playbook**: its curated, growing,
surface-specific operating memory. It is where an agent records what it learned solving
real problems on its surface, so the next session starts informed instead of
re-deriving the same understanding.

This file is the **spec** for that layer — the playbook analog of `.claude/wiki/README.md`.
It defines the playbook's role, structure, and the **trust ladder** that governs how
knowledge moves between layers. The grooming routine (`workflows/groom.md`) enforces it.

> The point is not to *accumulate* knowledge but to accumulate → curate → promote it, so
> the store gets **more trustworthy over time** rather than rotting. Accumulation without
> curation is the failure mode this layer is designed against.

---

## The three knowledge layers an agent sees (the trust ladder)

| Layer | Lives in | Character | How the agent uses it |
|---|---|---|---|
| **episodic** | the vector store (`knowledge-recall.mjs`) | noisy, auto-captured from `kb:` markers, semantic, **shared across all agents** | query at task start for *leads*; verify before relying |
| **curated** | this layer — `.claude/knowledge/<agent>.md` | deliberate, verified, **surface-specific**, navigable | read at task start; append after non-trivial work |
| **canonical** | `CLAUDE.md` tree · `.claude/wiki/` · `.claude/rules/` | authoritative, the source of truth | the spec — trust it over memory |

**Trust increases as you climb. Authority is the reverse: canon always wins.** If a
playbook entry contradicts current code or canon, the code/canon wins and the entry is
the bug — correct or delete it.

### Promotion (knowledge earns its way up by recurring + verifying)

- **episodic → curated.** A recall lead that proves correct and recurs gets written up as
  a curated playbook entry (don't leave load-bearing knowledge only in the noisy store).
- **curated → canonical.** A playbook entry that is authoritative *and* cross-cutting
  (other surfaces would benefit) gets **proposed** for promotion — a `/wiki ingest` for a
  flow/entity/subsystem, or a `CLAUDE.md`/`.claude/rules/` edit. Promotion to canon is
  always *proposed, never silent* — changing what every session loads is a deliberate act.

### Demotion / deletion

Anything current code contradicts is corrected or removed — during the gated
retrospective when an agent notices it, or during a grooming pass. Stale knowledge that
misleads is worse than no knowledge.

### Where the orchestrator sits

The main session (orchestrator) has **no playbook of its own — by design.** Its knowledge
is cross-cutting, so its curated layer is the **shared canon** (`CLAUDE.md` tree / wiki /
rules) plus the user-global `~/.claude/.../memory/` store (which carries its own
dedup/update/delete grooming, with `MEMORY.md` as its navigation index). It emits `kb:`
markers like any agent and is the one that *performs* promotion to canonical (`/wiki
ingest`, canon edits) — it sits at the top of the ladder, not on a rung. **Do not create
an `orchestrator.md` playbook:** cross-cutting knowledge belongs in canon — promoted,
committed, shared — not a private orchestrator silo.

---

## Playbook structure

Every `.claude/knowledge/<agent>.md` follows the same shape:

1. **Header** — one line: whose growing memory this is, governed by this README.
2. **Navigation index** — a maintained theme/tag map at the top: the handful of topics
   this playbook covers, so the agent (and recall) cheaply knows *what it knows* and
   where to look. Rebuilt by the grooming routine; it is the "learning to navigate" half
   of the layer.
3. **Themed sections** — buckets matching the agent's surface disciplines (e.g. *Auth &
   ownership*, *Test failures & fixes*, *Schema & migrations*, *Rejected approaches*).
   Seeded empty; grown by appending entries.

### Entry format

```
### YYYY-MM-DD: <concise title>
**Problem:** what went wrong / what was non-obvious
**Solution:** what actually worked
**Prevention:** how a future session avoids the friction (cite `path/file.ts#symbol`)
```

Cite code (`path/file.ts:line` / `#symbol`); don't paste it. Keep entries dense and
self-contained — readable months later without the surrounding conversation, the same
discipline as the `kb:` markers in `.claude/agent-protocol.md`.

---

## How knowledge gets in (the produce → curate loop)

- **Produce** — during work, emit `kb:` markers at the moment of insight (they flow to the
  vector store at session end, including from subagents). After a *non-trivial* task, run
  the gated retrospective in your agent skeleton: add a curated entry here for anything
  durable. Trivial tasks add nothing — silence is a valid outcome.
- **Curate** — periodically, `workflows/groom.md` dedupes/merges entries, deletes stale
  ones (verified against current code), rebuilds the navigation index, and surfaces
  promotion candidates. This is the mandatory counter-loop; without it the playbook rots.

## The gate (apply before every entry)

Reuse the five-qualities gate from `.claude/wiki/README.md`: an entry earns its place
only if a future agent doing typical work on this surface would be more **informed**,
**effective**, or **reliable** for it — *without* becoming less **concise** or
**deterministic**. Gain at least one; sacrifice none. Otherwise, don't write it.

## What the playbook does NOT contain

- **Canon.** Route maps, state machines, status lists, payment rules — those live in the
  `CLAUDE.md` tree / `.claude/rules/` / wiki and are pulled fresh. Point at them; don't copy.
- **Cross-cutting synthesis.** A flow that spans apps belongs in the wiki — propose a
  promotion instead of duplicating it per agent.
- **Code.** Cite it.
- **In-progress task state.** Use the task tools, not the playbook.
- **Another surface's knowledge.** The playbook is surface-specific; shared insight is
  promoted to canon where every agent sees it, not copied between playbooks.
