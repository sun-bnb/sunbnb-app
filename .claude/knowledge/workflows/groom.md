# Workflow: Groom a playbook

Active curation of a single agent's playbook (`.claude/knowledge/<agent>.md`). Grooming
is the **counter-loop** that keeps the playbook from rotting: it dedupes, deletes stale
entries, rebuilds the navigation index, and surfaces promotion candidates. It is the
playbook analog of the wiki's paired `prune` + `review` workflows, governed by the trust
ladder in `.claude/knowledge/README.md`.

Grooming is **periodic, not per-task.** Per-task capture happens in the agent's gated
retrospective; grooming is the deliberate maintenance pass that runs over the result.

## How this serves the gate

Grooming is justified by **concise** and **deterministic** gains (apply the five-qualities
gate from `.claude/wiki/README.md`). Every removal answers: *after cutting this, are agents
more concise (less to read) or more deterministic (less conflicting/ambiguous), without
becoming less informed/effective/reliable?* If a cut would lose a still-relevant lesson,
revise the entry instead of deleting it.

## When to run

- **Threshold** — an agent's playbook crosses a size/staleness threshold (an agent may
  *suggest* a groom when its playbook feels heavy; it does not groom mid-task).
- **After a refactor** — code changed enough that documented patterns may be stale.
- **On demand** — invoked by the orchestrator/human, scoped to one agent's playbook.
  (May later be wrapped as a `/groom <agent>` command — not required to run the workflow.)

## What to groom

- **Duplicate / overlapping entries.** Two entries teaching the same lesson → merge into
  the clearer one; keep the dating of the earliest occurrence.
- **Stale entries.** An entry whose Problem the current code makes impossible, or whose
  Solution no longer matches the code. *Test: can this still happen against current code?*
  If no → delete. If the lesson survives in changed form → revise.
- **Superseded entries.** A later, better entry covers the same ground → remove the older.
- **Navigation index drift.** Rebuild the index so it lists exactly the themes/topics the
  current sections contain — no missing topics, no pointers to deleted ones.
- **Promotion candidates.** A curated entry that is authoritative *and* cross-cutting
  (other surfaces would benefit) → flag it for promotion to canon (`/wiki ingest`, or a
  `CLAUDE.md`/`.claude/rules/` edit). Surface it; don't promote silently.
- **Bloated sections.** A section grown past usefulness → keep the load-bearing entries,
  rotate out the lowest-value ones (score by: could this mistake still be made?).

## What NOT to groom away

- A lesson still reachable against current code, even if rarely hit. The playbook teaches.
- A **dead-end / rejected-approach** entry — its whole job is to stop a future agent
  re-trying the wrong thing. Recurrence isn't the test; *would re-trying it waste time?*
- An entry that should be canon — **promote** it, don't just delete it.

## Procedure

1. **Read the whole playbook** section by section against "What to groom".
2. **Classify each candidate** — category, confidence it's dead, cost of being wrong. Low
   confidence or high cost → leave it and note it for a human, don't cut unilaterally.
3. **Verify stale candidates against current code** before deleting — open the cited
   `path/file.ts#symbol`; the code is the authority.
4. **Apply** — merge/delete/revise high-confidence, low-cost candidates.
5. **Rebuild the navigation index** to match the post-groom sections.
6. **Record promotions** — for each promotion candidate, note what should go to canon and
   where, so the follow-up `/wiki ingest` or canon edit is unambiguous.

## Anti-patterns

- Shortening a playbook for its own sake — length isn't the enemy; *unjustified* length is.
- Deleting a dead-end entry because "no one re-tried it lately."
- Deleting a cross-cutting lesson instead of promoting it to canon.
- Grooming and per-task capture in the same pass — keep produce and curate separate.
