# User App — UI / design system

The **per-app layer** of the repo's design language. General conventions: the lean rule
`.claude/rules/ui.md` (non-negotiables) + the full `.claude/wiki/subsystems/design-system.md`.
Prime UI work with `/ui user` (loads both). This file is *not* auto-loaded — pulled when doing UI work.

Consumer-facing + **mobile-first**, so it diverges from partner:

- **No token layer adopted yet.** The `accent` token and `.btn-*`/`.input`/`.card` classes are
  partner-app-scoped — not defined here. Build net-new user UI on the general patterns with raw
  Tailwind; introduce a token layer (mirror partner's `tailwind.config.js` + `globals.css`) if/when
  a design-system pass lands here.
- **Signature surface — the mobile reservation drawer:** fixed bottom panel with peek/expanded
  states whose peek height adapts per tab (`viewMode` in Redux); the booking flow is RTK-state-driven.
  Keep it cohesive — it's the user app's defining UI.
- **MUI + Tailwind coexist** (per the stack); migrate off MUI opportunistically, same stance as partner.
- Shared building blocks usable here: `Toggle` (`@repo/table-reservations-ui`), `SaveStatusBanner`
  (`@repo/schematic-editor`); consumer table-booking components live in
  `@repo/table-reservations-ui/src/consumer/`.
