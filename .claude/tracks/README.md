# Tracks — Sunbnb

Durable, resumable units of long-horizon work: goal, roadmap, log, **Resume here**.

**The spec lives in the engine:** `.claude/context/engine/specs/tracks.md` (anatomy,
frontmatter, status vocabulary, sanctioned sub-documents, the generated registry). Operate tracks
with `/context-loop:track create | resume | handoff | close | index`. Start at `index.md`
(generated; never edit by hand).

## Sunbnb conventions

- Roadmap steps use ✅ (done) and ⬜ (open) markers.
- Legacy phased plans in `.claude/plans/` predate tracks and are not tracks; migrate one into a
  track when work on it resumes.
