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
- **Seat map art (geo map + schematic):** sunbeds and parasols are vector, drawn by
  `@repo/schematic` `BedGlyphSvg` / `ParasolGlyph`; the rules (size per zoom, level of detail, state
  encoding, parasol offset) are the pure `packages/schematic/src/bed-glyph.ts`. The art is authored in
  decimetres on the real 0.84 × 2.1 m footprint, so it fills its box exactly and stays centred at every
  zoom — never size bed art with `next/image`, tile margins or per-zoom ratios again. State lives on the
  bed: green ring = free, blue lounger + check = selected, red ring + red towel on a dimmed bed =
  reserved (the towel means reserved only). Below `BED_MICRO_MAX_PX` (20 px of bed length, ≈ zoom 20.5)
  a bed is a pill (hollow green / solid blue / solid red) and the parasol fades to a faint canopy + hub;
  a selected pill also gets a continuous blue whirlpool — two dashed stadium rings whose dashes stream
  around it in opposite directions over a breathing glow (`animation: 'whirl' | 'whirlReverse' | 'glow'`,
  keyframes in `<BedArtDefs/>`; dashes stand still under reduced motion; the static canvas painter skips it).
  Geo markers keep the partner footprint (`bedMarkerBox`, width = length / 2.5) and the default
  bottom-centre anchor, so beds land where the operator placed them; parasols are their own
  click-through markers at the midpoint of a SunbedGroup's beds. Mount `<BedArtDefs/>` once per page
  (shared gradients). The per-seat QR page (`pos/[itemId]`) still uses the PNGs. The marketing site
  paints the same art on canvas (`paintBed`/`paintParasol`, `@repo/schematic/art`) — change the look in
  `bed-art.ts` and both surfaces follow.
- **Reservation view (`app/reservations/[id]/` + `components/reservation/confirmation/view.tsx`):** one
  cream page under both swipe pages (ticket + menu). Dark tone is `brand-ink` (`#17323a`, the landing's
  sea-pine; `brand-ink-hover`), accents `brand-gold`; muted text is `brand-ink/70` (≥4.5:1 on white —
  gray-400/500 fail on cream). The ticket: gold small-caps eyebrow, venue name in Fraunces, status as a
  green/blue/amber/red pill, details in a 2-col `dl`, hairlines `brand-ink/[0.06–0.15]`. The page's one
  dark CTA is the ink "Food & Drinks" bar; on the menu the Order button is, so "Back to reservation" is a
  quiet cream bar. Menu cards are white with `ring-brand-ink/[0.07]`, no shadow; photo-less products get
  a drawn plate/glass placeholder; counts are Tailwind bubbles, not MUI `Badge`.
- **MUI + Tailwind coexist** (per the stack); migrate off MUI opportunistically, same stance as partner.
- Shared building blocks usable here: `Toggle` (`@repo/table-reservations-ui`), `SaveStatusBanner`
  (`@repo/schematic-editor`); consumer table-booking components live in
  `@repo/table-reservations-ui/src/consumer/`.
