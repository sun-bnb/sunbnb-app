---
id: 033-context-system-plugin
title: Package the context system as a distributable Claude Code plugin
status: active
created: 2026-10-13
updated: 2026-10-13
worktree: null
---

## Goal

Make the context system built in tracks 001 and 031 installable in any repo. The generic part (the
**engine**: health check, registries, knowledge store, curation commands, hooks, specs) ships as a
Claude Code plugin from its own repo and marketplace. The repo-specific part (the **instance**:
budgets, project identity, the `CLAUDE.md` tree, rules, wiki, playbooks, tracks, agents) is
generated per repo by `/context init` and owned by that repo. Sunbnb becomes the plugin's first
consumer, so the engine stays exercised by real work.

## Resume here

- **Next action:** step 2 — create the plugin repo (`.claude-plugin/plugin.json`, `scripts/`,
  `commands/`, `hooks/hooks.json`, `templates/`) and decide how commands call the scripts (see
  Open decisions); then install it here and delete the local engine copies, checking that
  `context-health.mjs --json --with-store` reports the same 23 findings as before.
- **Plugin:** `context-loop`, repo https://github.com/vhalme/context-loop (public, empty as of
  2026-10-13; no licence chosen yet). The repo is both the plugin and its marketplace.
- **Blocked by:** nothing.

## Roadmap

- ✅ **Step 1 — parameterize the engine in place (2026-10-13).** No behaviour change for Sunbnb.
  - `.claude/scripts/context-config.mjs` is now the only resolver. It finds the repo
    (git → `CLAUDE_PROJECT_DIR` → cwd, never the script's own location), loads `budgets.json`,
    loads the new `.claude/context/project.json` with defaults derived from the project slug, and
    reads workspaces from `package.json` `workspaces` or `pnpm-workspace.yaml`.
  - The store container, port, password and database now come from `project.json`.
    `.env.knowledge` is read from the target repo. The distiller's entity examples are read from
    `project.json` `entities`, which drops the retired `settlement`.
  - The workspace checks and the worktree path normalization use the workspace list instead of
    the hardcoded `apps/` and `packages/`.
  - In a repo without an instance, the `--summary` mode now exits 0 silently, because a plugin's
    hooks fire in every repo. A missing `.claude/knowledge` or `.claude/tracks` no longer crashes
    the health check.
  - Verified: the HEAD scripts and the new scripts produce identical health findings (23 = 23,
    store total 3607). The curated index ran with no changes. The scripts work when copied
    outside the repo and run from a subdirectory or `/tmp`. Against a throwaway non-Sunbnb repo
    with `libs/*` workspaces, they give the right findings and the right derived store names.
- ⬜ **Step 2 — extract the engine into `vhalme/context-loop`; Sunbnb installs it.** Move the
  engine files in the inventory below. The engine commands become **skills** so Claude can
  invoke them from their descriptions. They are namespaced `/context-loop:<skill>`:
  - `context`: check, sync, help, and later init
  - `recall`
  - `groom`
  - `wiki`: ingest, lint, prune, query, review
  - `update-knowledge`
  - `track`: create, handoff, close, which until now were workflow docs only

  Each skill bundles or references the scripts. Hooks move to the plugin's `hooks/hooks.json` using
  `${CLAUDE_PLUGIN_ROOT}`, and `.claude/settings.json` loses them. The script dependencies (`pg`,
  `dotenv`, `@huggingface/transformers`) get a first-run install inside the plugin. The fix-hint
  strings (`node .claude/scripts/…`) become a single command-path helper.
- ⬜ **Step 3 — `/context init`.** It detects workspaces and writes `budgets.json`,
  `project.json`, the root `CLAUDE.md` "Context system" section, and empty
  `wiki/`/`tracks/`/`knowledge/`. It drafts a `CLAUDE.md` for each workspace and an agent per
  surface from a template, all as proposals. The pgvector store is optional, provisioned through
  `knowledge-ensure` (today it only reports a missing container). It prints the pre-push line to
  add. Test it on a fresh repo and on one existing non-Sunbnb repo.
- ⬜ **Step 4 — publish.** Write `marketplace.json` and a README covering install, init, what
  loads when, and the store being optional. Consider the public plugin directory only after
  outside repos have used it.
- ⬜ **Step 5 (optional) — a dev-workflow plugin in the same marketplace.** It holds the
  generic, non-context pieces: `/commit` and the commit-message rules, the deploy verb-ladder
  rule, a review skill, and a verifier template that init fills in per app. Keeping it separate
  keeps `context-loop` lean.

## Engine / instance inventory

| Engine (moves to the plugin) | Instance (stays in each repo) |
|---|---|
| `.claude/scripts/*.mjs`, `knowledge-schema.sql`, `package.json` | `.claude/context/{budgets,project}.json`, `health-history.jsonl` |
| `commands/{context,groom,recall,wiki,update-knowledge}.md` | `commands/{db,migrate,test,review,schematic,ui,commit}.md` |
| `context/{help.md,workflows/}`, `wiki/workflows/{ingest,lint,prune,query,review}.md` | `wiki/workflows/{debugging,feature-design,implementation}.md` (Sunbnb dev process) |
| Specs: `wiki/README.md`, `knowledge/README.md` + `workflows/`, `tracks/README.md` + `workflows/`, `agent-protocol.md` | Wiki pages, playbooks, tracks, `index.md` files |
| SessionStart/SessionEnd hooks (`settings.json`) | `CLAUDE.md` tree, `.claude/rules/`, `.claude/agents/`, `.githooks/pre-push` |

## Log

- 2026-10-13 — Track opened from the packaging discussion. Step 1 shipped: config module,
  `project.json`, workspace-driven checks, bare-repo guards, generic schema header, scripts
  package renamed `context-system-scripts`. The name `context-loop` was chosen over
  `monorepo-context`, which would have excluded single-package repos, and the user created
  `vhalme/context-loop`. Skills, not commands, are the plugin's entry points.

## Open decisions

- **How commands call scripts.** `${CLAUDE_PLUGIN_ROOT}` expands in plugin hooks and plugin
  commands, but the agent definitions and specs that live in a repo say `node .claude/scripts/…`.
  Options: (a) the plugin commands are the only entry point and the specs name commands, not
  scripts; (b) `/context init` writes a `.claude/scripts/ctx` shim that execs the plugin copy.
  Leaning toward (a).
- **Licence** for `context-loop`, needed before step 4. MIT is the usual choice for plugins.
- **Where the specs live.** Option one: the plugin ships them and the instance points at them.
  Option two: init copies them in, which lets a repo tune them but lets them drift. Leaning
  toward shipping them, with init copying only the templates.

## Links

- Prior work: [[track:031-context-system-v2]] (the curation loop), [[track:001-knowledge-store]]
- Design anchor: `.claude/wiki/subsystems/context-system.md` (invariant 7: engine vs instance)
