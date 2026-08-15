---
type: entity
slug: restaurant
status: stable
sources:
  - packages/data/prisma/schema.prisma#model-Restaurant
  - packages/table-reservations-core/src/restaurant/queries.ts
  - packages/table-reservations-core/src/restaurant/actions.ts#createRestaurant
  - packages/table-reservations-core/src/ownership.ts#requireRestaurantOwner
  - packages/data/prisma/schema.prisma#model-Site
  - apps/partner/app/restaurants/[id]/queries.ts
related:
  - entity:table-reservation
  - subsystem:table-reservations
  - flow:table-booking
  - subsystem:auth
last_verified: 2026-08-15
---

# Restaurant

A table-reservation venue owned by a `PartnerAccount`. It owns tables, a menu, working
hours, a schematic floor-plan, and table reservations. **Optionally** soft-linked to a
Sunbnb `Site` (the chiringuito case) — but a Restaurant can also stand alone (the future
`tablefind.app` case). The root aggregate of the restaurant product.

## Schema essentials

`Restaurant` (`packages/data/prisma/schema.prisma#model-Restaurant`):

- Identity: `id`, `slug` (**unique**), `name`. Slug is derived from the name when omitted
  (`restaurant/slug.ts#uniqueRestaurantSlug`).
- Ownership: `partnerAccountId` (**required**) → `PartnerAccount.userId` (note: references the
  *userId*, not a separate account id), `onDelete: Cascade`.
- Sunbnb link: `siteId` (**optional**, `@unique`) — soft FK to a `Site`. Mirrored by
  `Site.restaurantId` (also optional + unique). 1:1-optional both ways.
- Booking config: `averageMealDuration` (default `120` min — drives slot length),
  `reservationWindow` (default `60` days bookable ahead), `timeZone` (IANA, nullable → engine
  default; all slot wall-clock math runs in this zone — a site-linked restaurant inherits the
  site's coord-derived tz at create, see [[subsystem:venue-timezone]]), `priceRange` (1–4),
  `cuisineType`, `tagline`, `description`.
- No-show policy: `noShowPolicy` (`none` default | `deposit`) + `depositPerGuest?` — when
  `deposit`, shifts that opt in require a per-guest deposit (see `[[entity:table-reservation]]`).
- Floor plan: `layoutWidth` / `layoutHeight` (canvas metres).
- Standalone visibility: `publicOnStandaloneApp` (default `true`) — when false, a
  chiringuito-linked restaurant stays hidden from the standalone app's public listing but is
  always discoverable on Sunbnb. Brand-neutral column name on purpose.
- Dine-in ordering: `dineInEnabled` (default `false`) — **the single gate** for QR dine-in tab
  ordering (dine-in v2, 2026-07-25), for standalone AND site-linked restaurants alike
  (`Site.appSalesEnabled` now governs sunbed room-service only). Toggle on the partner General
  tab; consumer `/tables/[tableId]` route enforces it. Backfilled from the linked site's
  `appSalesEnabled` at migration time.
- Relations: `tables` (`[[entity:table-reservation]]` covers `Table`), `reservations`
  (`TableReservation`), `menuItems`, `workingHours` (`RestaurantHours`, 0–14 rows: per-day
  `openTime`/`closeTime` `"HH:mm"`), `shifts` (`RestaurantShift` — named service windows with
  pacing; **override** `workingHours` for availability when present), `combinations`
  (`TableCombination`), `waitlistEntries` (`TableWaitlistEntry`), `layoutElements`, and since
  dine-in v2 `tabs` (`TableTab`) + `orders` (`Order.restaurantId`) — dine-in commerce is
  restaurant-anchored; linked venues dual-write `siteId` alongside.
- `MenuItem` is **orderable** since dine-in v2: carries the VAT triple (`price` net derived,
  `tax` %, `totalPrice` gross — mirrors `Product`) and is THE dine-in catalog for all
  restaurants. Site `Product` remains for sunbed/POS F&B only. Fee context for standalone
  restaurants resolves via `loadRestaurantFeeContext` (partnerAccount → settings; empty site
  tier) in `packages/data/src/payment.ts`.

## Ownership

`requireRestaurantOwner(restaurantId, userId)` (`ownership.ts`) compares
`restaurant.partnerAccountId === userId`; **sudo users bypass**. It is brand-agnostic (takes
`userId` explicitly) so any app can wrap it. The partner app wraps it as
`requireRestaurantOwnerWithFlag(restaurantId, 'restaurants')` (ownership **+** feature flag) in
`apps/partner/lib/auth-helpers.ts`.

## Invariants

1. **PartnerAccount-owned; Site-optional.** `partnerAccountId` is required, `siteId` is not —
   never assume a Restaurant has a Site. Resolve a Site's restaurant via `Site.restaurantId`.
2. **The Site link is soft.** No Prisma relation is declared on the `Site` side — plain column +
   DB-level FK only. This is deliberate, to keep the `tablefind.app` extraction path clean. Do
   **not** "fix" it into a relation.
3. **`slug` is unique and URL-safe.** `createRestaurant`/`updateRestaurant` enforce uniqueness and
   the `slugify` shape; omitted slugs are auto-derived.
4. **Ownership compares `userId`.** `partnerAccountId` stores the owner's `User.id`
   (`PartnerAccount.userId`), so ownership is a `userId` equality check, sudo-exempt.
5. **The whole product is flag-gated** behind `restaurants` — app entry points use
   `requireRestaurantOwnerWithFlag` / `isFlagEnabled('restaurants')`.

## Related

- `[[entity:table-reservation]]` — the `Table` + `TableReservation` children and their lifecycle.
- `[[subsystem:table-reservations]]` — the packages, availability engine, and app wiring.
- `[[flow:table-booking]]` — consumer booking end-to-end.
- `[[subsystem:auth]]` — ownership / sudo / anon model this builds on.
- `[[entity:site]]` (planned) — the soft-linked Sunbnb venue.

## Common pitfalls

- **Assuming `siteId` is set.** Standalone restaurants have none; the user-app flow keys on
  `Site.restaurantId`, the partner app on `restaurantId` directly.
- **Adding a Prisma relation on `Site.restaurantId`.** Breaks the extraction posture (invariant 2).
- **Looking for an account-id.** `partnerAccountId` *is* the owner's `User.id`.
- **Forgetting the flag gate.** Reads/mutations in the apps must go through the flag-aware wrapper.
- **Mock divergence.** Partner tests mock `@repo/data/PrismaCient`; the mock gained a `restaurant`
  delegate — extend it when you add fields used in tests.
- **Path typo `@repo/data/PrismaCient`** (missing 'l') is intentional. Do not "fix" it.
