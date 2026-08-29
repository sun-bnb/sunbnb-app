# Testing — User App (`apps/user`)

Pulled on demand; **not** auto-loaded. The always-loaded summary lives in
`apps/user/CLAUDE.md` § Testing.

---

## Testing

```bash
npm run test              # unit + route + server action tests (557 tests, Prisma mocked)
npm run test:watch        # vitest in watch mode
npm run test:integration  # integration tests against local sunbnb_test DB (88 tests, real Prisma)
```

### Unit / route tests (`vitest.config.ts`)

- Excludes `*.integration.test.ts`; scans `app/**` and `store/**`
- Path aliases redirect `@repo/data/PrismaCient` → mock, `@repo/data/payment` → mock
- **Mock modules** (`__mocks__/@repo/data/`): `PrismaCient.ts`, `payment.ts`, `reservation-emails.ts`, `env.ts`, `reservation-machine-apply.ts` (the state-machine interpreter, track 018 — the pure model `@repo/data/reservation-machine` is aliased to REAL source), `preferences.ts` (platform preferences — the real module imports the Prisma client; the mock resolves the registry DEFAULTS so an app test asserts the route serves whatever the preference resolves to, and resolution/bounds stay tested where they live)
- `app/api/_lib/payment-ids.test.ts` — isDemoPayment, isValidEntityId (6 tests)
- `app/api/_lib/payment-provider.test.ts` — detectProvider (Mollie/demo), isPaymentSucceeded/Failed (16 tests)
- `app/api/reservations/[id]/route.test.ts` — reservation fetch, payment verification (9 tests)
- `app/api/rental-bookings/[id]/route.test.ts` — rental booking fetch, payment verification, anon ownership (10 tests)
- `app/api/sites/[id]/route.test.ts` — single-site fetch (2 tests)
- `app/api/restaurants/[id]/availability/route.test.ts` — restaurant table availability query (5 tests)
- `app/api/restaurants/[id]/layout/route.test.ts` — restaurant table layout fetch (5 tests)
- `app/api/table-reservations/[id]/route.test.ts` — table reservation fetch + ownership (8 tests)
- `app/api/table-reservations/[id]/deposit/mollie/route.test.ts` — table reservation deposit Mollie payment (23 tests)
- `app/api/payment/mollie/create-rental-payment/route.test.ts` — create Mollie payment for rental booking (7 tests)
- `app/api/tab-payment/mollie/create-payment/route.test.ts` — create Mollie payment for dine-in tab: validation, 404, 409 claim conflicts, zero-total revert, `loadTabFeeContext` fee-context-failure revert, happy path (linked venue, metadata incl. `restaurantId`), standalone (`siteId: null`) happy path (18 tests)
- `app/api/tabs/[id]/route.test.ts` — tab payment poll-fallback: 404, invalid id, open passthrough, paid passthrough, pending+succeeded, pending+failed revert, provider-error tolerance, minimal DTO, no-auth (9 tests)
- `app/api/webhooks/mollie/route.test.ts` — Mollie webhook handling (34 tests — tab branch + reservation fail/refund asserted as machine events: ONE state-resolved `pay.fail` covers both online payment_failed and QR-collect revert-to-cash; `pay.refund.webhook` for refunds)
- `app/api/reconcile/route.test.ts` — stuck payment reconciliation (9 tests)
- `app/api/cron/send-reminders/route.test.ts` — daily reminder cron auth + email sending (10 tests)
- `app/api/auth/forgot-password/route.test.ts` — rate limiting, email validation, enumeration protection (10 tests)
- `app/api/auth/reset-password/route.test.ts` — rate limiting, token/password validation (12 tests)
- `app/api/hw/[code]/state/route.test.ts` — HW device state route: the Q9 client filter (scanner UAs curl/requests/browser declined, empty UA declined, CONTAINS-match so a firmware version bump still passes, unknown code asserted **byte-identical** to a filtered request, neither reaching the DB, `HW_CLIENT_UA`-unset fails CLOSED ⇒ 503), binding resolution from the `Device` table (unknown code, `retired` declined, `provisioned` served, empty binding declined, lookup failure ⇒ 503, normalised code asserted on the query) + mount-order emission, address resolution (the exact 4-part `siteId_parcel_row_seq` key asserted — dropping `row` would silently serve a neighbouring row's unit, since `seq` repeats in every row; no unit at the address ⇒ non-200), one case per compound state → wire state, the read-only today-row rule (a multiday guest checked in yesterday reads RESERVED, not OCCUPIED), aggregate rule, fail-safe (unrecognised state ⇒ OCCUPIED; DB throw ⇒ 503), ETag/304, and the poll cadence (the resolved preference is served rather than a hardcoded interval, a cadence change busts the ETag so a 304 cannot hide it, and the read goes through the cached accessor) (63 tests). Filter extracted to `hw/[code]/hw-filter.ts` (`screenDeviceRequest` + `normalizeCode`), shared with telemetry
- `app/api/hw/[code]/telemetry/route.test.ts` — HW telemetry stub (P1.5): client-filter parity with the state route (scanner/empty UAs declined, CONTAINS-match, unknown code byte-identical to a filtered request, `HW_CLIENT_UA`-unset ⇒ 503 fail-closed), and a `204` that never depends on the body (well-formed, malformed non-JSON, empty, and unknown-field payloads all accepted), code normalisation before the binding lookup, retired-device decline (13 tests)
- `app/api/auth/impersonate/route.test.ts` — sudo impersonation start (4 tests)
- `app/api/auth/end-impersonation/route.test.ts` — impersonation end (4 tests)
- `app/q/resolve.test.ts` — QR entry resolution (track 022): the FULL four-part address key asserted (dropping `row` resolves a neighbouring row's unit — `seq` restarts in every row; verified by injecting that defect, 2 tests fail, no collateral), code folded as minted, the `1-1-1-2` superset resolving to the same unit, pool exclusion + deterministic seat order on the query, malformed input declined WITHOUT touching the DB, and declines for unknown code / no unit / spares-only (15 tests)
- `app/q/[site]/page.test.ts` — venue QR page: folded-code lookup, malformed code declined pre-DB, unknown code → ErrorCard (4 tests)
- `app/q/[site]/[unit]/page.test.ts` — seat QR page: renders `PosView` with the shared availability tail, hands URL segments to the resolver UNTOUCHED (folding lives in one place), never spends the availability query on an unresolved card (4 tests)
- `app/sites/[id]/pos/page.test.ts` — legacy venue route: redirect to `/q/[site]`, query params preserved, id-or-slug still accepted, and the **render fallback when the site has no code yet** (5 tests)
- `app/sites/[id]/pos/[itemId]/page.test.ts` — legacy seat route: redirect to `/q/[site]/[unit]`, query params preserved, no availability query spent on a redirect, and the **render fallbacks** — no site code (pre-backfill) and no unit address (pre-021 production) (6 tests)
- `app/sites/[id]/pos/[itemId]/pos-seat-selection.test.ts` — the POS (QR) picking rules: the unit opens fully selected but never preselects a bed someone else holds, a click is about the tapped bed only (NOT the map's re-take-the-unit rule), the price follows the pick seat by seat and falls back to the site price exactly as the server charges, an empty pick prices at 0, and a partly-booked unit is sellable only where per-seat picking is on (18 tests)
- `app/s/[slug]/page.test.ts` — the brand fork (track 023 P3): mounts the module when a real key is assigned AND the switch is on, and renders the STANDARD page for every other combination (switch off with a module assigned — merged-but-dark; a key nothing answers to; no key at all), plus an unknown slug never reaching the fork (7 tests)
- `brands/registry.test.ts` — registry ↔ manifest agreement at runtime (the partner and admin apps read the manifest and cannot import the registry), and a SOURCE guard that every entry is wrapped in `next/dynamic` — the thing that actually code-splits the brands, and which no unit test can otherwise see (2 tests)
- `app/sites/[id]/peek-height.test.ts` — the mobile drawer's minimized peek height (track 023 P2), extracted from inline `SiteView` arithmetic that had no test: per-tab heights, days taller than hours, the equipment-tab-without-hourly-pricing branch falling back to the sunbeds height, the tab strip reserved in every mode, and the hours/days mode ignored entirely on the sunbeds tab (6 tests)
- `app/sites/[id]/seat-selection.test.ts` — the click-to-select policy shared by the geo map and the schematic canvas: whole-unit moves with the flag off, whole-unit-then-per-seat with it on, unit independence, and the rule that an unavailable seat never enters a selection (a partly-booked unit contributes only its free seats — 5 of the 18 fail on the pre-change algorithm, verified by running them against it) (18 tests)
- `app/sites/[id]/actions.test.ts` — reservation/rental creation, availability, pricing (51 tests)
- `app/sites/[id]/table/actions.test.ts` — table reservation creation actions (10 tests)
- `app/reservations/[id]/actions.test.ts` — cancel, createOrder, completeUnpaidOrder (40 tests)
- `app/reservations/[id]/receipt/actions.test.ts` — receipt / invoice actions (6 tests)
- `app/reservations/rental/[id]/actions.test.ts` — rental booking detail actions (17 tests)
- `app/payment/actions.test.ts` — demo payments, query actions (45 tests — +11 for initiateDemoTabPayment)
- `app/embed/[restaurantId]/page.test.ts` — embedded restaurant page (3 tests)
- `app/tables/[tableId]/actions.test.ts` — placeTabOrder/getTabState/getDineContext (table-anchored, single `tableId` param): validation, `restaurant.dineInEnabled` gate, MenuItem sourcing (incl. soldOut + pre-v2 `totalPrice: 0` fallback), standalone (`siteId: null`) vs linked dual-write, anon `userId = restaurant.partnerAccountId`, P2002 retry (40 tests)
- `app/tables/[tableId]/page.test.ts` — canonical table page server component: getDineContext error paths → notFound, success → DineView with tableId prop (4 tests)
- `app/tables/[tableId]/view.test.ts` — DineView logic: product shape contract, placeTabOrder call contract (no siteId), TabState shape, pending_payment gate, pay button visibility, demo pay contract, Mollie pay contract (`/tables/[tableId]` redirectUrl), return-poll resolution mapping, paid-state guard vs tab:null poll (34 tests)
- `app/sites/[id]/dine/[tableId]/page.test.ts` — legacy alias: redirects to `/tables/[tableId]`, preserves query params (incl. `?tabReturn=`, arrays, undefined values) (6 tests)
- `store/features/api/apiSlice.test.ts` — anonGetQuery anonId forwarding for anon-owned lookups (3 tests)

### Integration tests (`vitest.integration.config.ts`)

Requires local Docker Postgres with `sunbnb_test` DB (same DB as `packages/data` integration tests — no extra setup needed). `POSTGRES_URL` set via CLI in the npm script. No mock for `@repo/data/PrismaCient` or `@repo/data/payment` — real DB writes verified.
- `service/availability-semantics.integration.test.ts` — ORACLE-equivalence for the set-based availability rewrite (track 020 P2): the pre-P2 JS implementation runs VERBATIM as referee against a seeded matrix (~90 seats — every payment status × op-status × stay-over combo, all six inclusive-overlap boundaries, 3-seat party, far-future window) and must answer identically incl. ordering and periods; plus the `getAvailabilityForItems` scoping/absence contract (inactive/foreign/bogus ids ABSENT, never available) (5 tests)
- `service/availabilityService.integration.test.ts` — `getAvailability` ORDERING contract (track 020 P1): seats returned in ascending seat-number order regardless of insertion order, `pickFirstAvailablePair` preselects the lowest-numbered available seat (and the next-lowest when it is booked), stability across calls. Guards the one order-dependent read path an index can silently change — fixture seats are inserted deliberately scrambled (4 tests)
- `service/siteService.integration.test.ts` — searchSites item_count (active-only denominator), available_count (BLOCKING_STATUSES filter, date overlap, no-show/departed release rule, non-blocking statuses); countAvailableToday (wraps getAvailability for today's server-local window) (14 tests)
- `app/sites/[id]/actions.integration.test.ts` — saveReservationForMultipleItems (DB writes, payment calc incl. INCLUSIVE-last-day anchoring — `to` civil date = last day of stay, one-day booking from==to accepted and billed 1 day (2026-08-15 regression), unpaid, anonymous), saveRentalBooking (pricing, real aggregate availability check) (23 tests)
- `app/reservations/[id]/actions.integration.test.ts` — createOrder (DB prices, soldOut, appSalesEnabled, anonymous), cancelReservation (status update, refund logic) (16 tests)
- `app/sites/[id]/pos/[itemId]/queries.integration.test.ts` — POS seat availability contract: non-blocking reservations (canceled / refunded / payment_failed) must NOT block the seat, blocking ones (complete / paid_in_cash / pending) still do, the track-012 release rule (departed / no-show with the stay over frees it; departed mid-multiday still holds), group/pair surfacing + per-seat verdicts, and default-deny (inactive seat ABSENT, unknown item ⇒ null). **6 of the 14 fail on the pre-fix client-side algorithm** — verified by running them against it (14 tests)
- `app/q/resolve.integration.test.ts` — QR resolution against real rows and the real `UNIQUE(site_id, parcel, row_idx, seq)` index: two units in DIFFERENT ROWS of one parcel told apart (the pair a key missing `row` confuses — invisible against mocks), lowercase prefix-less code, pool spare left out of the beds served, spares-only unit declined, empty address declined, and one address at two venues never crossing (8 tests)
- `app/reservations/rental/[id]/actions.integration.test.ts` — rental booking detail actions against real DB (8 tests)
- `app/tables/[tableId]/actions.integration.test.ts` — dine-in tab v2 find-or-create (first order opens tab, second joins it, fresh tab after close), DB-priced rounds, getTabState totals, pending_payment rejection, standalone restaurant (no Site: `TableTab.siteId`/`Order.siteId` null, `Order.restaurantId` set), linked-venue dual-write (15 tests)
- **Test helpers**: `app/test/setup.ts` (cleanDatabase, prisma), `app/test/fixtures.ts` (factory functions for all needed models)

### Mocking patterns

- Use `vi.mock()` with `vi.fn()` in factory (never reference external variables — hoisting), then `vi.mocked(importedFn)` after import for typed references
- For env vars captured at module load time, use `vi.hoisted()`
- Always call `mockAuth.mockResolvedValue(null)` in `beforeEach` — `vi.clearAllMocks()` clears call history but not implementations, so auth leaks between tests if not reset

