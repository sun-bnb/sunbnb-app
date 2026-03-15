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
| `/reservations` | User's reservations — Active/History tabs | Auth |
| `/reservations/[id]` | Reservation detail — swipeable confirmation + F&B menu | Mixed |
| `/reservations/[id]/pass` | QR ticket pass — printable | Mixed |
| `/reservations/[id]/receipt` | Invoice receipt — HTML + PDF download | Mixed |
| `/payment` | Stripe / Demo payment form | Mixed |
| `/payment/complete` | Payment verification + redirect | Mixed |
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
| `/api/payment/stripe/payment-intent` | POST | Create Stripe PaymentIntent for reservation |
| `/api/payment/mollie/create-payment` | POST | Create Mollie payment for reservation (redirectUrl origin-validated) |
| `/api/order-payment/stripe/payment-intent` | POST | Create Stripe PaymentIntent for order |
| `/api/order-payment/mollie/create-payment` | POST | Create Mollie payment for order |
| `/api/webhooks/stripe` | POST | Stripe webhook (signature-verified) |
| `/api/webhooks/mollie` | POST | Mollie webhook (paymentId format-validated) |
| `/api/reconcile` | POST | Reconcile stuck payments (RECONCILIATION_SECRET required) |
| `/api/places/autocomplete` | GET | Google Places proxy (input length-limited) |
| `/api/places/details` | GET | Google Places proxy (placeId regex-validated) |
| `/api/cron/send-reminders` | GET | Daily 07:00 UTC — sends reminder emails (CRON_SECRET) |

## Server Actions

- **`sites/[id]/actions.ts`**: `saveReservationForMultipleItems` (multi-item, auth/anonId required, price from DB), `saveRentalBooking` (availability-checked), `findAnonReservation`, `findUserReservation`
- **`reservations/[id]/actions.ts`**: `cancelReservation` (+ Stripe refund if paid), `getProducts`, `createOrder` (DB prices enforced), `completeUnpaidOrder`, `getOrderByPaymentRef`, `getOrders`
- **`payment/actions.ts`**: `initiateDemoReservationPayment`, `initiateDemoOrderPayment`, `initiateDemoRentalPayment`, `getReservationById`, `getReservationByPaymentRef`, `getOrderByPaymentRef`

## API Auth Helpers (`app/api/_lib/`)

- **`auth.ts`**: `getRequestIdentity(request, bodyAnonId?)` extracts userId from session or anonId from query/body. `verifyOwnership(identity, entity)` checks requesting user owns the resource.
- **`stripe.ts`**: `getStripeClient()`, `getStripePaymentStatus(paymentRef)`, `isDemoPayment(paymentRef)` (checks `pi_demo_` prefix), `isValidEntityId(value)` (CUID or UUID v4)
- **`mollie.ts`**: `getMollieClientForPartner(accessToken)`, `getValidMollieToken(partnerAccount)`, `findPartnerTokenForPayment(paymentId)`
- **`payment-provider.ts`**: `getPaymentStatus(paymentRef)`, `isPaymentSucceeded/Failed(status)`, `issueRefund(paymentRef)` — provider-agnostic abstraction

## State Management

Redux slices (via `createKeyValueSlice` factory):
- `searchSlice` — `searchText`, `selectedPlace`, `searchSuggestions`
- `reservationSlice` — `selectedItems`, `seatCategory`, `reservationType`, `from`, `to`, `orderState`, `pendingOrderId`, `panelBottom`, `panelHeight`, `panelFocused`
- `sitesSlice` — `selectedSiteId`, `selectedItemId`, `mapCenter`, `reservationDay`

RTK Query: `reservationApi` (getReservation, getReservationByDate, etc.), `placesApi` (getAutocomplete, getPlaceDetails)

## Testing

```bash
npm run test              # unit + route + server action tests (162 tests, Prisma mocked)
npm run test:watch        # vitest in watch mode
npm run test:integration  # integration tests against local sunbnb_test DB (19 tests, real Prisma)
```

### Unit / route tests (`vitest.config.ts`)

- Excludes `*.integration.test.ts`
- Path aliases redirect `@repo/data/PrismaCient` → mock, `@repo/data/payment` → mock
- **Mock modules** (`__mocks__/@repo/data/`): `PrismaCient.ts`, `payment.ts`, `reservation-emails.ts`, `env.ts`
- `app/api/_lib/stripe.test.ts` — isDemoPayment, isValidEntityId (11 tests)
- `app/api/_lib/payment-provider.test.ts` — detectProvider, isPaymentSucceeded/Failed (16 tests)
- `app/api/payment/stripe/payment-intent/route.test.ts` — PaymentIntent creation, validation, auth (11 tests)
- `app/api/reservations/[id]/route.test.ts` — reservation fetch, payment verification (9 tests)
- `app/api/webhooks/stripe/route.test.ts` — Stripe webhook handling (11 tests)
- `app/api/webhooks/mollie/route.test.ts` — Mollie webhook handling (13 tests)
- `app/api/reconcile/route.test.ts` — stuck payment reconciliation (9 tests)
- `app/sites/[id]/actions.test.ts` — reservation/rental creation, availability, pricing (18 tests)
- `app/reservations/[id]/actions.test.ts` — cancel, createOrder, completeUnpaidOrder (37 tests)
- `app/payment/actions.test.ts` — demo payments, query actions (27 tests)

### Integration tests (`vitest.integration.config.ts`)

Requires local Docker Postgres with `sunbnb_test` DB (same DB as `packages/data` integration tests — no extra setup needed). `POSTGRES_URL` set via CLI in the npm script. No mock for `@repo/data/PrismaCient` or `@repo/data/payment` — real DB writes verified.
- `app/sites/[id]/actions.integration.test.ts` — saveReservationForMultipleItems (DB writes, payment calc, unpaid, anonymous), saveRentalBooking (pricing, real aggregate availability check) (10 tests)
- `app/reservations/[id]/actions.integration.test.ts` — createOrder (DB prices, soldOut, appSalesEnabled, anonymous), cancelReservation (status update, refund logic) (9 tests)
- **Test helpers**: `app/test/setup.ts` (cleanDatabase, prisma), `app/test/fixtures.ts` (factory functions for all needed models)

### Mocking patterns

- Use `vi.mock()` with `vi.fn()` in factory (never reference external variables — hoisting), then `vi.mocked(importedFn)` after import for typed references
- For env vars captured at module load time, use `vi.hoisted()`
- Always call `mockAuth.mockResolvedValue(null)` in `beforeEach` — `vi.clearAllMocks()` clears call history but not implementations, so auth leaks between tests if not reset

## Key Patterns

- Payment verification: GET `/api/reservations/[id]` serves as polling fallback if webhook missed — checks provider status and processes if succeeded
- Anonymous flow: POS/QR users get `anonId` in localStorage, passed to server actions and API routes for ownership without requiring login
- Reservation creation: server-side availability check → create with DB prices (never trust client prices)
- Error handling: server actions return `{ status: 'ok' | 'error', errors?: string[] }`
