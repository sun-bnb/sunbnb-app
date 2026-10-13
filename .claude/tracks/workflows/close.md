# Workflow: close a track

1. Confirm the **Goal** is met — or record why it's being abandoned.
2. Set `status: done` (or `abandoned`); write a final dated **Log** entry.
3. Rewrite **Resume here** as the outcome in one line ("DONE <date> — …"); regenerate the
   registry: `node .claude/scripts/tracks-index.mjs`.
4. Promote durable learnings: run `/wiki ingest <track>` (it may decide "skip" — log it) and/or
   write a memory file. The track's **Log** is the source material for this.
5. `node .claude/scripts/context-health.mjs --snapshot` so the close shows in the health history.
