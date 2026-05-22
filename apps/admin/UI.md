# Admin App — UI / design system

The **per-app layer** of the repo's design language. General conventions: the lean rule
`.claude/rules/ui.md` (non-negotiables) + the full `.claude/wiki/subsystems/design-system.md`.
Prime UI work with `/ui admin` (loads both). This file is *not* auto-loaded — pulled when doing UI work.

- **No token layer adopted yet** — the `accent` token + `.btn-*`/`.input`/`.card` classes are
  partner-app-scoped. Build net-new admin UI on the general patterns with raw Tailwind; add a token
  layer (mirror partner) only if admin's surface grows enough to warrant it.
- Utilitarian by nature: settlement tables, fee/settings forms, partner oversight — favor the
  general **list/index** and **detail/settings** patterns (grouped cards, `.input`-style fields,
  status `.badge`s). Every screen is sudo-gated.
- MUI/Tailwind as elsewhere; no new MUI.
