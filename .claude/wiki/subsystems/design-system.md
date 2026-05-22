---
type: subsystem
slug: design-system
status: draft
sources:
  - .claude/rules/ui.md
  - apps/partner/tailwind.config.js
  - apps/partner/app/globals.css
  - apps/partner/app/restaurants/[id]/RestaurantHeader.tsx
  - packages/table-reservations-ui/src/partner/RestaurantSettingsForm.tsx
  - packages/table-reservations-ui/src/partner/Toggle.tsx
  - packages/schematic-editor/src/chrome/SaveStatusBanner.tsx
related:
  - subsystem:schematic-editor
last_verified: 2026-05-22
---

# Subsystem: Design System

The repo's UI design language — the **full conventions live here**. The lean always-applied rule
`.claude/rules/ui.md` carries only the non-negotiables and points here; each app's **concrete
layer** (token values, class location, reference impl, MUI state) lives in its own pulled
`apps/<app>/UI.md` (one-line pointer in the app's `CLAUDE.md`). **Partner** is the mature
reference; `user`/`admin` follow the language without a token layer yet. Prime with `/ui <surface>`.

## Where it lives

| Layer | Lives in | What |
|---|---|---|
| Non-negotiables (auto-loaded) | `.claude/rules/ui.md` | the short always-applied rule + pointer here |
| Full conventions (this page) | `.claude/wiki/subsystems/design-system.md` | color/type/spacing/shape, components, page patterns |
| Per-app layer (pulled) | `apps/<app>/UI.md` | token values, class location, reference impl, MUI-migration state |
| Color token (partner) | `apps/partner/tailwind.config.js` | `accent` (DEFAULT gray-900, `accent-hover` gray-700) — rebrand here |
| Component classes (partner) | `apps/partner/app/globals.css` (`@layer components`) | `.btn-*`, `.input`, `.label`, `.card`, `.card-add`, `.badge` |
| Shared UI components | `@repo/ui`, `@repo/table-reservations-ui`, `@repo/schematic-editor` | reusable React; no owning agent (orchestrator-handled) |

## Aesthetic

Flat, calm, **bordered-card** UI on white; near-black as the only *functional* accent (the `accent`
token); one warm **sun-amber** decorative note (the monogram) for personality. Tailwind-first,
accessible, no MUI in new work.

## Color (default Tailwind palette)

- **Neutrals:** headings `text-gray-900` · body `text-gray-700`/`-600` · muted `text-gray-500` ·
  faint `text-gray-400`. Surfaces: page `bg-white`, subtle `bg-gray-50`, chip `bg-gray-100`. Borders:
  default `border-gray-200`, inputs `border-gray-300`, hairlines `border-gray-100`.
- **Action / primary = the app's `accent` token** (dark neutral; `bg-accent`/`hover:bg-accent-hover`/
  `focus:ring-accent`). Defined per app in `tailwind.config.js`; rebrand in one place.
- **Status triad** `{ bg-X-50, border-X-200, text-X-600/700 }`: success **green** · error **red** ·
  warning **amber** · info/in-progress **blue**.

## Typography (live in xs / sm / lg)

Page title `text-lg font-semibold text-gray-900` · section heading `text-sm font-medium
text-gray-700` · card title `text-sm font-semibold text-gray-900` · body `text-sm text-gray-600` ·
helper `text-xs text-gray-500` · caption `text-xs text-gray-400`. Avoid `text-base`/`text-md`.

## Spacing & shape

- Container `container mx-auto px-4 py-6 max-w-5xl` (narrow forms `max-w-lg`; tabbed detail pages
  `max-w-[768px]`). Rhythm `mb-6` major · `mb-5` in-form · `mb-2` label→input. Card grid
  `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`. Card padding `p-4` (`p-5`/`p-6` dense/form).
- Radius: cards `rounded-xl` · inputs/controls `rounded-lg` · pills/avatars `rounded-full`. Selected
  emphasis: `border-2` + status tint.

## Components — classes (expansion = the spec) + shared blocks

Class names are canonical; each app defines them in its own `app/globals.css` (`@layer components`),
bound to that app's `accent`. Use the class; the expansion is the reference + one-off fallback.

- **`.btn-primary`** → `bg-accent text-white px-4 py-2 text-sm font-medium rounded-lg transition-colors hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed`
- **`.btn-ghost`** → `text-sm font-medium text-gray-600 transition-colors hover:text-gray-900`
- **`.btn-danger`** → `bg-red-600 text-white px-4 py-2 text-sm font-medium rounded-lg transition-colors hover:bg-red-700` (or ghost `text-red-600 hover:text-red-700` in a "danger zone")
- **`.input`** → `w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent` · **`.label`** → `block text-xs font-medium text-gray-700 mb-1.5`
- **`.card`** → `bg-white rounded-xl border border-gray-200 p-4` (settings cards `p-5 shadow-sm`) · **`.card-add`** → same + `border-2 border-dashed border-gray-300 hover:border-gray-400 hover:bg-gray-50`
- **`.badge`** + status color → `inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full`, then `bg-X-50 text-X-700`

Shared, not class-ified (in `@repo/*`, usable by any app):
- **`Toggle`** — accessible Tailwind switch (`role="switch"`, near-black track on), `@repo/table-reservations-ui`. Use instead of MUI `Switch`. Row: label/helper left, toggle right.
- **Segmented control** (≤5 options, e.g. price `$`–`$$$$`): `inline-flex rounded-lg border border-gray-300 bg-white p-0.5`; each `rounded-md px-3 py-1.5 text-sm font-medium`, active `bg-gray-900 text-white`, inactive `text-gray-500 hover:bg-gray-100` (`aria-pressed`). Prefer over `<select>`.
- **`SaveStatusBanner`** — `@repo/schematic-editor`, full-width save indicator for header-less pages (idle/saving/saved/error → gray/blue/green/red, `role="status"`). Header'd pages use a compact inline indicator instead.
- **Sub-nav tabs:** `flex gap-1 border-b border-gray-200 bg-white px-2`; active `border-b-2 border-gray-900 -mb-px text-gray-900 font-medium`, inactive `text-gray-500 hover:text-gray-700`.
- **Icons:** `w-4 h-4` inline · `w-5 h-5` buttons/headers · `w-6 h-6` feature/empty-state.

> **Shared-package rule:** `@repo/*` components can't see an app's `.classes`/`accent` — they style
> with raw utilities (`bg-gray-900`, not `bg-accent`), aligned by hand. New utilities only generate
> if the package's glob is in the **consuming app's** `tailwind.config.js` `content`.

## Page structure patterns

1. **List / index** — container → header row (title + count + primary action) → optional stats grid
   → responsive card grid with a dashed "add" card last.
2. **Detail / settings** — sub-nav tabs (if sub-pages) → **identity header** → **grouped cards** →
   destructive "danger zone" last. Group + pair fields; don't stack full-width.
   - **Identity header** — `flex items-center justify-between … rounded-xl border border-gray-200
     bg-white p-4 shadow-sm`: left = **monogram avatar** (`h-12 w-12 rounded-xl`, soft sun-amber
     `bg-gradient-to-br from-amber-100 to-orange-100 text-amber-700` — the one warm decorative
     accent) + title + muted **chips**; right = **compact inline save status** (dot + label,
     `role="status"`). Replaces the full-width banner on header'd pages.
   - **Grouped cards** — each section a `rounded-xl border border-gray-200 bg-white p-5 shadow-sm`
     card, `text-sm font-medium text-gray-700 mb-3` heading; stack `space-y-4`; pair short fields
     via `grid grid-cols-1 sm:grid-cols-2 gap-3`.
3. **Create form** — narrow (`max-w-lg`) → title → fields → error block (`rounded-lg bg-red-50
   border border-red-200 px-4 py-3`) → action row (primary submit + ghost cancel).
4. **Empty state** — centered `py-16 text-center` → icon → title (`text-sm font-semibold`) → muted
   description → primary CTA.

## Reference implementation

The restaurant **General** tab is canonical — **mirror it**: `apps/partner/app/restaurants/[id]/view.tsx`
(+ `RestaurantHeader`) and `RestaurantSettingsForm`/`RestaurantHoursEditor`/`Toggle` in
`packages/table-reservations-ui/src/partner/`. All four restaurant detail tabs share `RestaurantHeader`.

## Invariants

1. **Tailwind-first; no new MUI.** Keep MUI dialogs/selects/date-pickers until an accessible Tailwind
   replacement exists (toggles done → `Toggle`).
2. **One accent token** per app; rebrand in one place; don't hardcode the neutral for a primary action.
3. **Shared-package components use raw utilities** (no `accent`/`.btn-*`), aligned by hand.
4. **Tailwind must scan shared packages** (consuming app's `content` globs) or their unique classes purge.
5. **Success = green**, not emerald.

## Common pitfalls

- A new utility in a shared component renders unstyled — package not in the app's Tailwind `content`,
  or you used `accent`/`.btn-primary` (which the package can't see).
- MUI renders unthemed (no `ThemeProvider`) — defaults fight the flat look; migrate, don't theme.
- **Designing blind** — no screenshot/preview loop wired up; visually verify on the running app before
  declaring a UI change done.

## Resolved conventions

Success → green (not emerald) · inputs → Tailwind `.input` (not MUI `TextField`) · save banner → the
shared `SaveStatusBanner` · icon sizes → 4/5/6 · section spacing → Tailwind `mb-5`/`mb-6` (retire MUI `<Divider sx>`).

## Cross-refs

[[subsystem:schematic-editor]] — the other shared UI capability (grid geometry + editor chrome);
composes the same Tailwind conventions.
