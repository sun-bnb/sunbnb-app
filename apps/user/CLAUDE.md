# User App (apps/user)

Consumer booking app — discovery, sunbed reservations, F&B, rentals, dine-in tabs, table
reservations, QR/POS entry, the HW device API.

Port 3002 (`https://local.sunbnb.app:3002`). Run: `cd apps/user && source .env.local && npm run dev`

**Pulled on demand** (not auto-loaded — read the one you need):

- `apps/user/TESTING.md` — test inventory, vitest aliases/mocks, fixture rules, mocking patterns
- `apps/user/UI.md` — user design-system layer (prime with `/ui user`)
- `apps/user/HW-API.md` — `/api/hw/[code]/*`: client filter, power policy, telemetry, Wi-Fi downlink
- `apps/user/PATTERNS.md` — QR/POS routes, seat selection, booking funnel, brand pages, seat ids,
  state transitions, payment-route details, dine-in tabs
- Payments end to end: `.claude/wiki/flows/reservation-payment.md`, `.claude/wiki/subsystems/payments.md`

**Analytics:** GA4 via `@repo/ui/google-analytics` in `app/layout.tsx` (consent-gated;
`NEXT_PUBLIC_GA4_ID` per env). Funnel events in `app/analytics/` (`funnel.ts` builders + once-per-
transaction guard, `track.ts` wrappers); never pass email/name/anonId/user ids as params.

## Auth Model

Google, Facebook, Credentials (email/password, bcrypt) — NextAuth config in `app/auth.ts`.
Anonymous support via `anonId` (UUID in `localStorage('sunbnb-anonId')`) for POS/QR flows.
`app/app.tsx` routes to `AuthenticatedApp` or `UnauthenticatedApp` by session. Admin
impersonation: `/api/auth/impersonate` (single-use signed token) + `/api/auth/end-impersonation`.

## Route Map

| Route | Purpose | Auth |
|---|---|---|
| `/` | Landing — hero, marketing sections, search | Public |
| `/sites` | Site discovery — list + map, search by location | Public |
| `/sites/[id]` | Site detail — services, hours, booking funnel (`BookingSurface`) | Public |
| `/sites/[id]/table` | Restaurant table booking for a site | Public |
| `/q/[site]` | Canonical venue QR (track 022) → `PosView`; see PATTERNS.md | Public |
| `/q/[site]/[unit]` | Canonical seat QR, keyed by unit address (`app/q/resolve.ts`) | Public |
| `/sites/[id]/pos` | Legacy venue QR — redirects to `/q/[site]` when the site has a code | Public |
| `/sites/[id]/pos/[itemId]` | Legacy seat QR — redirects when code + address exist | Public |
| `/tables/[tableId]` | Dine-in tab (v2, restaurant-anchored): menu, rounds, running tab, Close & pay | Public |
| `/sites/[id]/dine/[tableId]` | Legacy alias → `/tables/[tableId]`, query params preserved | Public |
| `/tabs/[tabId]/receipt` | Dine-in tab receipt | Public |
| `/table-reservations/[id]` | Table reservation detail + deposit return/poll | Mixed |
| `/embed/[restaurantId]` | Embeddable restaurant booking widget | Public |
| `/reservations` | User's reservations — Active/History tabs | Auth |
| `/reservations/[id]` | Reservation detail — swipeable confirmation + F&B menu | Mixed |
| `/reservations/[id]/pass` | QR ticket pass — printable | Mixed |
| `/reservations/[id]/receipt` | Invoice receipt — HTML + PDF download | Mixed |
| `/reservations/rental/[id]` (+ `/receipt`) | Rental booking detail / receipt | Mixed |
| `/payment/complete` (+ `/rental`) | Payment verification + redirect (Mollie `?reservationId`, demo `?payment_intent`) | Mixed |
| `/payment/viva/stub` | Dev-only fake Viva checkout (`VIVA_MODE=stub`, else 404) | — |
| `/account` | User account settings | Auth |
| `/demo` | Demo mode activation + interactive showcase | Public |
| `/s/[slug]` | Branded site page; bespoke brand module when enabled (track 023) | Public |
| `/s/[slug]/reservations` | Branded reservations page | Mixed |
| `/sign-in`, `/forgot-password`, `/reset-password` | Auth pages | Public |
| `/tos[/reservation]`, `/privacy`, `/cancellation-policy` | Legal | Public |

The payment step (`payment/Payment.tsx`) renders inside the reservation flow — **not a route**
(`/payment` 404s): Mollie routes by default, Stripe/Viva via `POST /api/payment/create`, or demo.

## API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/[...nextauth]` | GET, POST | NextAuth handlers |
| `/api/auth/forgot-password` | POST | Password reset email (IP rate-limited) |
| `/api/auth/reset-password` | POST | Reset password (IP rate-limited, token hashed) |
| `/api/auth/impersonate`, `/end-impersonation` | GET | Admin impersonation start (single-use token) / end + sign-out |
| `/api/sites` | GET | Search sites by coordinates (PostGIS distance query) |
| `/api/sites/[id]` | GET | Single site with inventory + working hours |
| `/api/sites/[id]/availability` | GET | Item availability for a date range (public, 90-day max) |
| `/api/sites/[id]/rental-availability` | GET | Rental quantities for a window (public, 90-day max) |
| `/api/reservations/[id]` | GET | Reservation + poll-fallback payment verify + invoice |
| `/api/orders/[id]` | GET | Order + poll-fallback payment verify + invoice |
| `/api/rental-bookings/[id]` | GET | Rental booking + poll-fallback payment verify |
| `/api/table-reservations/[id]` | GET | Table reservation deposit poll-fallback (ownership-checked) |
| `/api/tabs/[id]` | GET | Tab payment poll-fallback (QR credential; DTO `{ id, status, closedAt }`) |
| `/api/payment/mollie/create-payment` | POST | Mollie payment for reservation (redirectUrl origin-validated) |
| `/api/payment/mollie/create-rental-payment` | POST | Mollie payment for rental bookings |
| `/api/order-payment/mollie/create-payment` | POST | Mollie payment for order |
| `/api/tab-payment/mollie/create-payment` | POST | Mollie payment for tab (QR credential; atomic claim TAB_OPEN→TAB_PENDING_PAYMENT) |
| `/api/table-reservations/[id]/deposit/mollie` | POST | Mollie deposit for table reservation (no applicationFee) |
| `/api/payment/create` | POST | Neutral checkout for Stripe/Viva (track 028); provider resolved server-side |
| `/api/payment/viva/return` | GET | Viva return redirect (`?t=&s=`) → the kind's return page |
| `/api/webhooks/mollie` | POST | Mollie webhook (paymentId format-validated) |
| `/api/webhooks/stripe-connect` | POST | Stripe Connect webhook (signature + `event.account`, re-fetch) |
| `/api/webhooks/viva` | GET, POST | Viva webhook — GET handshake; POST UNSIGNED, re-fetch, orderCode match |
| `/api/reconcile` | GET, POST | Stuck-payment sweeps (5 kinds), cron `*/15`; `RECONCILIATION_SECRET`/`CRON_SECRET` |
| `/api/restaurants/[id]/availability` | GET | Public table availability (IP rate-limited) |
| `/api/restaurants/[id]/layout` | GET | Public sanitized floor layout; 404 when guest selection is off |
| `/api/restaurants/[id]/book` | POST, OPTIONS | Public CORS booking intake for the embed widget (anon only) |
| `/api/receipts/[invoiceId]/qr.png` | GET | AEAT/Verifactu QR image for an invoice (track 026) |
| `/api/places/autocomplete`, `/details` | GET | Google Places proxy (input length / placeId validated) |
| `/api/cron/send-reminders` | GET | Daily 07:00 UTC reminder emails (`CRON_SECRET`) |
| `/api/cron/prune-telemetry` | GET | Daily 03:20 UTC bounded `device_telemetry` retention sweep (`CRON_SECRET`) |
| `/api/cron/table-reminders` | GET | Table-reservation reminders (`CRON_SECRET`, `restaurants` flag; not in `vercel.json`) |
| `/api/cron/table-deposit-cleanup` | GET | Reap stale deposit holds >20 min (`CRON_SECRET`; not in `vercel.json`) |
| `/api/hw/[code]/state` | GET | HW device seat state + telemetry uplink (track 019) — **`HW-API.md`** |
| `/api/hw/[code]/telemetry` | POST | HW legacy telemetry escape hatch → `204` — **`HW-API.md`** |

Webhook/reconcile/create semantics: `.claude/wiki/subsystems/payments.md`; route-level details
(create error codes, Viva return targets, reconcile exclusions): `PATTERNS.md` § Payment routes.

## Server Actions

| File | Actions |
|---|---|
| `sites/[id]/actions.ts` | `saveReservationForMultipleItems`, `saveRentalBooking`, `findAnonReservation`, `findUserReservation`, `findAnonRentalBooking` |
| `reservations/[id]/actions.ts` | `cancelReservation`, `deleteReservation`, `getProducts`, `createOrder`, `completeUnpaidOrder`, `getOrderByPaymentRef`, `getOrders` |
| `payment/actions.ts` | `initiateDemo{Reservation,Order,Rental,Tab}Payment`, `getReservationById`, `getReservationByPaymentRef`, `getOrderByPaymentRef` |
| `tables/[tableId]/actions.ts` | `placeTabOrder`, `getTabState`, `getDineContext` (table id = credential) |
| `sites/[id]/table/actions.ts` | `bookTableForSite`, `bookCombinationForSite`, `modifyTableBooking`, `cancelTableBooking`, `joinWaitlistForSite`, `initiateDemoTableDeposit` |
| `reservations/rental/[id]/actions.ts` | `cancelRentalBooking` |
| `reservations/[id]/receipt/actions.ts` | `requestReceipt` |
| `account/actions.ts` · `locale/actions.ts` | `submitForm` · `setLocale` |
| `payment/viva/stub/actions.ts` | `resolveStubCheckout` (dev stub) |

- `saveReservationForMultipleItems`: auth/anonId required; price from DB via `reservationListPrice`
  (`@repo/data/reservation-price`); availability via the SCOPED `getAvailabilityForItems` (absent
  ids are unbookable); an unpaid-site booking is COMPLETE at creation and emails its confirmation here.
- `cancelReservation` refunds via `issueRefund` when paid; `createOrder` enforces DB prices.
- Tab actions, demo-tab revert: `PATTERNS.md`.

## API Auth Helpers (`app/api/_lib/`)

- **`auth.ts`**: `getRequestIdentity(request, bodyAnonId?)` → `{ userId?, anonId? }` (anonId
  UUID-validated); `verifyOwnership(identity, entity)`.
- **`payment-ids.ts`**: `isDemoPayment` (re-export of `@repo/data/payment-refs`), `isValidEntityId`
  (CUID or UUID). Provider-neutral route-input helpers.
- **`mollie.ts`**: `getMollieClientForPartner`, `getValidMollieToken`, `findPartnerTokenForPayment`.
- **`payment-provider.ts`**: `getPaymentStatus`, `isPaymentSucceeded/Failed`, `issueRefund(ref, {
  reservationId? })` — dispatch by ref prefix (`providerFromRef`): Mollie, demo, Stripe
  (`stripe_cs_`/`stripe_pi_`, connected account from the entity's partner), Viva online (`vso_`, via
  `getOnlineAdapter('viva')`). `viva-terminal` is never polled here; its refund needs `reservationId`.
- **`payment-events.ts`**: `parsePaymentMeta`, `findPaymentEntity(ref)`, `onPaymentState(meta, ref,
  'paid'|'failed')` — the one confirm/revert dispatcher shared by webhooks, reconcile and polls.

## State Management

- `store/features/reservation` and `store/features/sites` are untyped `createKeyValueSlice` stores
  (single `setValue` merge action). Conventional keys — `reservation`: `selectedItems`,
  `seatCategory`, `reservationType`, `from`, `to`, `orderState`, `pendingOrderId`, `panel*`;
  `sites`: `selectedSiteId`, `selectedItemId`, `mapCenter`, `reservationDay`, `viewMode`
  ('sunbeds'|'equipment'), `reservationMode` ('days'|'hours'), `focused` (drawer open).
- `search` — plain slice (`searchText`, place suggestions).
- RTK Query: `httpApi` (`store/features/api/apiSlice.ts` — site/availability/reservation/order/rental
  queries, anonId forwarded) and `googlePlacesApi` (autocomplete + place details).

## Testing

```bash
npm run test              # unit + route + server action tests (Prisma mocked)
npm run test:watch
npm run test:integration  # against local sunbnb_test DB (real Prisma)
```

Inventory, alias/mock list, UUID anon fixtures, mocking patterns: **`apps/user/TESTING.md`**.

## Key Patterns

- **Payment verification:** the entity GET routes are the poll fallback; `/api/reconcile` the net.
- **Anonymous flow:** POS/QR users get `anonId` in localStorage, passed to actions/routes for
  ownership without login.
- **Never trust client prices:** availability check + create with DB prices in one operation.
- **Default-deny:** `=== 'paid'` (never `!== 'unpaid'`) so unknown payment types fail closed.
- **Errors:** actions return `{ status: 'ok' | 'error', errors?: string[] }`; API errors are generic.
- **Reservation transitions** go through `applyTransition` (track 018) — `PATTERNS.md`.
- In `PATTERNS.md`: partial group booking is client-only policy (`seat-selection.ts`, NOT
  enforced server-side); the funnel is ONE component (`BookingSurface`, brands mount it, never
  copy); brand pages are NOT in server HTML (verify in a browser); seat ids via `formatSeatId`.
- **UI:** `apps/user/UI.md` + `.claude/rules/ui.md`; prime with `/ui user`.
