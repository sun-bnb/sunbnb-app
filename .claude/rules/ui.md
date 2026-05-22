# UI Design Language (rule)

The UI design language for the whole repo. **For any UI build or change, prime with
`/ui <surface>`** — it loads the full conventions (`.claude/wiki/subsystems/design-system.md`) +
the app's concrete layer (`apps/<app>/UI.md`) + the reference impl. Don't improvise UI; mirror the
reference. The non-negotiables below are the only part kept always-loaded; everything else is
pulled on demand.

## Non-negotiables

- **Tailwind-first; no new MUI.** Migrate MUI islands opportunistically; keep MUI for dialogs /
  selects / date pickers / tooltips until an accessible Tailwind replacement exists. Toggles are
  done — use the Tailwind `Toggle` (`@repo/table-reservations-ui`), not MUI `Switch`.
- **One `accent` token per app** for the primary action (a dark neutral; `accent` + `accent-hover`),
  defined in that app's `tailwind.config.js`. Rebrand in one place; never hardcode the neutral.
- **Use the component classes / token** (`.btn-*`, `.input`, `.card`, `.badge`, `accent`); raw
  utilities only for genuine one-offs. Don't invent `text-base`, `emerald`-for-status, or a bespoke button.
- **Status = green / red / amber / blue** via `{ bg-X-50, border-X-200, text-X-600/700 }`. Success
  is **green**, not emerald.
- **Shared-package components** (`@repo/*`) can't see an app's `.classes` / `accent` — they style
  with raw utilities matching the language; the consuming app's `tailwind.config.js` `content` must
  scan the package or its classes get purged.
- **Accessibility is on us** once we leave MUI: `role`, focus management, keyboard (banners
  `role="status"`, toggles `role="switch"`).

## Where the rest lives

- **Full conventions** (color/type/spacing/shape, component class expansions, page-structure
  patterns, invariants, pitfalls, reference impl) → `.claude/wiki/subsystems/design-system.md`.
- **Per-app concretes** (token values, class location, reference impl, MUI state) → `apps/<app>/UI.md`.
- **Prime both at once** → `/ui <surface>`.
