# Workflow: handoff (run before ending work on a track)

The step that keeps a track resumable. Do it every time you stop, even mid-step.

1. Update the **Roadmap**: mark completed steps ✅, set the new ▶ current.
2. Append a dated **Log** entry: what was done, decisions made, anything that deviated.
3. **Rewrite Resume here** so the *next* cold agent knows the single next action + the exact
   context it needs. This is the most important step — write it for someone with zero memory.
4. Bump `updated:` in frontmatter; change `status:` if it moved (e.g. → `blocked`, with the
   blocker stated in Resume here).
5. Update the track's row in `index.md` (next action, status, updated).
6. (Optional) flag any durable learnings worth promoting to the wiki/memory.
