---
id: 002-table-reservations
title: Table Reservations
status: active
created: 2026-05-21
updated: 2026-05-21
worktree: null
---

## Goal

**Business case.** Beach entrepreneurs (e.g. a chiringuito operator) frequently run a
restaurant as part of the *same business unit* as their sunbed/beach operation. Managing both
in one system should feel **effortless and seamless** — one account, one site, one login — yet
sunbed reservations and table reservations are **genuinely separate processes**. The
integration must hold both truths at once: unify what's shared (the business entity, account,
billing, site identity) while keeping the two processes **cleanly separated** — their own
navigation, reservation lists, and operational flows — so neither clutters or bleeds into the
other. "Seamless to manage together, but never mixed up."

A **restaurant table-reservation product** layered onto Sunbnb venues: a partner enables a
restaurant on a site, lays out tables on a schematic floor-plan editor, manages a menu and
opening hours, and works the day's bookings (seat / depart / no-show / cancel); a consumer
discovers the restaurant, picks a date + party size, sees real availability slots, and books
a table — anonymously or signed in. Built deliberately as **standalone-extractable** packages
(`@repo/table-reservations-core` / `-ui`, zero Sunbnb coupling) so the same engine can power a
future cross-product standalone app (working brand **"tablefind.app"**, eventually served from
its own domain); `Site.restaurantId` is a soft FK (no Prisma relation on the `Site` side)
precisely to keep that extraction path clean.

**Approach (decided 2026-05-21).** Two postures held at once:
- **Shared engine, decoupled.** Push as much as possible into the reusable
  `@repo/table-reservations-core` / `-ui` packages — domain logic, availability, the schematic
  editor, booking/menu UI — Sunbnb-agnostic, so the same artifacts power the standalone
  tablefind.app later.
- **Sunbnb-tight integration in the apps.** Inside `apps/*`, wire the feature *deeply* into
  Sunbnb's existing business process and UI — payments/invoicing/settlement/fee-cascade, admin
  oversight, site navigation, account/branding — rather than running it as a bolt-on. The
  Sunbnb-specific wiring lives in the apps, **never** in the shared packages.
- **Unified unit, separated processes** (the integration north star). Share the business
  substrate — PartnerAccount, Site, billing, branding, auth — so a chiringuito owner manages
  beach + restaurant as one business. But keep the two processes on separate rails: distinct
  navigation, distinct reservation/operational views, distinct day-to-day flows. When a design
  choice forces a trade-off, favor *clarity through separation* over collapsing sunbed and
  table concepts into one shared screen/list/model.

The standalone app is a confirmed eventual direction but **deferred**; near-term focus is the
Sunbnb integration. End state for *this* track: feature-complete and tightly integrated into
Sunbnb, documented in the wiki, with the payment/accounting and admin-oversight questions
resolved.

## Resume here

- **Next action:** First **verify the just-shipped restructure in a browser** (start the partner
  app on :3001 — note: kill any running instance first, see [[kill-app-before-dev]] — and click
  through: `/restaurants` list, create both ways, the Site→Restaurant cross-link, and the four
  restaurant sub-tabs). Then pick the next gap. The product-weight decision is **payment/
  accounting** (still gated on the open decision below); the lowest-risk default is the **wiki
  documentation** phase (now more valuable since the IA changed — document the new `/restaurants`
  section + the entity/subsystem pages).
- **Context needed:**
  - **Restructure outcome** (done 2026-05-21): restaurant management now lives at top-level
    `app/restaurants/*` (list, `[id]` settings, `[id]/{tables,menu,reservations}`, `create`),
    gated by `app/restaurants/layout.tsx`. Ownership pivoted to `requireRestaurantOwner` /
    `requireRestaurantOwnerWithFlag` in `lib/auth-helpers.ts`. `createRestaurant({ siteId?, name? })`
    in `app/restaurants/[id]/actions.ts` backs both creation entry points. Nav item in
    `app/header.tsx`; `Header.restaurants` in `messages/{en,es,fi}.json`. Cross-link card in
    `app/sites/site-view.tsx`. Old `app/sites/[id]/restaurant/*` deleted → thin redirect stub at
    `app/sites/[id]/restaurant/page.tsx`. Tests at `app/restaurants/[id]/**/actions.test.ts`
    (Prisma mock gained `restaurant`). Partner suite 278 pass; tsc + lint clean; **not committed**.
  - Core engine: `packages/table-reservations-core/` — `restaurant/`, `tables/`,
    `reservations/` (`createTableReservation` re-checks availability inside the txn — keep that
    invariant), `availability.ts` (`getRestaurantAvailability(date, partySize)`), `menu/`,
    `hours/`, `layout/`, `emails.ts`, `status.ts`. UI: `packages/table-reservations-ui/`
    (`TableLayoutEditor`, `MenuEditor`, `AvailabilityPicker`, `BookingForm`) on
    `@repo/schematic` + `@repo/schematic-editor`.
  - User surface (unaffected by the restructure): `apps/user/app/sites/[id]/table/` (`view.tsx`,
    `actions.ts` → `bookTableForSite` / `cancelTableBooking`),
    `apps/user/app/table-reservations/[id]/`, availability API
    `apps/user/app/api/restaurants/[id]/availability/route.ts` (rate-limited 30/min/IP). Anon
    flow uses `sunbnb-anonId` localStorage, mirroring the sunbed POS pattern.
  - Schema: `packages/data/prisma/schema.prisma` models `Restaurant` (PartnerAccount-owned via
    required `partnerAccountId`; **optional** `siteId` soft link — schema.prisma:632-635),
    `Table`, `TableReservation`, `MenuItem`, `RestaurantHours`, `LayoutElement`. Migrations
    committed: `20260421132654_restaurant_add_tables_feature`,
    `..._restaurant_table_extended_fields`, `20260505100000_restaurant_table_booking_rules`,
    `..._restaurant_table_seat_layout`.
  - `TableReservation` has **no** payment fields (no `paymentRef`/`paymentAmount`) — bookings
    are free today. This is the central open question for the *payment* phase, not an oversight.
  - Core engine: `packages/table-reservations-core/` — `restaurant/`, `tables/`,
    `reservations/` (`createTableReservation` re-checks availability inside the txn — keep that
    invariant), `availability.ts` (`getRestaurantAvailability(date, partySize)`), `menu/`,
    `hours/`, `layout/`, `emails.ts`, `status.ts`. UI: `packages/table-reservations-ui/`
    (`TableLayoutEditor`, `MenuEditor`, `AvailabilityPicker`, `BookingForm`) on
    `@repo/schematic` + `@repo/schematic-editor`.
  - Partner surface: `apps/partner/app/sites/[id]/restaurant/{,tables,reservations,menu}/`
    (`view.tsx` + `actions.ts` each), `RestaurantSubNav.tsx`; tab gated in
    `apps/partner/app/sites/site-view.tsx` by the `restaurants` feature flag +
    `requireSiteOwnerWithFlag('restaurants')`.
  - User surface: `apps/user/app/sites/[id]/table/` (`view.tsx`, `actions.ts` →
    `bookTableForSite` / `cancelTableBooking`), `apps/user/app/table-reservations/[id]/`,
    availability API `apps/user/app/api/restaurants/[id]/availability/route.ts` (rate-limited
    30/min/IP). Anon flow uses `sunbnb-anonId` localStorage, mirroring the sunbed POS pattern.
  - Schema: `packages/data/prisma/schema.prisma` models `Restaurant`, `Table`,
    `TableReservation`, `MenuItem`, `RestaurantHours`, `LayoutElement`. Migrations committed:
    `20260421132654_restaurant_add_tables_feature`, `..._restaurant_table_extended_fields`,
    `20260505100000_restaurant_table_booking_rules`, `..._restaurant_table_seat_layout`.
  - `TableReservation` has **no** payment fields (no `paymentRef`/`paymentAmount`) — bookings
    are free today. This is the central open question, not an oversight.
- **Blocked by:** —

## Roadmap

- ✅ **Data layer.** `Restaurant` / `Table` (schematic X/Y, shape, rotation, per-side seat
  counts, booking rules) / `TableReservation` (payment + operational status split) / `MenuItem`
  / `RestaurantHours` / `LayoutElement`; 4 migrations committed; `Site.restaurantId` soft FK;
  standalone-extraction posture preserved.
- ✅ **Core + UI packages.** `@repo/table-reservations-core` (queries/actions/availability/
  emails/status, Sunbnb-decoupled) and `@repo/table-reservations-ui` (editor, menu, booking
  components) on the shared `@repo/schematic` + `@repo/schematic-editor` geometry/chrome layer.
- ✅ **Partner surface.** Enable + settings + hours; schematic table editor (drag/place,
  canvas dimensions, element palette: dining/bar/kitchen/terrace/lounge/…); day reservations
  with seat/depart/no-show/cancel ops; menu CRUD. Ownership + `restaurants` flag enforced.
- ✅ **User surface.** Booking flow (date → party size → slot → guest form → confirm);
  availability API (rate-limited); anon + signed-in support; confirmation + cancellation
  emails; reservation detail page with cancel.
- ✅ **Restructure: top-level Restaurants section** (partner app; 2026-05-21). Move
  restaurant management out of `/sites/[id]/restaurant/*` into a first-class **`/restaurants`**
  section beside Sites — matching the data model (`Restaurant` is PartnerAccount-owned with an
  *optional* `siteId`) and the standalone-app IA, so the section is cleanly extractable. **No
  schema change.** Steps:
  1. **Auth pivot (do first).** Add `requireRestaurantOwner(restaurantId)` to
     `lib/auth-helpers.ts` — checks `restaurant.partnerAccountId === session.user.id`, sudo
     bypass, mirrors `requireSiteOwner`. Everything below depends on it.
  2. **Rescope queries/actions to `restaurantId`.** `queries.ts`: `getLinkedRestaurant`/
     `Layout`/`Menu(siteId)` → `getRestaurant`/`Layout`/`Menu(restaurantId)` (drop the
     `site.restaurantId` indirection; same core calls). Settings/tables/menu/reservations
     actions: swap the `siteId` ownership param for `restaurantId`; fix `revalidatePath`
     targets. Split `enableTableReservations` into `createRestaurant({ siteId? })` callable from
     both `/restaurants/create` and the site cross-link.
  3. **Move routes** `app/sites/[id]/restaurant/{,tables,menu,reservations}/` →
     `app/restaurants/[id]/{,tables,menu,reservations}/`; rewrite `RestaurantSubNav` hrefs to
     `/restaurants/${id}/...`; move the flag-gate `layout.tsx`. Add **`/restaurants`** list
     (partner's restaurants: name, linked site, table count, today's reservations; empty state
     + Create CTA) and optionally **`/restaurants/create`**.
  4. **Nav + i18n.** Add a `restaurants` item to `app/header.tsx:33-39` (after Sites);
     `Header.restaurants` key in `messages/{en,es,fi}.json`; reuse existing `Restaurant.*`
     subnav keys + new list-page keys. Add **both** creation entry points: a "Create restaurant"
     button on the `/restaurants` list → `/restaurants/create` (optional site-link picker), and
     the site-linked CTA in step 5.
  5. **Cross-link (preserve "seamless").** Replace the inline restaurant tab in `site-view.tsx`
     with a Restaurant card: `site.restaurantId` set → "Manage restaurant →"
     `/restaurants/[restaurantId]`; unset → "Add a restaurant" CTA → `createRestaurant({siteId})`
     then route in. On the restaurant settings page, show/jump to the linked Site if `siteId` set.
  6. **Tests + cleanup.** Move the `actions.test.ts` files; swap auth mocks
     `requireSiteOwner`→`requireRestaurantOwner`; update `RestaurantSubNav` href expectations.
     Add a redirect from old `/sites/[id]/restaurant*` (look up `site.restaurantId`) for safety.
     Run typecheck + lint + partner tests; verify both nav paths in the browser.
  Keep all Sunbnb-specific wiring (PartnerAccount ownership, the Site cross-link, future
  payment/settlement) in the app layer — `table-reservations-*` stays untouched.
  _Done 2026-05-21: all 6 steps shipped. Old `app/sites/[id]/restaurant/*` tree deleted (replaced
  by a thin redirect stub at `app/sites/[id]/restaurant/page.tsx` → `/restaurants/[restaurantId]`).
  Tests ported to `app/restaurants/[id]/**/actions.test.ts`; partner suite 278 pass / tsc + lint
  clean. Browser verification still pending. Delegated across partner-dev chunks (agents cap at
  maxTurns:30, so the work was driven in tight sub-tasks)._
- ☐ **Payment & accounting (decide before its own work).** Currently free/unpaid. Decide whether table
  reservations take money (deposit / no-show fee / nothing). Per the Approach, *if* they do,
  reuse Sunbnb's existing invoice + settlement + fee-cascade core in `@repo/data` (the
  Sunbnb-specific wiring stays in the apps, not the shared packages) rather than building a
  parallel money path. No code until the decision lands (see Open decisions).
- ☐ **Admin oversight.** Today only a `restaurants` feature flag exists in admin. Fold
  restaurant/reservation visibility (and analytics if warranted) into `apps/admin`'s existing
  settlement/accounting surfaces, consistent with the Sunbnb-tight posture.
- ☐ **Multi-timezone availability.** `getRestaurantAvailability` interprets the date as
  midnight in the *server's* TZ (flagged post-MVP). Resolve to the restaurant's local TZ before
  multi-region launch.
- ☐ **Wiki documentation.** No `entity:table-reservation` or `subsystem:table-reservations`
  page yet; the `subsystem:schematic-editor` page is still **draft**. Document the engine,
  flows, and the standalone-extraction design.
- ☐ **Reservation depth & live floor** — the table editor's product roadmap, from the 2026-05-22
  deep domain research (OpenTable / SevenRooms / Resy / Tock / Square / TouchBistro / eat-app /
  Simple Host / Resos). **Strategic reframe:** in every serious product the floor plan is *two apps
  in one* — a design-time editor (we have this) **and** the live run-time host-stand view. The
  editor is the operational nucleus: design → availability → live service → analytics. Today we
  have only the design half + visual-only Areas. Prioritized for the chiringuito/Sunbnb fit:
  1. **Live floor / service view.** The canvas becomes the host view: color-coded statuses
     (available / booked / seated / eating / dessert / check / clearing / overdue), tap-a-table to
     seat a reservation or walk-in, drag to move/transfer parties, server sections. Highest leverage;
     reuses the `@repo/schematic` renderer; the Reservations tab (a list today) folds in.
  2. **No-show protection.** Deposits / card-hold / cancellation fees on bookings — the clearest
     revenue lever for a high-demand beach venue. **Gated on + drives the payment-model open decision
     below**: if table reservations take money, reuse the `@repo/data` invoice / settlement /
     fee-cascade rather than a parallel money path.
  3. **Smart availability.** Table **attributes** (type booth/high-top/bar/communal · ADA-accessible ·
     by-window · combinable · server section); make the editor **Areas real bookable sections**
     (indoor/outdoor) so guests can prefer/book a section; **party-size↔table matching**, **pacing**
     (parties per time window), **shift-based** plans, and **table combinations** (auto-merge for
     large parties). Touches the schema + `getRestaurantAvailability`.
  4. **Waitlist.** Auto-notify (SMS) when a table frees; fills cancellations.
  5. **CRM-lite.** Guest profiles, visit history, preferences/tags/notes (SevenRooms' moat, scaled down).
  _Skip for now — enterprise / over-scope for the chiringuito case (revisit if the standalone
  tablefind.app targets fine-dining): AI seating optimization, deep CRM/marketing, multi-location
  floor-plan standardization, ticketed experiences/events, private-dining "hall" booking._
- 💤 **Standalone "tablefind.app" extraction (confirmed, deferred).** The long-horizon payoff:
  spin the `table-reservations-*` packages into a standalone consumer app on its own domain.
  Direction is decided; timing is post-Sunbnb-integration. Every shared-package change should
  preserve this path — keep Sunbnb coupling out of `table-reservations-*`.

## Log

- **2026-05-21** — Track created, capturing the already-built feature (data layer + core/UI
  packages + partner + user surfaces, all committed on `main`). Verified state via codebase
  survey, not a fresh start.
- **2026-05-21** — Direction set by founder: dual posture — (1) keep
  `@repo/table-reservations-core` / `-ui` Sunbnb-decoupled and maximally shareable for an
  eventual standalone **tablefind.app** on its own domain, (2) in the Sunbnb apps integrate the
  feature *tightly* into Sunbnb's business process + UI (payments/settlement/admin/nav),
  Sunbnb-specific wiring living in the apps not the shared packages. Standalone app confirmed as
  a direction but deferred; near-term focus is the Sunbnb integration. Resolved the prior
  tablefind go/no-go open decision.
- **2026-05-21** — Business case + integration north star recorded: chiringuito operators run a
  restaurant within the *same business unit* as the beach/sunbed operation, so management must
  feel seamless (shared account/site/billing) while the two remain *separate processes* (own
  nav, lists, flows) to avoid clutter and mix-ups. "Seamless to manage together, but never mixed
  up" — favor clarity through separation when a design choice forces the trade-off.
- **2026-05-21** — IA decision: promote restaurant management to a **top-level `/restaurants`
  section** in the partner app (beside Sites), out of `/sites/[id]/restaurant/*`. Rationale: the
  data model already makes `Restaurant` PartnerAccount-owned with an optional `siteId`, so the
  current site-nesting is artificially narrow; a top-level section matches the data shape *and*
  the standalone-app IA (cleaner extraction) *and* the separated-processes principle. Verified
  it's a no-schema-change, partner-app-only restructure whose crux is an auth pivot
  (`requireSiteOwner(siteId)` → new `requireRestaurantOwner(restaurantId)`); the core queries are
  already restaurant-keyed. Full step list captured as the now-active ▶ Roadmap phase. Cross-link
  Site↔Restaurant must be preserved so the "manage both in one place" promise holds.
- **2026-05-21** — Restructure **shipped** (all 6 steps). Restaurant management moved to top-level
  `app/restaurants/*`; ownership pivoted site-owner → `requireRestaurantOwner`; both creation
  entry points live (site-linked + standalone, one `createRestaurant({siteId?})` action); nav +
  i18n + Site↔Restaurant cross-link added; old tree deleted with a redirect stub; tests ported
  (partner suite **278 pass**, tsc + lint clean). Not committed; browser verification pending.
  Process note: dev agents cap at `maxTurns:30` and stop mid-task without a final report, so this
  was driven in ~4 tight partner-dev sub-tasks with the orchestrator re-inventorying the tree
  between each. Also fixed the root cause of spurious dev-server `PageNotFoundError`s — a running
  HMR server colliding with the agents' file churn — by adding a "kill the local app before
  editing" rule to all three dev-agent definitions ([[kill-app-before-dev]]).
- **2026-05-22** — Partner restaurant **UI design language** established + codified in
  `.claude/rules/ui.md` (flat bordered-card aesthetic, near-black `accent` token, one warm
  sun-amber decorative monogram, Tailwind-first/no-MUI, identity header + grouped cards, new
  accessible `Toggle`, segmented control). Built it on the **General** tab (now the canonical
  reference). **Rollout Phase 1 done:** extracted a shared `RestaurantHeader` (monogram + chips +
  inline save status) and applied it to all four detail tabs (General/Tables/Menu/Reservations) —
  Tables' full-width `SaveStatusBanner` replaced by the header's inline status. tsc clean, all
  four routes compile, browser-verification pending. **Phase 2 queued** (shared-component MUI
  cleanup in `@repo/table-reservations-ui`): `MenuEditor`/`TableLayoutEditor` buttons → `.btn-primary`;
  `MenuItemRow` `Switch` → `Toggle`; `ReservationList` `ToggleButtonGroup` → segmented control + the
  date as a Tailwind input; `ReservationRow` MUI buttons/menu → Tailwind. **Keep MUI for the
  dialogs** (`MenuItemDialog`, `TableGridDialog`) per the guide's complex-widget rule. `TableForm`
  (large MUI form) is its own follow-up packet.
- **2026-05-22** — Design language **codified** (`.claude/rules/ui.md` lean rule → full conventions
  in `subsystem:design-system` → per-app `apps/<app>/UI.md`; `/ui <surface>` capability; wired into
  the dev agents). General tab polished into the canonical reference (identity header + grouped
  cards + segmented price control + Tailwind `Toggle` + sun-amber monogram); shared `RestaurantHeader`
  on all tabs. **Tables tab** integrated into one editor card (unified toolbar: Add table + canvas
  dimensions) and the **table-grid feature removed** end-to-end (UI/action/test/dialog/export; core
  `createTableGrid` left as dead-but-harmless engine code). **Element palette reworked** from the
  research: "Surfaces" became **Areas** (dining/terrace/bar/lounge/private/kitchen), arbitrary
  "Objects" became **Fixtures** differentiated by shape (entrance/bar-counter/host-stand/restroom/
  wall/pillar/plant); no schema change. **Web research** (OpenTable/SevenRooms/Resy/Toast/RoomSketcher)
  drove the new "Table-editor reservation depth" roadmap item (table attributes, section availability,
  table combinations). MUI removal advanced (Switch to Toggle, dimensions inputs, table-editor toolbar).
- **2026-05-22** — Deeper domain research (OpenTable/SevenRooms/Resy/Tock/Square/TouchBistro/eat-app/
  Simple Host/Resos) folded into the roadmap as **"Reservation depth & live floor"**, replacing the
  narrower "Table-editor reservation depth" item. Category-defining insight: the floor plan is *two
  apps in one* — design-time editor (done) + live run-time host-stand view (missing). Prioritized for
  the chiringuito fit: (1) live floor/service view [reuses `@repo/schematic`; the Reservations list
  folds in], (2) no-show deposits [drives the payment-model decision], (3) smart availability
  [attributes + real bookable sections + party↔table matching + pacing + combinations], (4) waitlist
  + SMS, (5) CRM-lite. Explicitly de-scoped: AI seating, deep CRM, multi-location, ticketed events,
  hall booking. Still planning only — no build started.

## Open decisions

- **Payment model.** Free reservations, or deposit / card-hold / no-show fee? This drives
  whether table reservations join the invoice + settlement + service-fee cascade (and whether
  Stripe/Mollie are wired in) — currently they are entirely outside it. Highest-leverage and
  most product-weighted of the open items.
- **Admin scope.** Read-only oversight vs. full management (and how much reservations feed the
  existing settlement/accounting views — the Approach favors folding in rather than a new silo).
_(Resolved 2026-05-21: (1) tablefind.app standalone app is a **go**, deferred until after Sunbnb
integration — moved to the Roadmap backlog. (2) Restaurant management moves to a top-level
`/restaurants` section — now the active ▶ Roadmap phase. (3) Ship **both** creation entry points
— site-linked create from a Site page *and* standalone create from `/restaurants/create` — both
backed by one `createRestaurant({ siteId? })` action; the difference is only which UI surfaces it
and whether `siteId` is supplied.)_

## Links

- Shared editor layer: [[subsystem:schematic-editor]] (draft) — same geometry/chrome as the
  sunbed inventory editor.
- Domain entities to create: `[[entity:table-reservation]]`, `[[entity:restaurant]]` (none yet;
  cf. existing `[[entity:reservation]]`, `[[entity:order]]`, `[[entity:rental-booking]]`).
- Sibling: [[track:001-knowledge-store]] (infrastructure, unrelated scope).
