---
description: Groom one agent's playbook — dedupe, verify stale entries against code, migrate to v2, regenerate the index, propose promotions in both directions
argument-hint: <agent>   (partner-dev | user-dev | admin-dev | data-dev | sunbed-inventory)
allowed-tools: Read, Edit, Write, Bash(node:*), Bash(git:*), Grep, Glob
---
# /groom $ARGUMENTS

Curate `.claude/knowledge/$ARGUMENTS.md` per `.claude/knowledge/workflows/groom.md`, with the
track-031 script assistance. Grooming is the counter-loop to per-task capture: it is the only
operation that merges or deletes playbook entries. **Produce and curate stay separate** — do
not add new task learnings here.

## Gate

Every cut must leave agents more *concise* or *deterministic* without becoming less
*informed*, *effective* or *reliable* (`.claude/wiki/README.md` § Maintenance discipline). A
lesson still reachable against current code stays (revise it if the code moved). A
**dead-end** stays unless re-trying it could no longer waste time. Anything that should be
canon is **promoted**, not deleted.

## Procedure

1. **Read the signals.**
   - `node .claude/scripts/context-health.mjs --scope playbooks` — budget, duplicate sections,
     dated `##` headings, missing `tags:`, broken citations for this playbook.
   - `node .claude/scripts/knowledge-recall.mjs --candidates $ARGUMENTS` — episodic records on
     this surface that recur across sessions or were credited, and are not yet covered by the
     playbook. These are **inbound** promotion candidates.
   - Read the whole playbook once (this is the one place that is allowed).
2. **Classify every entry** — keep · merge-into · revise · delete · promote-to-canon. For each
   delete/revise candidate, **open the cited code** (`path/file.ts#symbol`) and confirm the
   Problem can or cannot still happen. Low confidence or high cost of being wrong → keep and
   list it for the human.
3. **Apply the structural fixes** (mechanical, always):
   - every entry is `### YYYY-MM-DD: title` under a `##` theme section — convert dated `##`
     entries, merge duplicate section headings, remove empty sections that sit mid-file;
   - add the v2 `tags:` line to every entry (`entities=… · files=… · track=…`, same vocabulary
     as `kb:` markers; files repo-relative), keeping the earliest date on merged entries;
   - fix or drop citations the health check reports as missing.
4. **Apply the content decisions** from step 2. Merge overlapping entries into the clearer one;
   rewrite stale ones; delete superseded ones. Long entries (> ~2 KB) that narrate a packet:
   keep the Problem/Solution/Prevention core, drop the narration.
5. **Write inbound promotions.** For each `--candidates` cluster that passes the gate, add a
   v2 entry (dated with the latest session) under the right section, citing code. Then
   `node .claude/scripts/knowledge-recall.mjs --credit <ids of the cluster>`.
6. **Regenerate the index:** `node .claude/scripts/playbook-index.mjs $ARGUMENTS`, then
   `node .claude/scripts/context-health.mjs --scope playbooks` must be clean for this file
   (or under the soft budget with only INFO left).
7. **Outbound promotions — propose, never apply.** List each entry that is authoritative *and*
   cross-cutting as an exact command for the orchestrator: `/wiki ingest <page>` or
   `/update-knowledge <file>` with a one-line summary of what moves. Promotion to canon changes
   what every session loads; a human decides.
8. **Do not** run `knowledge-curated.mjs` or `--snapshot` from inside a groom (the orchestrator
   runs them once after all grooms, to avoid concurrent writes).

## Report (end with exactly this)

```
## Groom: <agent>
Before → after: <bytes> → <bytes>, <entries> → <entries>
Merged: … · Revised: … · Deleted (verified against code): … · Kept with doubt (for the human): …
Inbound promotions written: <n> (credited ids …)
Outbound promotion proposals:
- /wiki ingest <page> — <what>
- /update-knowledge <file> — <what>
Health: <context-health --scope playbooks line for this file>
```
