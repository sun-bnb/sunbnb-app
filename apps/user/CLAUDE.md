# User App (apps/user)

Consumer-facing booking app — site discovery, sunbed reservations, F&B ordering, equipment rentals.

Port 3002 (`https://local.sunbnb.app:3002`). Run: `cd apps/user && source .env.local && npm run dev`

## Auth Model

Google, Facebook, Credentials (email/password with bcrypt). Anonymous support via `anonId` (UUID in `localStorage('sunbnb-anonId')`) for POS/QR flows. `app.tsx` routes to `AuthenticatedApp` or `UnauthenticatedApp` based on session. `auth.ts` at app root configures NextAuth.

## Route Map

| Route | Purpose | Auth |
|---|---|---|
| `/` | Landing page — hero, marketing sections, search | Public |
| `/sites` | Site discovery — list + map view, search by location | Public |
| `/sites/[id]` | Site detail — image, services, hours, reservation panel | Public |
| `/sites/[id]/pos` | POS reservation (QR code entry) — anonymous support | Public |
| `/sites/[id]/pos/[itemId]` | Direct item POS reservation — availability decided SERVER-side in `pos/[itemId]/queries.ts` (`getPosContext`) via the canonical `getAvailabilityForItems`; the page ships `availableItemIds` and the client never re-derives it. Was a client-side rule over an unfiltered `reservations` include, so canceled/refunded/payment_failed bookings blocked the seat forever and "today" was browser-midnight (fixed 2026-08-16) | Public |
| `/tables/[tableId]` | Dine-in tab ordering (v2, restaurant-anchored, canonical) — per-table QR landing, menu browse (MenuItem catalog), place rounds, view running tab, Close & pay (Mollie or demo), return-poll flow, paid state. No siteId — the table id alone is the credential/routing key; standalone (`Restaurant.siteId = null`) and linked venues both work | Public |
| `/sites/[id]/dine/[tableId]` | Legacy alias — redirects to `/tables/[tableId]`, preserving all query params (old printed QR codes, mid-flight Mollie `?tabReturn=` returns) | Public |
| `/reservations` | User's reservations — Active/History tabs | Auth |
| `/reservations/[id]` | Reservation detail — swipeable confirmation + F&B menu | Mixed |
| `/reservations/[id]/pass` | QR ticket pass — printable | Mixed |
| `/reservations/[id]/receipt` | Invoice receipt — HTML + PDF download | Mixed |
| `payment/Payment.tsx` (in-page) | Payment step rendered inside the reservation flow (Mollie redirect / demo form) — **not a standalone route**; `/payment` 404s | — |
| `/payment/complete` | Payment verification + redirect (Mollie returns here with `?reservationId`; demo with `?payment_intent`) | Mixed |
| `/account` | User account settings | Auth |
| `/demo` | Demo mode activation + interactive showcase | Public |
| `/s/[slug]` | Branded site page via slug | Public |
| `/s/[slug]/reservations` | Branded reservations page | Mixed |

## API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/[...nextauth]` | GET, POST | NextAuth handlers |
| `/api/auth/forgot-password` | POST | Password reset email (IP rate-limited) |
| `/api/auth/reset-password` | POST | Reset password with token (IP rate-limited, token hashed) |
| `/api/sites` | GET | Search sites by coordinates (PostGIS distance query) |
| `/api/sites/[id]` | GET | Single site with inventory + working hours |
| `/api/sites/[id]/availability` | GET | Check item availability for date range (public, 90-day max) |
| `/api/reservations/[id]` | GET | Fetch reservation + verify payment + create invoice |
| `/api/reservations/[id]/find` | GET | Find reservation by paymentRef |
| `/api/orders/[id]` | GET | Fetch order + verify payment + create invoice |
| `/api/orders/[id]/find` | GET | Find order by paymentRef |
| `/api/payment/mollie/create-payment` | POST | Create Mollie payment for reservation (redirectUrl origin-validated) |
| `/api/order-payment/mollie/create-payment` | POST | Create Mollie payment for order |
| `/api/tab-payment/mollie/create-payment` | POST | Create Mollie payment for dine-in tab (QR-credential, no ownership check; atomic claim TAB_OPEN→TAB_PENDING_PAYMENT before total computed) |
| `/api/tabs/[id]` | GET | Poll-fallback for tab payment status (QR-credential, no ownership check; minimal DTO `{ id, status, closedAt }`) |
| `/api/webhooks/mollie` | POST | Mollie webhook (paymentId format-validated) |
| `/api/reconcile` | POST | Reconcile stuck payments (RECONCILIATION_SECRET required) |
| `/api/places/autocomplete` | GET | Google Places proxy (input length-limited) |
| `/api/places/details` | GET | Google Places proxy (placeId regex-validated) |
| `/api/cron/send-reminders` | GET | Daily 07:00 UTC — sends reminder emails (CRON_SECRET) |
| `/api/hw/[code]/state` | GET | **HW API** (track 019 P1) — seat state for a mounted hardware device. Seats resolved from the device's **assigned ADDRESS** — one indexed `findUnique` on `SunbedGroup` `UNIQUE(site_id, parcel, row_idx, seq)` via the shared `@repo/data/unit-address` `unitAddressWhere` (track 021; was a parcel-wide fetch plus a JS row filter, because row used to live inside the encoded seat number — the resolver, the partner assign action and the seat-removal guard each re-derived it and could disagree). A device answers for whatever unit occupies its address today, so a parcel rebuilt at the same spot needs no re-assignment; no unit there ⇒ non-200, never a free bed. Venue-local day, projection over `deriveState`, `ETag`/`304`. **No auth — a soft client filter** (track 019 Q9): the request's `User-Agent` must CONTAIN `HW_CLIENT_UA` (an opaque needle; firmware sends `Sunbnb-Sensor/1 (<needle>)`, so a version bump needs no server change). It declines obvious non-sensor traffic pre-DB, it is **not** a credential — the data is public occupancy and the cost-abuse backstop is edge rate-limiting. Unset `HW_CLIENT_UA` fails CLOSED (503). Failed filter and unknown code get a uniform opaque 401; every other failure is non-200 so the device shows amber, never a false FREE. The filter (UA match, device-binding lookup, `normalizeCode`) is the shared `hw/[code]/hw-filter.ts` `screenDeviceRequest`, used by both HW routes so they can't drift. A `retired` device and one with no seats bound are both declined (an empty binding would aggregate to FREE); `provisioned` DOES serve, so bring-up isn't trapped behind a manual status flip |
| `/api/hw/[code]/telemetry` | POST | **HW API** (track 019 P1.5) — device battery/RSSI/uptime `{ fw, battMv, rssiDbm, upSec, polls, tempC? }` → `204`. **Stub: persists nothing** (P5 promotes to last-values writes). Same client filter as `state` (shared `hw-filter.ts`). Once past the filter the `204` never depends on the body — malformed/absent payloads are still accepted, because telemetry must never fail the device's poll loop |

## Server Actions

- **`sites/[id]/actions.ts`**: `saveReservationForMultipleItems` (multi-item, auth/anonId required, price from DB; availability validated via the SCOPED `getAvailabilityForItems` — absent ids are unbookable, track 020 P2), `saveRentalBooking` (availability-checked), `findAnonReservation`, `findUserReservation`
- **`reservations/[id]/actions.ts`**: `cancelReservation` (+ provider refund via `issueRefund` if paid), `getProducts`, `createOrder` (DB prices enforced), `completeUnpaidOrder`, `getOrderByPaymentRef`, `getOrders`
- **`payment/actions.ts`**: `initiateDemoReservationPayment`, `initiateDemoOrderPayment`, `initiateDemoRentalPayment`, `initiateDemoTabPayment` (QR-credential, no ownership check; atomic claim + calculateTabTotal guard; on processConfirmedTabPayment error does NOT revert — poll route retries), `getReservationById`, `getReservationByPaymentRef`, `getOrderByPaymentRef`
- **`tables/[tableId]/actions.ts`** (dine-in tabs v2, restaurant-anchored, single `tableId` param — track 002 P1.5 + dine-in-v2 decoupling): `placeTabOrder` (find-or-create open tab in-txn on the `openTableId` unique guard, P2002 → join existing; orders enter kitchen state `complete`, prices from `MenuItem`, not `Product`; anon `Order.userId = restaurant.partnerAccountId`; dual-write `siteId`/`site` connect only when the restaurant is linked to a Site), `getTabState` (open tab + rounds + `calculateTabTotal` totals, queried by `openTableId` alone; no ownership check — QR-URL-as-credential), `getDineContext` (restaurant/table + MenuItem-sourced menu mapped to the legacy product-shaped DTO; gates: flag → table active → `restaurant.dineInEnabled` — no site lookup at all, table id is the sole credential/routing key)

## API Auth Helpers (`app/api/_lib/`)

- **`auth.ts`**: `getRequestIdentity(request, bodyAnonId?)` extracts userId from session or anonId from query/body. `verifyOwnership(identity, entity)` checks requesting user owns the resource.
- **`payment-ids.ts`**: `isDemoPayment(paymentRef)` (checks `pi_demo_` prefix), `isValidEntityId(value)` (CUID or UUID v4). Extracted from the removed Stripe lib when consumer Stripe was purged.
- **`mollie.ts`**: `getMollieClientForPartner(accessToken)`, `getValidMollieToken(partnerAccount)`, `findPartnerTokenForPayment(paymentId)`
- **`payment-provider.ts`**: `getPaymentStatus(paymentRef)`, `isPaymentSucceeded/Failed(status)`, `issueRefund(paymentRef)` — provider-agnostic abstraction over **Mollie + demo** (consumer Stripe removed)

## State Management

Redux slices (via `createKeyValueSlice` factory):
- `searchSlice` — `searchText`, `selectedPlace`, `searchSuggestions`
- `reservationSlice` — `selectedItems`, `seatCategory`, `reservationType`, `from`, `to`, `orderState`, `pendingOrderId`, `panelBottom`, `panelHeight`, `panelFocused`
- `sitesSlice` — `selectedSiteId`, `selectedItemId`, `mapCenter`, `reservationDay`, `viewMode` ('sunbeds' | 'equipment'), `reservationMode` ('days' | 'hours'), `focused` (drawer open state)

RTK Query: `reservationApi` (getReservation, getReservationByDate, etc.), `placesApi` (getAutocomplete, getPlaceDetails)

## Testing

```bash
npm run test              # unit + route + server action tests (521 tests, Prisma mocked)
npm run test:watch        # vitest in watch mode
npm run test:integration  # integration tests against local sunbnb_test DB (88 tests, real Prisma)
```

### Unit / route tests (`vitest.config.ts`)

- Excludes `*.integration.test.ts`; scans `app/**` and `store/**`
- Path aliases redirect `@repo/data/PrismaCient` → mock, `@repo/data/payment` → mock
- **Mock modules** (`__mocks__/@repo/data/`): `PrismaCient.ts`, `payment.ts`, `reservation-emails.ts`, `env.ts`, `reservation-machine-apply.ts` (the state-machine interpreter, track 018 — the pure model `@repo/data/reservation-machine` is aliased to REAL source)
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
- `app/api/hw/[code]/state/route.test.ts` — HW device state route: the Q9 client filter (scanner UAs curl/requests/browser declined, empty UA declined, CONTAINS-match so a firmware version bump still passes, unknown code asserted **byte-identical** to a filtered request, neither reaching the DB, `HW_CLIENT_UA`-unset fails CLOSED ⇒ 503), binding resolution from the `Device` table (unknown code, `retired` declined, `provisioned` served, empty binding declined, lookup failure ⇒ 503, normalised code asserted on the query) + mount-order emission, address resolution (the exact 4-part `siteId_parcel_row_seq` key asserted — dropping `row` would silently serve a neighbouring row's unit, since `seq` repeats in every row; no unit at the address ⇒ non-200), one case per compound state → wire state, the read-only today-row rule (a multiday guest checked in yesterday reads RESERVED, not OCCUPIED), aggregate rule, fail-safe (unrecognised state ⇒ OCCUPIED; DB throw ⇒ 503), ETag/304 (60 tests). Filter extracted to `hw/[code]/hw-filter.ts` (`screenDeviceRequest` + `normalizeCode`), shared with telemetry
- `app/api/hw/[code]/telemetry/route.test.ts` — HW telemetry stub (P1.5): client-filter parity with the state route (scanner/empty UAs declined, CONTAINS-match, unknown code byte-identical to a filtered request, `HW_CLIENT_UA`-unset ⇒ 503 fail-closed), and a `204` that never depends on the body (well-formed, malformed non-JSON, empty, and unknown-field payloads all accepted), code normalisation before the binding lookup, retired-device decline (13 tests)
- `app/api/auth/impersonate/route.test.ts` — sudo impersonation start (4 tests)
- `app/api/auth/end-impersonation/route.test.ts` — impersonation end (4 tests)
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
- `app/reservations/rental/[id]/actions.integration.test.ts` — rental booking detail actions against real DB (8 tests)
- `app/tables/[tableId]/actions.integration.test.ts` — dine-in tab v2 find-or-create (first order opens tab, second joins it, fresh tab after close), DB-priced rounds, getTabState totals, pending_payment rejection, standalone restaurant (no Site: `TableTab.siteId`/`Order.siteId` null, `Order.restaurantId` set), linked-venue dual-write (15 tests)
- **Test helpers**: `app/test/setup.ts` (cleanDatabase, prisma), `app/test/fixtures.ts` (factory functions for all needed models)

### Mocking patterns

- Use `vi.mock()` with `vi.fn()` in factory (never reference external variables — hoisting), then `vi.mocked(importedFn)` after import for typed references
- For env vars captured at module load time, use `vi.hoisted()`
- Always call `mockAuth.mockResolvedValue(null)` in `beforeEach` — `vi.clearAllMocks()` clears call history but not implementations, so auth leaks between tests if not reset

## Key Patterns

- Payment verification: GET `/api/reservations/[id]` serves as polling fallback if webhook missed — checks provider status and processes if succeeded
- Anonymous flow: POS/QR users get `anonId` in localStorage, passed to server actions and API routes for ownership without requiring login
- Reservation creation: server-side availability check → create with DB prices (never trust client prices)
- Default-deny payment logic: use `=== 'paid'` (not `!== 'unpaid'`) to prevent unknown payment types from bypassing payment
- **Reservation state transitions (track 018)**: webhook/poll/reconcile failure reverts, demo initiation, and user cancel/delete delegate to `applyTransition` (`@repo/data/reservation-machine-apply`). `pay.fail` resolves collect-vs-online reverts BY STATE (metadata.collect not load-bearing); `user.delete` rejects PROCESSING bookings (in-flight payment could orphan); `user.cancel` runs the provider refund via a caller-supplied handler BEFORE the status write. Single-writer ratchet in `packages/data/src/reservation-machine-guard.test.ts`
- Equipment rentals: supports hourly and daily bookings. `viewMode` (sunbeds/equipment) stored in Redux so the mobile drawer can adapt its peek height to content. Tab switching opens the drawer automatically
- Mobile reservation drawer: fixed bottom panel with peek (minimized) and expanded states. Peek height varies by tab — sunbeds shows date range only, equipment shows hours/days toggle + time picker. Drawer opens on tab switch
- Error handling: server actions return `{ status: 'ok' | 'error', errors?: string[] }`. API error responses use generic messages (no internal details leaked)
- UI / design system: see **`apps/user/UI.md`** (user design-system layer) + the general **`.claude/rules/ui.md`**; prime UI work with `/ui user`.
