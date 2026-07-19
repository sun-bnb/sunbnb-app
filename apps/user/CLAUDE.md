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
| `/sites/[id]/pos/[itemId]` | Direct item POS reservation | Public |
| `/sites/[id]/dine/[tableId]` | Dine-in tab ordering — per-table QR landing, menu browse, place rounds, view running tab, Close & pay (Mollie or demo), return-poll flow, paid state | Public |
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

## Server Actions

- **`sites/[id]/actions.ts`**: `saveReservationForMultipleItems` (multi-item, auth/anonId required, price from DB), `saveRentalBooking` (availability-checked), `findAnonReservation`, `findUserReservation`
- **`reservations/[id]/actions.ts`**: `cancelReservation` (+ provider refund via `issueRefund` if paid), `getProducts`, `createOrder` (DB prices enforced), `completeUnpaidOrder`, `getOrderByPaymentRef`, `getOrders`
- **`payment/actions.ts`**: `initiateDemoReservationPayment`, `initiateDemoOrderPayment`, `initiateDemoRentalPayment`, `initiateDemoTabPayment` (QR-credential, no ownership check; atomic claim + calculateTabTotal guard; on processConfirmedTabPayment error does NOT revert — poll route retries), `getReservationById`, `getReservationByPaymentRef`, `getOrderByPaymentRef`
- **`sites/[id]/dine/[tableId]/actions.ts`** (dine-in tabs, track 002 P1.5): `placeTabOrder` (find-or-create open tab in-txn on the `openTableId` unique guard, P2002 → join existing; orders enter kitchen state `complete`, DB prices), `getTabState` (open tab + rounds + `calculateTabTotal` totals; no ownership check — QR-URL-as-credential), `getDineContext` (site/restaurant/table + product menu; flag + `appSalesEnabled` + table↔site gates)

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
npm run test              # unit + route + server action tests (459 tests, Prisma mocked)
npm run test:watch        # vitest in watch mode
npm run test:integration  # integration tests against local sunbnb_test DB (70 tests, real Prisma)
```

### Unit / route tests (`vitest.config.ts`)

- Excludes `*.integration.test.ts`; scans `app/**` and `store/**`
- Path aliases redirect `@repo/data/PrismaCient` → mock, `@repo/data/payment` → mock
- **Mock modules** (`__mocks__/@repo/data/`): `PrismaCient.ts`, `payment.ts`, `reservation-emails.ts`, `env.ts`
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
- `app/api/tab-payment/mollie/create-payment/route.test.ts` — create Mollie payment for dine-in tab: validation, 404, 409 claim conflicts, zero-total revert, happy path, revert-on-error (15 tests)
- `app/api/tabs/[id]/route.test.ts` — tab payment poll-fallback: 404, invalid id, open passthrough, paid passthrough, pending+succeeded, pending+failed revert, provider-error tolerance, minimal DTO, no-auth (9 tests)
- `app/api/webhooks/mollie/route.test.ts` — Mollie webhook handling (28 tests — +6 for tab branch: paid/failed/canceled/expired/guard/refund-noop)
- `app/api/reconcile/route.test.ts` — stuck payment reconciliation (9 tests)
- `app/api/cron/send-reminders/route.test.ts` — daily reminder cron auth + email sending (10 tests)
- `app/api/auth/forgot-password/route.test.ts` — rate limiting, email validation, enumeration protection (10 tests)
- `app/api/auth/reset-password/route.test.ts` — rate limiting, token/password validation (12 tests)
- `app/api/auth/impersonate/route.test.ts` — sudo impersonation start (4 tests)
- `app/api/auth/end-impersonation/route.test.ts` — impersonation end (4 tests)
- `app/sites/[id]/actions.test.ts` — reservation/rental creation, availability, pricing (51 tests)
- `app/sites/[id]/table/actions.test.ts` — table reservation creation actions (10 tests)
- `app/reservations/[id]/actions.test.ts` — cancel, createOrder, completeUnpaidOrder (40 tests)
- `app/reservations/[id]/receipt/actions.test.ts` — receipt / invoice actions (6 tests)
- `app/reservations/rental/[id]/actions.test.ts` — rental booking detail actions (17 tests)
- `app/payment/actions.test.ts` — demo payments, query actions (45 tests — +11 for initiateDemoTabPayment)
- `app/embed/[restaurantId]/page.test.ts` — embedded restaurant page (3 tests)
- `app/sites/[id]/dine/[tableId]/page.test.ts` — dine-in page server component: getDineContext error paths → notFound, success → DineView with siteId/tableId props (4 tests)
- `app/sites/[id]/dine/[tableId]/view.test.ts` — DineView logic: product shape contract, placeTabOrder call contract, TabState shape, pending_payment gate, pay button visibility, demo pay contract, Mollie pay contract, return-poll resolution mapping, paid-state guard vs tab:null poll (29 tests)
- `store/features/api/apiSlice.test.ts` — anonGetQuery anonId forwarding for anon-owned lookups (3 tests)

### Integration tests (`vitest.integration.config.ts`)

Requires local Docker Postgres with `sunbnb_test` DB (same DB as `packages/data` integration tests — no extra setup needed). `POSTGRES_URL` set via CLI in the npm script. No mock for `@repo/data/PrismaCient` or `@repo/data/payment` — real DB writes verified.
- `service/siteService.integration.test.ts` — searchSites item_count (active-only denominator), available_count (BLOCKING_STATUSES filter, date overlap, no-show/departed release rule, non-blocking statuses); countAvailableToday (wraps getAvailability for today's server-local window) (14 tests)
- `app/sites/[id]/actions.integration.test.ts` — saveReservationForMultipleItems (DB writes, payment calc, unpaid, anonymous), saveRentalBooking (pricing, real aggregate availability check) (21 tests)
- `app/reservations/[id]/actions.integration.test.ts` — createOrder (DB prices, soldOut, appSalesEnabled, anonymous), cancelReservation (status update, refund logic) (16 tests)
- `app/reservations/rental/[id]/actions.integration.test.ts` — rental booking detail actions against real DB (8 tests)
- `app/sites/[id]/dine/[tableId]/actions.integration.test.ts` — dine-in tab find-or-create (first order opens tab, second joins it, fresh tab after close), DB-priced rounds, getTabState totals, pending_payment rejection (11 tests)
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
- Equipment rentals: supports hourly and daily bookings. `viewMode` (sunbeds/equipment) stored in Redux so the mobile drawer can adapt its peek height to content. Tab switching opens the drawer automatically
- Mobile reservation drawer: fixed bottom panel with peek (minimized) and expanded states. Peek height varies by tab — sunbeds shows date range only, equipment shows hours/days toggle + time picker. Drawer opens on tab switch
- Error handling: server actions return `{ status: 'ok' | 'error', errors?: string[] }`. API error responses use generic messages (no internal details leaked)
- UI / design system: see **`apps/user/UI.md`** (user design-system layer) + the general **`.claude/rules/ui.md`**; prime UI work with `/ui user`.
