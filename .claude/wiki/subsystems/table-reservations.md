---
type: subsystem
slug: table-reservations
status: stable
sources:
  - packages/table-reservations-core/src/index.ts
  - packages/table-reservations-core/src/availability.ts#getRestaurantAvailability
  - packages/table-reservations-core/src/reservations/actions.ts#createTableReservation
  - packages/table-reservations-ui/src/index.ts
  - apps/user/app/sites/[id]/table/actions.ts#bookTableForSite
  - apps/user/app/api/restaurants/[id]/availability/route.ts
  - apps/partner/app/restaurants/[id]/reservations/actions.ts
  - apps/partner/app/restaurants/layout.tsx
related:
  - entity:restaurant
  - entity:table-reservation
  - flow:table-booking
  - subsystem:schematic-editor
  - subsystem:payments
last_verified: 2026-05-22
---

# Subsystem: Table Reservations

The restaurant table-reservation product layered onto Sunbnb. A partner enables a restaurant on a
site, lays out tables on a schematic floor-plan, manages a menu + hours, and works the day's
bookings; a consumer picks a date + party size, sees real availability, and books a table
(anonymously or signed in). Built as **standalone-extractable** packages so the same engine can
power a future `tablefind.app`.

The defining architectural rule: **shared engine, decoupled — Sunbnb-tight in the apps.** All
domain logic lives in two brand-neutral packages; every Sunbnb-specific wire (the Site link,
payments/settlement, nav, flags) lives in `apps/*`, never in the packages.

## Package matrix

| Package | Contains | Sunbnb-coupled? |
|---|---|---|
| `@repo/table-reservations-core` | All domain logic — `restaurant/`, `tables/`, `reservations/` (create/modify + status + deposit transitions), `shifts/`, `combinations/`, `waitlist/`, `availability.ts`, pure `tz.ts` / `pacing.ts` / `deposit.ts`, `menu/`, `hours/`, `layout/`, `emails.ts` (HTML templates only), `status.ts`, `ownership.ts`, `types.ts`. No UI. | **No** |
| `@repo/table-reservations-ui` | Partner editors (`TableLayoutEditor`, `MenuEditor`, `RestaurantSettingsForm`, `ShiftsEditor`, `ReservationList`) + consumer components (`AvailabilityPicker`, `BookingForm`, `ConfirmationCard`). Built on `@repo/schematic` + `@repo/schematic-editor`. | **No** |

Neither package imports app code or touches auth/session. Apps import from core; they never
reimplement domain logic. Public surface: `table-reservations-core/src/index.ts`.

## Availability engine

`getRestaurantAvailability({ restaurantId, dateISO, partySize, sectionPreference?, featureRequirements? })`
(`availability.ts`) returns 30-minute slots for the venue civil date. **All wall-clock math runs in
`Restaurant.timeZone`** (default `Europe/Madrid`) via the pure `tz.ts` helpers — never the server
process TZ (the earlier server-TZ bug is fixed; `listReservationsForDay` + both day-view routes pass
the civil date too). When the restaurant has `RestaurantShift` rows for the weekday they define the
bookable windows (with **pacing** + last-seating); otherwise it falls back to `RestaurantHours`.
Eligible tables are `active` + `onlineBookable` + capacity/party fit, optionally filtered by
`sectionPreference` (zone) + `featureRequirements`. A slot offers a table when no `BLOCKING_*`
reservation overlaps `[from, to)`; pacing (pure `pacing.ts`) caps covers that may *start* in each
window (dedup by `bookingGroupId`). When no single table fits, predefined `TableCombination`s are
surfaced as `availableCombinationIds`. Enforces `reservationWindow` and drops past slots. The same
pacing + overlap checks run **inside the create/modify transactions** to close the race.

## App-layer wiring (Sunbnb-specific)

**Partner** (`apps/partner`): a top-level **`/restaurants`** section (list · `[id]` settings ·
`[id]/{tables,menu,reservations}` · `create`), gated by `app/restaurants/layout.tsx` (`notFound()`
when the flag is off). Ownership via `requireRestaurantOwner` / `requireRestaurantOwnerWithFlag`
(`lib/auth-helpers.ts`). One `createRestaurant({ siteId? })` backs both the standalone create and
the Site cross-link. Reservations tab → `markSeated/Departed/NoShow`, staff cancel, notes.

**Partner** also has the General-tab **policy/timezone** controls + the **`ShiftsEditor`** (shifts +
pacing + per-shift deposit gate), and partner action wrappers for shifts, combinations, modify, and
`chargeNoShowDeposit`.

**User** (`apps/user`): the consumer surface lives under a Sunbnb site — `/sites/[id]/table`.
`bookTableForSite` / `bookCombinationForSite` / `modifyTableBooking` / `cancelTableBooking` /
`joinWaitlistForSite` resolve `Site.restaurantId` → restaurant → the matching core action, then
fire-and-forget-email via `@repo/data/email` (a failed send never blocks the booking; cancel also
auto-notifies the earliest waitlist match). Availability is served by
`app/api/restaurants/[id]/availability/route.ts` (rate-limited 30/min/IP); a **public CORS booking
API** at `app/api/restaurants/[id]/book` (POST, rate-limited, restaurant-keyed) is the intake for an
embeddable widget + future Reserve. A daily reminder cron lives at `app/api/cron/table-reminders`
(`CRON_SECRET`). Anonymous bookings use the `sunbnb-anonId` localStorage UUID. See `[[flow:table-booking]]`.

## Configuration & integration points

- **Feature flag:** the entire product is behind the `restaurants` flag (`@repo/data/flags`,
  `getFlagStates({ isSudo })`). Partner layout `notFound()`s; the user route + actions check
  `isFlagEnabled('restaurants')`; sudo users get it on.
- **Soft FK:** `Site.restaurantId` ⟷ `Restaurant.siteId` (both optional + unique, **no Prisma
  relation on the Site side**) — preserves a clean extraction path. See `[[entity:restaurant]]`.
- **Schematic layer:** the table editor reuses `@repo/schematic` geometry + `@repo/schematic-editor`
  chrome — the same layer behind the sunbed inventory editor. See `[[subsystem:schematic-editor]]`.
- **No-show deposits (recorded, not yet collected):** `Restaurant.noShowPolicy` + per-shift
  `requiresDeposit` drive a deposit amount stored on the reservation (`depositStatus: pending`). The
  actual collection (Mollie deposit capture/refund; Stripe pre-auth via Connect deferred to [[track:003-stripe-connect-compliance]]) + `@repo/data` invoice/settlement/fee cascade
  (`[[subsystem:payments]]`) + consumer pay-before-confirm UI is the **remaining app-layer seam**.

## Invariants

1. **Domain logic lives in core.** Apps import from `@repo/table-reservations-core`; they never
   reimplement availability, the status machine, or booking creation.
2. **Sunbnb wiring stays in the apps.** Keep the Site link, payments/settlement, nav, and flags out
   of the two shared packages — that decoupling is the whole point.
3. **Create AND modify re-check availability + pacing in-transaction** — the double-booking /
   over-pacing race guards (`createTableReservation` / `createCombinationReservation` /
   `modifyTableReservation`).
4. **Combination bookings are group-atomic.** N rows share `bookingGroupId`; cancel/seat/depart/
   no-show act on the whole group; pacing counts the party once.
5. **Flag-gated end-to-end.** Every entry point honours the `restaurants` flag.
6. **No Prisma relation on `Site.restaurantId`.** Soft FK only (extraction posture).

## Roadmap / planned work

P1 "booking core" is **largely implemented** (track-002, 2026-05-22): TZ correctness, table
attributes, sections/pacing/shifts, table combinations, the no-show *deposit model*, modify +
reminders, waitlist, and the public booking API all landed. **Remaining seams** (still in the track):
the deposit **money collection** (provider capture/refund + invoice cascade + consumer pay UI), SMS
reminders/notify, the embeddable widget UI, **Google/Instagram Reserve** (external), and several
consumer/partner UIs (section/feature + combo pickers, waitlist join + view, modify UI). The
standalone-extraction sequencing also lives in `.claude/tracks/002-table-reservations.md`. Update this
page via `[[workflow:ingest]]` as the seams close.

## Related

- `[[entity:restaurant]]` · `[[entity:table-reservation]]` — the data model.
- `[[flow:table-booking]]` — the consumer journey + staff lifecycle.
- `[[subsystem:schematic-editor]]` — shared floor-plan geometry/chrome.
- `[[subsystem:payments]]` — the cascade the no-show money path will reuse.

## Common pitfalls

- **Putting Sunbnb coupling in the shared packages** — breaks extraction; the wiring belongs in `apps/*`.
- **Doing wall-clock math outside `tz.ts`** — slot/day times must resolve in `Restaurant.timeZone`, not the server TZ.
- **Reimplementing availability/pacing/booking in an app** instead of calling core.
- **Forgetting the `restaurants` flag gate** on a new entry point.
- **Adding a Prisma relation on the `Site` side** of the soft FK.
- **Assuming a deposit was charged** — the model records `depositStatus: pending`; collection is unbuilt.
