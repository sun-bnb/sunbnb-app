# Agent Knowledge Layer — Sunbnb

`.claude/knowledge/<agent>.md` is each dev agent's **playbook**: its curated, surface-specific
operating memory.

**The spec lives in the engine:** `.claude/context/engine/specs/playbooks.md` (the trust ladder,
playbook structure, v2 entry format with the `tags:` line, the generated navigation block, the
produce → curate loop and its gate). Curate with `/context-loop:groom <agent>`; regenerate a nav
block with `node .claude/context/engine/scripts/playbook-index.mjs <agent>`.

## Sunbnb playbooks

| Playbook | Agent | Surface (`budgets.json` `agents.surfaces`) |
|---|---|---|
| `user-dev.md` | `user-dev` | `apps/user/` |
| `partner-dev.md` | `partner-dev` | `apps/partner/` |
| `admin-dev.md` | `admin-dev` | `apps/admin/` |
| `data-dev.md` | `data-dev` | `packages/data/` |
| `sunbed-inventory.md` | `sunbed-inventory` | partner inventory editor + `packages/schematic` |

Tags reuse the repo's entity vocabulary (`.claude/context/project.json` `entities`), e.g.
`tags: entities=reservation,invoice · files=apps/partner/app/sites/[id]/manage/actions.ts · track=016`.
