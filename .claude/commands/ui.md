---
description: Prime for UI work — loads the design language (style guide + tokens + components) so any agent applies it consistently instead of improvising
argument-hint: "[partner | user | admin | shared-components]"
---

# /ui — shared UI / design-system capability

The **shared capability** behind every screen in the repo. Invoke it before designing or
changing UI in any app, so you load the design language **once, from one source**, instead of
improvising near-equivalents. Any agent (a generalist, a specialist, or the main session) can
invoke it.

**Argument** (`$ARGUMENTS`, optional) — the surface you're working on:
`partner` · `user` · `admin` · `shared-components`. If omitted, load the general layer only.

## Load sequence

1. **The lean rule is auto-loaded** — `.claude/rules/ui.md` already gives you the non-negotiables.
2. **Read the full conventions:** `.claude/wiki/subsystems/design-system.md` — color/type/spacing/
   shape, the component class expansions, page-structure patterns, the reference impl, invariants +
   pitfalls (incl. the Tailwind content-scan gotcha for shared packages). This is the canonical
   detailed design language.
3. **Then read the per-app layer for `$ARGUMENTS`** — `apps/<app>/UI.md` (pulled, not auto-loaded) —
   for that app's token layer, reference impl, and current MUI state. The mature reference is
   **partner's** restaurant **General** tab (`apps/partner/app/restaurants/[id]/` +
   `RestaurantHeader`/`RestaurantSettingsForm`/`Toggle` in `packages/table-reservations-ui/src/partner/`).
   - `partner` → `apps/partner/UI.md` + `apps/partner/app/...`
   - `user` → `apps/user/UI.md` + `apps/user/app/...`
   - `admin` → `apps/admin/UI.md` + `apps/admin/app/...`
   - `shared-components` → `packages/ui`, `packages/table-reservations-ui`, `packages/schematic-editor`
     (style with **raw utilities** matching the guide — they can't see an app's `.class`/`accent`).

## Non-negotiables (these mirror the auto-loaded rule; full detail in the design-system wiki page)

- **Tailwind-first; no new MUI.** Replace MUI islands only when already editing them; keep MUI for
  dialogs/selects/date-pickers until an accessible Tailwind replacement exists. Toggles are done —
  use the Tailwind `Toggle`, not MUI `Switch`.
- **Use the token / component classes** (`accent`, `.btn-*`, `.input`, `.card`, `.badge`); fall back
  to raw utilities only for genuine one-offs. Rebrand = change `accent` in `tailwind.config.js`.
- **Shared-package components** use raw utilities (no app `.classes`/`accent`), kept aligned by hand.
  New Tailwind classes in a shared package only generate if its glob is in the consuming app's
  `tailwind.config.js` `content` — otherwise they're purged.
- **Settings pages** = identity header (monogram + chips + inline save status) → grouped cards.
  **Success = green** (not emerald). A11y is on us when leaving MUI (`role`, focus, keyboard).

## While you work

Follow `.claude/agent-protocol.md`: emit `kb:` markers for UI gotchas you hit. If you evolve the
language, update `.claude/rules/ui.md` (canonical) **and** fold it into the wiki via `/wiki ingest`
(`subsystems/design-system.md`, bump `last_verified`; promote `draft`→`stable` once verified).
