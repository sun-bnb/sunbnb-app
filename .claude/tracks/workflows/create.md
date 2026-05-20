# Workflow: create a track

1. Pick the next `NNN` (zero-padded, sequential); slug = kebab of the goal.
2. Create `.claude/tracks/NNN-slug.md` with frontmatter (`status: proposed`, today's `created`
   + `updated`, `worktree: null`) and the section skeleton: Goal, Resume here, Roadmap, Log,
   Open decisions, Links.
3. Write the **Goal** and an initial **Roadmap** (phases/steps). Set **Resume here → Next
   action** to the first concrete step a cold agent could execute.
4. Add a row under **Proposed / backlog** in `index.md`.
5. Flip `status: active` (and move the index row to **Active**) when work actually starts.
