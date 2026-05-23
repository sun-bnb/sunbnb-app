---
id: 002-table-reservations
title: Table Reservations
status: active
created: 2026-05-21
updated: 2026-05-22
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

**Ambition (decided 2026-05-22).** Build this into a *serious competitor* to the incumbents
(SevenRooms / OpenTable / Resy / Tock) — not just an integration MVP. You can't out-feature them
head-on, so win on a **wedge**: a **leisure-venue OS** no incumbent serves — one system running
sunbeds + tables + F&B + rentals for beach clubs, chiringuitos, hotel pools and rooftops (Sunbnb
already owns the sunbed half). Monetize with a **tiered hybrid** — a **per-cover fee** on the Starter tier (shared with Sunbnb's
subscription), dropping to **no per-cover from the first paid tier**, so the anti-OpenTable
*no-cover-fees* stance becomes a paid-tier upsell; all via Sunbnb's existing subscription +
service-fee cascade. Stay
**Sunbnb-integrated first** (real chiringuito users now) with the engine kept extraction-clean,
then spin up the standalone tablefind.app once the competitive core (P1–P3) is proven.

## Resume here

- **Status:** P1 **largely implemented** (through 2026-05-23). 1a–1d **complete** (engine: TZ,
  attributes, sections/pacing/shifts, combinations — with partner UI). 1e: **config complete**
  (restaurant + shift + per-table override) + **collection Piece 1 done** (pending-until-paid hold +
  confirm + cleanup; demo deposit flow works end-to-end). 1f/1g **core complete** (◐). 1h: public
  booking **API** done. **8 migrations** applied **local + Neon test**; **core 49 / partner 279 /
  user 221 / data 109 green**; touched packages typecheck. **Committed** on `main` (6 commits, none
  pushed): `567f987` impl · `32da7de` wiki · `c829971` table deposit override · `15bcfb1` deposit
  Piece 1 (+ the earlier two from prior goals).
- **P1 scope narrowed (founder):** **SMS reminders/notify** + **Google/Instagram Reserve** are **out
  of P1** → later phase (external-bound). What remains *in* P1: **1e collection Piece 2/3** + the
  deferred consumer/partner UIs + the embed widget UI.
- **Next action — 1e collection Piece 2/3 (PAUSED 2026-05-23 by founder; resume as a focused
  session).** Decisions **locked** (see Open decisions): upfront deposit, pending-until-paid, **both
  Stripe + Mollie** (mirror reservation flow / Mollie-for-Platforms), kept deposit flows through the
  **full `@repo/data` invoice + settlement + fee cascade**, **refund on arrival** (seated), keep on
  no-show. **Build plan:** (Piece 2) deposit PaymentIntent (Stripe) + Mollie payment reusing
  `[[subsystem:payments]]`; webhook/poll → `markDepositHeld` (already confirms); a `processChargedDeposit`
  cascade fn in `@repo/data` fired on `chargeNoShowDeposit`; refund on `markSeated`/timely-cancel →
  `releaseDeposit`/`refundDeposit`. (Piece 3) consumer pay-before-confirm UI (the `bookTableForSite` /
  public `/api/restaurants/[id]/book` already return `{ requiresDeposit, depositAmount }` for real mode
  to route on). Spans `@repo/data` (data-dev) + `apps/user` (user-dev) + `apps/partner` (partner-dev).
  Then the deferred UIs + embed widget. **Verification gaps:** (1) browser-verify all new partner
  surfaces (:3001, kill app first — [[kill-app-before-dev]]) — partial (add-table OK);
  (2) `migrate:test` — **done**; (3) `migrate:production` pending (at promote time). Wiki re-ingest for
  1a–1h: **done**
  (`32da7de`). 6 migrations now applied local + test.
- **Context needed:**
  - **Restructure outcome** (done 2026-05-21): restaurant management now lives at top-level
    `app/restaurants/*` (list, `[id]` settings, `[id]/{tables,menu,reservations}`, `create`),
    gated by `app/restaurants/layout.tsx`. Ownership pivoted to `requireRestaurantOwner` /
    `requireRestaurantOwnerWithFlag` in `lib/auth-helpers.ts`. `createRestaurant({ siteId?, name? })`
    in `app/restaurants/[id]/actions.ts` backs both creation entry points. Nav item in
    `app/header.tsx`; `Header.restaurants` in `messages/{en,es,fi}.json`. Cross-link card in
    `app/sites/site-view.tsx`. Old `app/sites/[id]/restaurant/*` deleted → thin redirect stub at
    `app/sites/[id]/restaurant/page.tsx`. Tests at `app/restaurants/[id]/**/actions.test.ts`
    (Prisma mock gained `restaurant`). Shipped, committed + pushed on `main` (2026-05-22).
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
    are free today; P1's no-show work adds the money path via the `@repo/data` cascade.
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

**Competitive build (decided 2026-05-22).** Toward serious-competitor parity + the leisure-venue
wedge. Five product pillars; ship P1–P2 to be *taken seriously*, P3 for *retention*, P4–P5 to
*monetize + scale*. The payment model is resolved (tiered hybrid: per-cover on Starter, no-cover from the first paid
tier; plus consumer no-show deposits via the existing cascade — see Open decisions), so P1's
monetization + no-show work is unblocked.

- ☐ **P1 — Booking core** (table-stakes to be taken seriously). A real availability engine
  (party-size to table-size matching, **sections**, **pacing** per time window, **shift-based**
  plans, **table combinations** for large parties; fix the server-TZ bug in
  `getRestaurantAvailability` first — it reads midnight in the *server's* TZ). Multi-channel intake
  (website widget, Google/Instagram Reserve). Confirmations + reminders (SMS/email), modify/cancel.
  **No-show protection** — deposits / card-hold / cancellation fees, consumer-paid through the
  `@repo/data` invoice + settlement + fee cascade (a separate flow from the platform per-cover fee;
  Sunbnb wiring stays in the apps).
  **Waitlist** with auto-notify. Adds booking-relevant **table attributes** (type
  booth/high-top/bar/communal, ADA-accessible, by-window, combinable, server section).
  _Schema + availability-engine work; the heaviest pillar._

  **P1 · Availability engine — implementation plan (1a–1d)** _(planned 2026-05-22; no code
  yet. Dependency order — 1a unblocks all. Each chunk is a `packages/data` schema change ⇒
  architecture pass + `migrate:local` → integration tests → `migrate:test`. `timeZone` lives on
  `Restaurant`, founder-decided, to keep the engine extraction-clean.)_
  - ✅ **1a — TZ correctness (fix-first, foundational).** _Done 2026-05-22: `Restaurant.timeZone`
    migration `20260522155752_restaurant_timezone`; pure `core/src/tz.ts` (`zonedWallClockToUtc` /
    `getZonedParts` / `civilDayOfWeek` / `parseCivilDate`, Intl-based, no dep); `getRestaurantAvailability`
    + `listReservationsForDay` now build instants in the venue zone; user availability route + partner
    day-view route pass the civil date string; partner General-settings timezone select + i18n (en/es/fi).
    13 new `tz.test.ts` cases + core/partner/user suites green. **Scope note:** per-table `turnTimeMinutes`
    folding was deferred to 1c (engine reworks for shifts/pacing there) to avoid DTO/booking churn now;
    1a stayed pure TZ correctness._ The engine computes every slot in the
    **server process TZ** (UTC on Vercel), so a Spanish venue's "8pm" returns as 22:00 local; the
    bug spans `getRestaurantAvailability` (availability.ts:11-19,153-157), `listReservationsForDay`
    (queries.ts:103-111, same `setHours`), and the API route (route.ts:43,
    `new Date('${dateStr}T00:00:00')`). Add `Restaurant.timeZone String?` (IANA, e.g.
    `"Europe/Madrid"`; nullable with an engine fallback constant; partner sets it in General
    settings). New `core/src/tz.ts` pure helper (`zonedWallClockToUtc`, `zonedDayOfWeek`) via the
    `Intl.DateTimeFormat` offset trick — **no new dependency**, single-correction DST handling.
    Rework `getRestaurantAvailability` to take a venue **civil date** (`YYYY-MM-DD`) and build each
    slot instant in `restaurant.timeZone`; fix `listReservationsForDay`'s day window the same way;
    drop the route's server-local `Date` (pass the civil string through). Fold the currently-ignored
    per-table `turnTimeMinutes` into the per-table meal window (`table.turnTimeMinutes ??
    averageMealDuration`). Migration `…_restaurant_timezone`. Tests: core unit tests for a
    strong-offset, DST-crossing zone (slots land at the right UTC wall-clock; reservation-window day
    math; day-view window); update the route test. **Ships when** availability returns
    venue-correct instants on a UTC server.
  - ✅ **1b — Table attributes (feed matching).** _Done 2026-05-22: migration
    `20260522160544_restaurant_table_attributes` (`Table.combinable` + `Table.features String[]`);
    `ALLOWED_TABLE_FEATURES` set + `validateTableInput` rejection; create/update/duplicate persist them;
    `getRestaurantAvailability` gained optional `sectionPreference` (zone) + `featureRequirements`
    (`features hasEvery`) filters; `TableForm` gained a combinable toggle + feature chips, wired through
    `TableLayoutEditor`'s `toFormValues` + tables view + i18n (en/es/fi). Core/UI tsc clean, 13 partner
    tables tests pass (2 new). Consumer-facing section/feature picker deferred (engine supports it)._
    `Table.combinable Boolean @default(false)` +
    `Table.features String[] @default([])` (validated allowed set: `accessible` / `window` /
    `outdoor` / `high_top` / `communal` / `quiet`; section stays `zone`). No new `tableType` —
    `shape` already carries booth/bar, `features` carries the rest. Extend `TableInput` +
    `validateTableInput`; `getRestaurantAvailability` gains optional `sectionPreference` (zone) +
    `featureRequirements` filters. `TableForm` (MUI; its own migration follow-up) gains a
    `combinable` toggle + a features multi-select. Migration `…_restaurant_table_attributes`. Tests:
    validation + availability filtering. **Ships when** a partner can tag accessible/window/
    combinable + section and availability filters on them.
  - ✅ **1c — Sections · pacing · shifts (the real model).** _Done 2026-05-22: migration
    `20260522161211_restaurant_shifts` (`RestaurantShift` incl. forward `requiresDeposit` /
    `depositMinPartySize` for 1e); pure `core/src/pacing.ts` (+ 3 tests); `shifts/{queries,actions}`
    (`listShiftsForRestaurant` / `setRestaurantShifts` replace-all + validation); engine reworked to
    iterate shift windows (fallback to RestaurantHours) with covers-per-window pacing + last-seating;
    `createTableReservation` re-checks pacing **inside the txn** (`resolvePacingForInstant` →
    `PACING_FULL`); partner `setRestaurantServiceShifts` action + `getRestaurantShifts` query + shared
    `ShiftsEditor` on the General tab + i18n (en/es/fi). Core 36 tests, partner 47 tests, UI tsc clean.
    Per-table `turnTimeMinutes` from 1a's deferral still pending (engine uses restaurant-level duration)._
    New `RestaurantShift { restaurantId,
    name, day, startTime, endTime, pacingCovers Int?, pacingWindowMinutes Int @default(15),
    lastSeatingOffsetMinutes Int? }`. Availability iterates shift windows when shifts exist for the
    day, else falls back to `RestaurantHours` open/close (no break for existing data). **Pacing** =
    drop a slot when the summed `partySize` of reservations *starting* in the same pacing-window
    bucket ≥ `pacingCovers` (covers, not count); the reservations prefetch gains `partySize`. The
    create path (`createTableReservation`) re-checks the pacing cap **inside the txn**, mirroring the
    existing overlap gate (data-access.md: check+create one op). Partner Shifts editor (extend
    `RestaurantHoursEditor`). Migration `…_restaurant_shifts`. Tests: pacing in availability + in
    create (race), shift windows + last-seating, RestaurantHours fallback. **Ships when**
    Lunch/Dinner shifts with a covers-per-window cap are honoured by both availability and booking.
  - ✅ **1d — Table combinations (core; UI deferred).** _Done 2026-05-22: migration
    `20260522162209_restaurant_table_combinations` (`TableCombination` + `TableReservation.bookingGroupId`);
    `combinations/{queries,actions}` (CRUD + member-combinable validation + `createCombinationReservation`
    = N linked rows sharing `bookingGroupId`, in-txn all-member overlap + pacing dedup-by-group);
    `getRestaurantAvailability` surfaces `availableCombinationIds` (offered only when no single table fits;
    pacing covers dedup by group); cancel/seat/depart/no-show made **group-atomic** via `targetGroupWhere`
    + `updateMany`; partner CRUD action wrappers + `getRestaurantCombinations`; user `bookCombinationForSite`;
    route DTO extended. Core 36 / partner 47 / user 5 tests green (partner mock gained `updateMany` +
    `tableCombination`/`restaurantShift`). **Deferred:** partner Combinations editor UI + consumer combo-pick UI._
    Explicit predefined combos (the
    OpenTable/SevenRooms model): `TableCombination { restaurantId, tableIds String[], capacity Int }`
    (members must be `combinable`). Availability evaluates combos when no single eligible table fits
    (or to add options): a combo is free ⇔ **all** members free for the window; the slot DTO grows
    `availableCombinationIds` beside `availableTableIds`. **Booking a combo = N linked
    `TableReservation` rows sharing a new `bookingGroupId String?`** — each blocks its own table via
    the existing per-table overlap mechanism (no new blocking logic), cancel/seat operate on the
    group, pacing counts the party once. Partner Combinations editor (pick 2+ combinable tables →
    named combo + combined capacity). Migration `…_restaurant_table_combinations`. Tests: combo
    offered only when all members free; booking blocks all members; cancel releases all. **Ships
    when** a party larger than any single table can book a predefined combination atomically.

  **P1 · Beyond the engine — booking-core requirements (1e–1h)** _(planned 2026-05-22; no code.
  Completes the P1 pillar past the availability engine. 1e is a `packages/data` payment-core change ⇒
  architecture pass + payments.md/data-access.md rules; the rest are lighter but each ships behind the
  `restaurants` flag. Today the feature is **free** — `TableReservation` has no payment fields and
  `bookTableForSite` (apps/user) just creates + fire-and-forget-emails via `@repo/data/email`.)_
  - ◐ **1e — No-show deposits (core done; provider collection = remaining seam).** _Done 2026-05-22:
    migration `20260522163219_restaurant_no_show_deposits` (`Restaurant.noShowPolicy`/`depositPerGuest`;
    `TableReservation.depositAmount`/`depositStatus`/`paymentRef`); `NO_SHOW_POLICY`/`DEPOSIT_STATUS`
    constants; pure `deposit.ts#computeDepositAmount` (+ 7 tests); `resolveDepositForInstant`
    (policy + covering shift → amount); `createTableReservation` records `depositAmount` + `pending`
    when due; idempotent state transitions `markDepositHeld` / `chargeNoShowDeposit` / `refundDeposit` /
    `releaseDeposit`; partner policy UI (General: none/deposit segmented + per-guest amount; ShiftsEditor:
    requiresDeposit + min-party) + i18n. Core 43 / partner 47 tests green._ **Remaining seam (large,
    app-layer):** actual Stripe/Mollie deposit **collection** (PaymentIntent + capture/refund), the
    `@repo/data` invoice + settlement + fee-cascade generation on charge, and the consumer
    pay-before-confirm UI — reuses `[[subsystem:payments]]`; deposit-bearing bookings currently persist
    as `depositStatus: pending` (not yet collected). Combination bookings don't carry a deposit yet.
    Add the money path through
    the existing `@repo/data` invoice + settlement + service-fee cascade (reuse `loadFeeContext` /
    `resolveServiceFee` / the idempotent `processConfirmed*` pattern; reservations *deduct* fee from
    partner revenue per payments.md). **Schema:** `TableReservation.depositAmount Float?` +
    `paymentRef String?` + `depositStatus String?` (`none|held|charged|refunded|released`);
    `Restaurant.noShowPolicy String @default("none")` (`none|deposit|card_hold|cancellation_fee`) +
    `depositPerGuest Float?`; per-shift `RestaurantShift.requiresDeposit` + `depositMinPartySize`
    (depends on 1c). **Flow:** when the chosen slot/shift requires it, the consumer booking routes
    through Stripe/Mollie ([[subsystem:payments]]) **before** confirming; `markNoShow` captures/charges
    via idempotent invoice creation; seated/departed releases or credits; an in-deadline cancel
    refunds. Distinct from the platform per-cover fee (see Open decisions → Payment model). **Decision
    still open** (P1 detail): deposit vs card-hold vs cancellation-fee mechanic, default amounts, which
    shifts/party-sizes. Tests: deposit-required → pay path; no-show charge idempotent + two-invoice +
    fee-deducted; cancel refund; free path unchanged when policy `none`. **Ships when** an operator can
    require a deposit on a shift and a no-show is charged through the cascade. _Heaviest non-engine
    chunk — payment-core architecture pass._
  - ◐ **1f — Confirmations · reminders · modify/cancel (core done; SMS + deadline deferred).** _Done
    2026-05-22: core `modifyTableReservation` (consumer, ownership) + `modifyReservationAsStaff` sharing
    `reapplyReservation` — re-validates + re-checks availability **and** pacing in-txn excluding self,
    recomputes the deposit; `reminderEmailHtml` template + `listReservationsNeedingReminder(24h)` +
    `markReminderSent`; user cron `app/api/cron/table-reminders` (CRON_SECRET + flag-gated, email);
    user `modifyTableBooking` + partner `modifyRestaurantReservation` / `chargeRestaurantReservationDeposit`.
    Confirmation/cancellation emails already shipped. Core 43 / partner 47 / user 5 green._ **Out of P1
    scope (deferred to a later phase, founder call 2026-05-22):** SMS reminders/notify (needs an SMS
    provider). **Still-P1 deferred:** a configurable cancellation deadline (no field yet), consumer
    modify UI. Combination bookings not modifiable yet.
    Confirmation + cancellation emails already
    exist (`core/emails.ts` templates, sent from `bookTableForSite`/`cancelTableBooking`). **Reminders:**
    wire a user-app daily cron mirroring `/api/cron/send-reminders` (`CRON_SECRET`), using the existing
    `TableReservation.reminderSentAt` field and the venue TZ from 1a; email now, **SMS behind a provider
    decision** (Twilio? — new dep + env, its own call). **Modify:** core `modifyTableReservation`
    (date/time/party/table) that re-runs availability + pacing **inside the txn** (data-access.md), with
    consumer + staff entry points. **Cancellation deadline** tied to the no-show policy (cf. existing
    `Site.noShowDeadlineMinutes` precedent). Tests: reminder-once idempotency + TZ; modify re-checks
    availability; deadline enforcement. **Ships when** guests get reminders and can modify/cancel within
    policy.
  - ◐ **1g — Waitlist with auto-notify (core done; UI deferred).** _Done 2026-05-22: migration
    `20260522164455_restaurant_waitlist` (`TableWaitlistEntry`); `WAITLIST_STATUS` constants;
    `waitlist/{queries,actions}` (`joinWaitlist` + validation, `leaveWaitlist`, `markWaitlistNotified`/
    `Converted`, `removeWaitlistEntryAsStaff`, `findWaitlistMatches`, `findWaitlistCandidateForFreedReservation`
    — venue-TZ date + freed-table capacity); `waitlistNotifyEmailHtml`; user `joinWaitlistForSite` +
    **auto-notify hook in `cancelTableBooking`** (emails the earliest matching guest + marks notified);
    partner `getRestaurantWaitlist`. Core 43 / partner 47 / user 5 green._ **Deferred:** consumer
    "join waitlist" UI (surfaced when no slots), partner waitlist view, auto-notify on staff
    cancel/no-show, SMS notify.
    New `TableWaitlistEntry { restaurantId, date, partySize,
    requestedTime, guest{Name,Email,Phone}, status (waiting|notified|converted|expired), notifiedAt }`.
    When availability returns no slot, offer to join. On any event that frees capacity in the window
    (cancel / no-show / departed / modify-away), auto-notify the earliest matching entry with a short
    hold window (email + SMS once 1f lands). Tests: enqueue when full; notify earliest match on free-up;
    hold-window expiry. **Ships when** a full-night guest can join a waitlist and is auto-notified on an
    opening.
  - ◐ **1h — Multi-channel intake (public booking API done; widget UI + Reserve remain).** _Done
    2026-05-22: public, **CORS-enabled, restaurant-keyed** booking endpoint
    `apps/user/app/api/restaurants/[id]/book` (POST + OPTIONS; flag-gated; rate-limited 10/min/IP; anon;
    handles single-table + combination; server-validated; sends confirmation) — the genuine intake point
    for an embeddable widget and future Reserve. Pairs with the existing public availability API._
    **Remaining:** the embed **widget UI** itself (an iframe/script over these APIs reusing
    `@repo/table-reservations-ui`), and **Google / Instagram Reserve** — a large external integration
    that **needs partner-API credentials + approval** (cannot be built in this environment); sequenced
    last, its own sub-project.
    (a) **Embeddable widget** — package the existing
    `@repo/table-reservations-ui` `BookingForm` / `AvailabilityPicker` as an embeddable widget
    (iframe/script) over a public availability + booking API, so a venue books from its own site; reuses
    the extraction-clean UI package. (b) **Google / Instagram Reserve** — feed availability + accept
    inbound bookings via their partner APIs; large external integration depending on the finished engine
    (1a–1d) + a stable public booking API → sequenced **last** in P1, its own sub-project. **Ships when**
    a venue can take bookings from its own website (widget); Reserve integrations follow.
- ☐ **P2 — Live floor / operations** (category-defining daily driver). The schematic canvas
  *becomes* the live host view: color-coded statuses (available/booked/seated/eating/dessert/
  check/clearing/overdue), tap-a-table to seat a reservation or walk-in, drag to move/transfer,
  server sections, multi-device host-stand sync, turn-time tracking. The Reservations tab (a list
  today) folds into it. Reuses the `@repo/schematic` renderer.
- ☐ **P3 — Guest CRM + marketing** (the retention moat — SevenRooms' real edge, and the reason
  restaurants leave OpenTable). Guest profiles, visit history, preferences/tags/notes (auto-tag
  VIP/allergies); email/SMS campaigns, win-back, review requests; "own your guest data." Loyalty later.
- ☐ **P4 — Monetize demand** (Tock angle). Ticketed experiences / prepaid menus, private and
  whole-venue ("hall") booking, deposits per event.
- ☐ **P5 — Analytics, integrations & scale.** Reporting (covers, turn times, no-shows, section/
  room utilization, revenue, booking source); **POS integration** (spend per table); multi-location
  standardization; public API. **Admin oversight folds in here** — surface restaurant/reservation/
  analytics in `apps/admin`'s existing settlement/accounting surfaces (today only a `restaurants`
  flag exists there).
- ☐ **Wedge layer** (cross-cutting GTM, woven through P1–P5). The unified **leisure-venue OS** —
  one map, one guest: sunbeds + tables + F&B + rentals in a single system for beach clubs /
  chiringuitos / hotel pools / rooftops. No incumbent serves this and Sunbnb owns the sunbed half.
  Plus **fair pricing** — no per-cover from the first paid tier (Starter is per-cover). This is how we *win*, not just match.
- ✅ **Wiki documentation** (2026-05-22). Authored `[[entity:restaurant]]`,
  `[[entity:table-reservation]]`, `[[subsystem:table-reservations]]` (engine + package boundaries +
  standalone-extraction posture + flag gate + roadmap pointer) and `[[flow:table-booking]]` — all
  `stable`, cited against code at HEAD, cataloged in the wiki index + log; `subsystem:schematic-editor`
  got a reverse cross-ref (left `draft` — full sunbed-side verification is out of scope). The wiki
  documents **current truth only** (incl. the free-bookings-today fact + the server-TZ bug); the P1
  plan stays in this track. Re-ingest each page as P1 chunks ship.
- 💤 **Standalone "tablefind.app" extraction** (confirmed; sequenced *after* P1–P3 are proven —
  decided 2026-05-22). Spin the `table-reservations-*` packages into a standalone product on its own
  domain. Keep Sunbnb coupling out of the shared packages so the extraction path stays clean.

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
- **2026-05-22** — Roadmap **re-passed for serious-competitor ambition** (founder directive — make
  this a real rival to SevenRooms/OpenTable/Resy/Tock, not an integration MVP). Reframed the deferred
  reservation work into a five-pillar **competitive product roadmap**: P1 booking core · P2 live
  floor/ops · P3 guest CRM + marketing · P4 monetize demand · P5 analytics/integrations/scale, plus a
  cross-cutting **wedge layer**. Three strategic decisions locked: **wedge = leisure-venue OS**
  (sunbeds + tables + F&B + rentals in one system — uncontested by incumbents; Sunbnb owns the sunbed
  half); **pricing = flat subscription** (no per-cover, anti-OpenTable), via Sunbnb's subscription +
  fee cascade; **sequencing = Sunbnb-integrated first**, standalone tablefind.app after P1–P3 prove
  the core. The previously de-scoped features (CRM, experiences, multi-location, etc.) are now *in*
  the roadmap, sequenced later. Payment-model open decision resolved by the pricing call. Also
  refreshed the stale Resume-here and removed a duplicated/pre-restructure context block. Planning
  only — no build started.
- **2026-05-22** — Pricing **refined** (founder call): the flat-subscription model becomes a **tiered
  hybrid** — a **per-cover fee on the Starter tier** (shared with Sunbnb's subscription) and **no
  per-cover from the first paid tier** (PRO/BUSINESS), so escaping cover fees is a paid-tier upsell.
  The per-cover fee rides the existing service-fee cascade; the consumer-side no-show deposit stays a
  separate money flow. Updated the Goal/Ambition, Open-decisions, and roadmap framing to match.
- **2026-05-22** — **P1 availability engine planned to executable depth (1a–1d); no code.** Founder
  picked "plan full engine, build nothing" + **`timeZone` on `Restaurant`** (IANA column,
  partner-set, engine fallback) over deriving from Site/country — keeps the engine extraction-clean.
  Decomposed the heaviest P1 pillar into four dependency-ordered chunks: **1a** TZ correctness
  (fix-first), **1b** table attributes, **1c** sections/pacing/shifts, **1d** table combinations —
  each a `packages/data` schema change (architecture pass). Grounded in a code read: confirmed the
  server-TZ bug spans `getRestaurantAvailability` (availability.ts:11-19,153-157) **and**
  `listReservationsForDay` (queries.ts:103) **and** the API route (route.ts:43); confirmed per-table
  `turnTimeMinutes` is currently ignored by the engine; `Table.zone` already serves as the section
  field; `createTableReservation` currently requires an explicit `tableId`. Decided the
  table-assignment model: keep explicit table-at-booking through 1c, combos book as N linked
  reservations sharing `bookingGroupId`, auto-assign deferred to P2 (live floor). Full step list
  captured under the P1 roadmap item. Planning only — no build started.
- **2026-05-22** — **P1 requirements completed (1e–1h) + table-reservations wiki documentation
  authored** (founder goal: "P1 requirements complete with well-produced, curated wiki docs").
  Extended the P1 plan past the availability engine with executable-depth requirements: **1e**
  no-show deposits (consumer-paid via the `@repo/data` invoice/settlement/fee cascade — payment-core
  architecture pass; adds payment fields to `TableReservation` + a per-restaurant/-shift no-show
  policy), **1f** confirmations/reminders/modify/cancel (reminder cron over the existing
  `reminderSentAt` + venue TZ; SMS-provider decision deferred), **1g** waitlist with auto-notify (new
  `TableWaitlistEntry`), **1h** multi-channel intake (embeddable widget now, Google/Instagram Reserve
  last). Separately filled the wiki gap with 4 `stable` pages — `entity:restaurant`,
  `entity:table-reservation`, `subsystem:table-reservations`, `flow:table-booking` — cited against
  code at HEAD, cataloged + logged, with a reverse cross-ref added to `subsystem:schematic-editor`.
  **Split rationale:** the wiki holds *current truth* (it documents the free-bookings-today state +
  the server-TZ bug and points here for the plan); the track holds *forward-looking requirements*.
  Confirmed the server-TZ bug recurs a third time in `getRestaurantReservationsForDay`
  (reservations/actions.ts:34). No code.
- **2026-05-22** — **P1 implemented** (founder goal "Entire P1 implemented"). Built 1a–1h in dependency
  order against the recorded plan: **1a** TZ correctness (✅), **1b** table attributes (✅), **1c**
  sections/pacing/shifts (✅), **1d** table combinations (✅ core; editor UI deferred), **1e** no-show
  deposits (◐ — model/policy/compute/state done, provider collection + cascade + consumer pay UI is the
  remaining seam), **1f** modify + reminders (◐ — core + cron done; SMS + cancellation-deadline + modify
  UI deferred), **1g** waitlist (◐ — core + consumer join + auto-notify-on-cancel done; UIs deferred),
  **1h** multi-channel (◐ — public CORS booking API done; widget UI + Google/Instagram Reserve remain,
  Reserve externally blocked). 6 migrations (`…_restaurant_timezone` / `_table_attributes` / `_shifts` /
  `_table_combinations` / `_no_show_deposits` / `_waitlist`) applied via `migrate:local`; client
  regenerated. New pure modules `tz.ts` / `pacing.ts` / `deposit.ts` with unit tests (13 + 3 + 7). All
  suites green: **core 43, partner 279, user 221, data 109**. Per-chunk detail under the Roadmap items.
  Process: driven directly by the orchestrator (shared `table-reservations-*` packages + `packages/data`
  have no owning dev-agent); each chunk verified (tsc + tests) before moving on. Honest scope: the
  engine/data/core/API layers + partner config UIs are implemented + tested; the money-collection path,
  SMS, several consumer/partner UIs, and the external Reserve integration are explicitly deferred (see
  ◐ items). Not committed.

## Open decisions

- **Payment model — decided 2026-05-22.** Two distinct money flows:
  - **Platform monetization = tiered hybrid.** On the **Starter** tier (the entry pack, shared with
    Sunbnb's existing subscription), Sunbnb earns a **per-cover fee** on table reservations, collected
    via the existing service-fee cascade. From the **first paid tier up (PRO/BUSINESS) — no
    per-cover**; the subscription replaces it. "No cover fees" thus becomes a **paid-tier upsell** (a
    high-volume Starter venue is naturally pushed to upgrade), and the anti-OpenTable pitch holds
    where it matters — the paid tiers.
  - **No-show protection = consumer-side, separate flow.** Deposits / card-hold / cancellation fees
    the *guest* pays, routed through the `@repo/data` invoice + settlement + fee cascade — independent
    of the per-cover monetization above.
  - **No-show mechanic — decided 2026-05-23:** **upfront deposit**, **pending-until-paid** (the
    booking is a hold until the deposit is collected; free bookings stay instant-confirm).
    **Configurable** at restaurant (`noShowPolicy` + `depositPerGuest`) + per-shift
    (`requiresDeposit` + `depositMinPartySize`) and **overridable per table** (`Table.requiresDeposit`
    tri-state + `Table.depositPerGuest`). For the *collection* (Piece 2): **Mollie-only initially**
    (decided 2026-05-23) — Mollie-for-Platforms already routes funds to the venue with the platform
    taking only `applicationFee`; **Stripe is blocked** because the current Stripe consumer flow
    collects into the *platform's own account* (no Connect), which the legal requirement prohibits, so
    Stripe deposits wait on a **Stripe Connect foundation → [[track:003-stripe-connect-compliance]]**.
    A kept deposit flows through the **full `@repo/data` invoice + settlement + fee cascade**; the
    deposit is **refunded on arrival** (seated) and kept only on no-show.
    **Mechanic fee-economics — resolved 2026-05-23:** keep **upfront deposit + refund-on-arrival**, but
    make deposits **targeted** — required only on high-risk / high-value bookings (large parties, peak/
    dinner shifts, premium tables) via the per-table + per-shift + min-party config — so the Mollie
    per-transaction fee leaked on each *refunded* (i.e. showed-up) deposit stays small + bounded, far
    below the no-show losses it prevents (refunds don't return the original PSP fee). The fee-clean
    **pre-auth / card-hold** model (no fee unless captured) is the upgrade, **deferred to
    [[track:003-stripe-connect-compliance]]** — it rides in with Stripe Connect (Mollie's manual-capture/
    auth support is too limited to rely on). Confirm Mollie's current fee/refund terms before launch.
  - **Still pending (P1 design detail):** the per-cover fee amount + exactly which tier boundary is
    "first paid".
- **Admin scope.** Read-only oversight vs. full management (and how much reservations feed the
  existing settlement/accounting views — the Approach favors folding in rather than a new silo).
_(Resolved 2026-05-22: (1) **Timezone source** — `timeZone` IANA column on `Restaurant`
(partner-set, engine fallback), not derived from the linked Site/country, so the engine stays
extraction-clean. (2) **Table-assignment model** — keep explicit table-at-booking through 1c
(`createTableReservation` takes a concrete `tableId`); combinations book as N linked reservations
sharing a `bookingGroupId`; host-driven auto-assign deferred to P2 live floor.)_
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
