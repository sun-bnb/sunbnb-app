# Partner App — UI / design system

The **per-app layer** of the repo's design language. General conventions: the lean rule
`.claude/rules/ui.md` (non-negotiables) + the full `.claude/wiki/subsystems/design-system.md`.
Prime UI work with `/ui partner` (loads both). This file is *not* auto-loaded — pulled when doing UI work.

Partner is the **reference implementation** of the design language.

- **Token layer:** `accent` color (DEFAULT `#111827`/gray-900, `accent-hover` gray-700) in
  `tailwind.config.js`; the `@layer components` classes (`.btn-primary`, `.btn-ghost`, `.btn-danger`,
  `.input`, `.label`, `.card`, `.card-add`, `.badge`) in `app/globals.css`. Rebrand the primary
  action by changing `accent`. Tailwind `content` scans `@repo/table-reservations-ui` +
  `@repo/schematic-editor` so their utilities aren't purged.
- **Reference impl (mirror it):** the restaurant **General** tab — `app/restaurants/[id]/view.tsx`
  + `RestaurantHeader.tsx`, and `RestaurantSettingsForm`/`RestaurantHoursEditor`/`Toggle` in
  `packages/table-reservations-ui/src/partner/`. Identity header + grouped cards; all four
  restaurant detail tabs share `RestaurantHeader`.
- **MUI-migration state:** legacy form-heavy pages stay MUI-heavy (e.g. `sites/[id]/general/view.tsx`,
  the restaurant dialogs `MenuItemDialog`/`TableGridDialog`, `TableForm`) — migrate opportunistically.
  Toggles are done (Tailwind `Toggle`). Phase-2 cleanup of `@repo/table-reservations-ui`
  (MenuEditor/ReservationList/etc.) is queued in `.claude/tracks/002-table-reservations.md`. Keep MUI
  dialogs until an accessible Tailwind replacement exists.
