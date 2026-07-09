---
id: 014-reserve-first-site-view
title: Reserve-first site view (user app)
status: done
created: 2026-07-09
updated: 2026-07-09
worktree: null
---

## Goal

Make the consumer site-detail page (`/sites/[id]`, user app) **reserve-first** instead of
info-first, so a visitor lands ready to book in one tap. On load the mobile reservation
drawer opens expanded (showing the seat map + availability), a date is preselected, and the
first available seat **pair** is preselected — so the primary action is a single tap on
"Reserve". The beach/site info is one tap away (collapse the drawer).

**Deliberately NOT an inline/layout rewrite.** We keep the existing drawer (mobile) and
sticky sidebar (desktop) machinery and only change its *opening posture* + preselection
defaults. This is the low-risk path: it delivers the "open → one tap → reserved" experience
by flipping defaults, and it sidesteps the Google-Maps-inside-a-scroll-container gesture
conflict that a full inline redesign would introduce (the drawer keeps giving the map its
own 300px viewport). Reversible — mostly boolean/default flips.

### Why (design rationale, locked)
- Desktop already IS reserve-first: `view.tsx` renders the panel as an always-visible sticky
  sidebar (`lg:sticky lg:top-[80px]`). The problem is **mobile-only** — there the panel is a
  fixed bottom drawer that defaults *closed* (peeked), so the page opens info-first.
- Inverting the mobile default from info-first to reserve-first is the correct stance for a
  booking app. Info-behind-a-tap is fine.

## Resume here

- **DONE** — user browser-verified the reserve-first flow and it's committed. Nothing to resume.
  If reopened, the natural follow-ups are: recenter the map on the *preselected pair* (today it
  opens at zoom 20 on the inventory centroid, not necessarily on the selected seat), and any of
  the deferred edge polish below.
- **Context (for a future session):**
  - `apps/user/components/reservation/SunbedSelection.tsx` — preselection wired into `useEffect`; map zoom/center.
  - `apps/user/app/sites/[id]/sunbed-preselection.ts` — extracted pure helpers (testable); 12 tests in the sibling `.test.ts`.
  - `apps/user/app/sites/[id]/view.tsx` — drawer auto-open (P0) + scrim on `focused`.

## Roadmap

- ✅ **P0 — Reserve-first opening posture.** `view.tsx` mount effect dispatches
  `{ focused: true, reservationDay: today }` (day only set if not already in Redux).
  Desktop unchanged — effect only changes `focused` (mobile-only drawer state).
- ↩︎ **P1 — No scrim on first load → REVERSED.** Originally shipped (local `manuallyExpanded`
  flag gating the `Backdrop`), then reverted at the user's request after they saw it live:
  the scrim/shadow is wanted on the auto-open too (it frames the reservation panel). Backdrop
  now renders whenever `focused` (the original condition); `manuallyExpanded` removed. **The
  "no scrim on first load" decision is retired.**
- ✅ **P2 — Preselect first available seat pair.** Once availability loads, auto-select the
  first available seat — and if it's paired, the whole pair — into `selectedItems`, so
  "Reserve" is live on open. Pairing is one-directional (primary holds `pair`; secondary
  holds `pairedBy` back-pointer); both directions walked. SunbedGroup supersedes bare
  pairs. Pure helpers extracted to `sunbed-preselection.ts`; 12 unit tests added.
  Also shipped: **single-day default** — `dateRange` fallback changed from
  `today–tomorrow-end` to `today-start–today-end` in both `SunbedSelection.tsx` and
  `Reservation.tsx` (days-mode only).
- ✅ **P3 — Verify.** User browser-verified the reserve-first flow ("Looks good"). Then the
  default map-zoom improvement landed (open at seat-level zoom 20, not fit-to-bounds/parcel).

## Log

- 2026-07-09 — Track created. Design pass done with user. **Rejected** the full inline
  redesign (shorten hero, move selection into the scrolling page) in favour of the smaller
  drawer-default-open intervention: same "open → one tap → reserved" payoff, a fraction of
  the risk, and it avoids the map-in-scroll gesture conflict. **Locked decisions:** keep the
  drawer; open expanded on first load; **no scrim on first load**; preselect date **and** the
  first available **seat pair** (true one-tap). Scope is the mobile default posture +
  preselection (preselection benefits desktop too).
- 2026-07-09 — Resolved Q2 + Q3. **Q2:** "first available pair" = first pair in the
  availability list (deterministic list order). **Q3:** zero availability today → leave the
  seat unselected (no auto-advance of the day).
- 2026-07-09 — P0 + P1 shipped. `view.tsx` mount effect commits `reservationDay` + opens
  drawer (`focused: true`). Local `manuallyExpanded` flag gates the scrim. `useEffect`
  dependency array is intentionally empty (once-per-mount semantics). All 332 unit tests
  pass; tsc + lint clean.
- 2026-07-09 — Single-day default + P2 shipped. Two changes: (1) `dateRange` fallback
  changed from `today→tomorrow-end` to `today-start→today-end` in `SunbedSelection.tsx`
  (line ~289) and `Reservation.tsx` (line ~111) — days-mode only, hours-mode untouched.
  (2) P2: `useEffect` in `SunbedSelectionGeo` now calls `pickFirstAvailablePair()` when
  filteredSelection is empty; pair-resolution pure helpers extracted to
  `app/sites/[id]/sunbed-preselection.ts` so they're unit-testable without Google Maps
  deps. 12 new tests in `sunbed-preselection.test.ts`. 344 total tests pass; tsc + lint
  clean.
- 2026-07-09 — **P1 reversed.** User asked to "restore the shadow on the background" after
  seeing the scrim-free auto-open live. Reverted P1: `Backdrop` now renders on `focused`
  (including the P0 auto-open), `manuallyExpanded` state + pill-handler wiring removed from
  `view.tsx`. tsc + lint clean. The "no scrim on first load" decision is retired.
- 2026-07-09 — **Verified P0–P2 in browser (user).** Then default map zoom improvement:
  `SunbedSelection.tsx` no longer passes `defaultBounds` (fit-to-bounds zoomed out to parcel
  level). Map now opens at fixed `defaultZoom={20}` — the farthest zoom where individual
  seats still render (`zoom > 19`) — centered on the inventory bounding-box center
  (`inventoryCenter`, falls back to site pin when no items). `MapBounds` import removed. tsc
  clean (warnings pre-existing).
- 2026-07-09 — **Track DONE.** All phases shipped + user-verified + committed. Net result:
  `/sites/[id]` on mobile opens drawer-expanded (scrim framing), single-day (today) preselected,
  first available seat pair preselected, map at seat-level zoom → one tap to Reserve. Deferred
  follow-ups (unbuilt, not blockers): recenter map on the preselected pair; broader edge-case
  test coverage. Status → done.

## Open decisions

- **Q1 — First-load scope of `focused: true`.** Only on a genuinely fresh page load, or every
  time the site view mounts? Must not fight the user who deliberately collapsed the drawer and
  is scrolling info. Leaning: auto-open once per mount, cleared as soon as the user interacts.
- ✅ **Q2 — "First available pair" selection rule** → **first pair in the availability list**
  (deterministic, order as availability returns it). Unpaired sunbeds → first available single.
- ✅ **Q3 — Zero availability today** → **leave the seat unselected** (drawer open, date=today,
  no seat; user changes the date). Do NOT auto-advance the preselected day.
- **Q4 — Preselection vs user intent.** Auto-selecting a specific bed commits the user to a
  seat they didn't pick. Acceptable per the goal, but confirm the map clearly shows the
  preselected seat as *selected/changeable*, not *locked*.

## Links

- [[subsystem:schematic-editor]] · [[subsystem:design-system]]
- [[project_pairing_directionality]] — pairs stored one-directionally; walk `pairedBy`.
- [[project_online_offline_reservation_flexibility]] — reservation-flow constraints.
- Siblings: [[track:012-multiday-per-day-operational-state]] (also touches the sunbed
  reservation flow / availability semantics).
