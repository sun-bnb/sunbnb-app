# User App — UI / design system

The **per-app layer** of the repo's design language. General conventions: the lean rule
`.claude/rules/ui.md` (non-negotiables) + the full `.claude/wiki/subsystems/design-system.md`.
Prime UI work with `/ui user` (loads both). This file is *not* auto-loaded — pulled when doing UI work.

Consumer-facing + **mobile-first**, so it diverges from partner:

- **No token layer adopted yet.** The `accent` token and `.btn-*`/`.input`/`.card` classes are
  partner-app-scoped — not defined here. Build net-new user UI on the general patterns with raw
  Tailwind; introduce a token layer (mirror partner's `tailwind.config.js` + `globals.css`) if/when
  a design-system pass lands here.
- **Landing page (`app/view.tsx`) carries its own scoped layer.** It is the one marketing surface
  in the app, so it defines a local palette and a display face inside the page rather than in
  `tailwind.config.js` — nothing else in the app sees them. Ink `#17323a` (sea-pine), straw
  `#7a6029`, sea-deep `#046b7d` for links, over the existing `cream` page; display type is
  **Fraunces** (`next/font/google`, axes `SOFT`/`WONK`/`opsz`) for the headline, section heads and
  stage labels, Geist for everything else. Every muted tone there was picked against `#fff5e1` at
  ≥4.5:1 — the obvious grays (`text-gray-400/500`) fail on cream. Motion lives only in the hero:
  `components/landing/beach-scene.tsx` is a React Three Fiber scene (three.js, landing-route chunk
  only via `next/dynamic`, poster fallback + scroll plumbing in `beach-stage.tsx`) pinned as a
  full-bleed backdrop for ~5.5 screens; scroll progress drives the camera (top-down map → eye level
  → dusk) and the time of day. Copy panels fade with pure-CSS `clamp()` on a `--p` custom property,
  so scrolling never re-renders React. A docked search (`.lp-dock`, `position: fixed`) takes over
  from the hero's search bar for the rest of the page. The page does not use the
  `animate-fade-in-up` / `animate-bubble-up` / `animate-shimmer` helpers in `globals.css`.
  Type-check note: `tsconfig.json` pins `react`/`react-dom` to this app's `@types/react` 18 via
  `.d.ts` path entries, because apps/mobile hoists `@types/react` 19 to the monorepo root and
  hoisted libraries (`@react-three/*`) would otherwise type against it. Next skips `.d.ts` path
  candidates at bundle time, so it is type-checker only.
  Copy rule: the page states only what is shippable or written down in `/cancellation-policy`.
- **Signature surface — the mobile reservation drawer:** fixed bottom panel with peek/expanded
  states whose peek height adapts per tab (`viewMode` in Redux); the booking flow is RTK-state-driven.
  Keep it cohesive — it's the user app's defining UI.
- **MUI + Tailwind coexist** (per the stack); migrate off MUI opportunistically, same stance as partner.
- Shared building blocks usable here: `Toggle` (`@repo/table-reservations-ui`), `SaveStatusBanner`
  (`@repo/schematic-editor`); consumer table-booking components live in
  `@repo/table-reservations-ui/src/consumer/`.
