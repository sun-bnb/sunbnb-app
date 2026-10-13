# LLM Wiki — Sunbnb

The wiki gives Claude Code and its sub-agents structured, concept-level access to how Sunbnb
works (Reservation, Invoice, payment flow, …) without re-deriving it from source on every task.

**The schema and every rule live in the engine spec:** `.claude/context/engine/specs/wiki.md`
(page types and templates, frontmatter, sizing, update modes, log format, and the
**Maintenance discipline** five-qualities gate). Operate the wiki with `/context-loop:wiki`
(`ingest`, `query`, `lint`, `prune`, `review`). This file holds only Sunbnb's local conventions.

## Sunbnb conventions

- **Raw sources** besides the code: the `CLAUDE.md` tree, `PROJECT_CONTEXT.md` (human-owned
  narrative — never edit it from a wiki operation), `.claude/rules/` (auth, data-access,
  payments, migrations, deploys, commits, ui, architecture) and `packages/docs/`.
- **Speculation and plans** go to `packages/docs/TODO.md` or a track, never into a wiki page.
- **Repo-specific workflows** in `workflows/`: `feature-design.md`, `debugging.md`,
  `implementation.md` (Sunbnb's dev process; they reference the wiki). The generic wiki
  operations ship with the plugin.
- **Owning agents** for promotion proposals: `user-dev`, `partner-dev`, `admin-dev`, `data-dev`,
  `sunbed-inventory` (`.claude/agents/`).
- **Retired pages** stay as stubs for 30 days, listed under index "Retired", then are deleted.

Start any "how does X work end-to-end" question at `index.md`.
