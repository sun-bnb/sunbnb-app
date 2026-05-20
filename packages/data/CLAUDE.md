# Data Package (packages/data)

`@repo/data` — shared Prisma schema, DB client, payment logic, auth helpers, email, and business utilities. This is the single source of truth for all database access and core business logic.

## Commands

```bash
cd packages/data
npm run migrate:local        # local Docker DB (copies .env.local → .env, runs prisma migrate dev, generates client)
npm run migrate:test         # Neon test DB
npm run migrate:production   # production DB
source .env.local && npx prisma studio   # Prisma Studio
source .env.local && ./sync-local-db.sh  # Sync local DB from test
```

## Schema

Prisma schema at `packages/data/prisma/schema.prisma`. 70+ migrations. Uses `@prisma/adapter-pg` driver adapter. PostGIS extension for spatial queries (`geometry` type with GiST index).

Key models: User, PartnerAccount, Site, InventoryItem, Reservation, Order, OrderItem, RentalItem, RentalBooking, Invoice, InvoiceLine, Settlement, ServiceFee, Settings, PasswordResetToken, Product.

## Payment Service (`src/payment.ts`)

### Pure Functions (no DB, no side effects)
- `round(amount)` — financial rounding to 2 decimals
- `computeVatAndBaseAmounts(gross, vatRate)` — reverse VAT: `base = round(gross / (1 + rate/100))`
- `resolveServiceFee(siteFees, accountFees, settingsFees, serviceCode, tier?)` — three-tier cascade, first match wins
- `calculateServiceFeeAmount(fee, referenceAmount)` — fixed (`feeAmount`) or percentage calculation
- `computeInvoiceHash(number, date, amount, vatNumber, previousHash)` — SHA-256 chain for invoice integrity

### DB-Dependent Functions
- `loadFeeContext(siteId, serviceCode)` — loads site + partnerAccount + settings fees; bootstraps default Settings if missing
- `processConfirmedReservation(id)` — idempotent invoice creation: 2 invoices (partner + platform), per-sunbed lines + fee lines, sequential numbering with FOR UPDATE lock, hash chain, sends confirmation email
- `processConfirmedOrder(id)` — same pattern but per-item VAT (not site-wide), fee added to customer total
- `processConfirmedRentalBooking(paymentRef)` — groups bookings by paymentRef, creates invoices for the group
- `calculateOrderServiceFee(orderId)` — read-only fee calculation for orders

### Invoice Creation Rules
- **Reservations**: fee deducted from partner revenue (customer pays listed price)
- **Orders**: fee added to customer total
- All prices are VAT-inclusive; reverse calculation to get base amounts
- Two invoices per payment: PARTNER (revenue) and PLATFORM (commission)
- Invoice numbers sequential per issuer type, protected by FOR UPDATE lock
- Hash chain: each invoice's hash includes previous invoice's hash

## Status Constants (`src/reservation-status.ts`)

Single source of truth. Status fields are plain String columns in Prisma (not enums). Import as `@repo/data/reservation-status`.

- **Reservation payment**: PENDING → PROCESSING → COMPLETE (or PAYMENT_FAILED / CANCELED / REFUNDED / PAID_IN_CASH)
- **Reservation operational**: EXPECTED → CHECKED_IN → DEPARTED (also: WALKED_IN, BLOCKED, NO_SHOW)
- **Order**: PENDING → PROCESSING → COMPLETE → ACCEPTED → PREPARING → READY → DELIVERED → COMPLETED (or REJECTED / DISCARDED / CANCELED / REFUNDED)
- **Rental payment**: PENDING → PROCESSING → COMPLETE (or PAYMENT_FAILED / CANCELED / REFUNDED)
- **Rental operational**: RESERVED → PICKED_UP → RETURNED
- Semantic groupings: `BLOCKING_STATUSES`, `PAID_STATUSES`, `TERMINAL_STATUSES`, `RESERVATION_STATUSES`

## Password Reset (`src/password-reset.ts`)

- `requestPasswordReset(email, appBaseUrl)` — SHA-256 hashed token, validates origin against `ALLOWED_ORIGINS`, max 3/hour per email, invalidates previous tokens, sends via Resend
- `resetPassword(token, password)` — verifies hashed token, checks expiry, enforces password strength (8+ chars, upper+lower+digit), bcrypt update in transaction
- `hashToken(raw)` — pure SHA-256 helper
- `passwordResetEmailHtml(url, hours)` — pure HTML template

## Rate Limiter (`src/rate-limit.ts`)

- `rateLimit(key, { maxAttempts, windowMs })` — in-memory sliding-window, cleanup every 5 min
- Per-process only (resets on serverless cold start)

## Other Exports
- `src/reservation-emails.ts` — confirmation, reminder, cancellation emails via Resend
- `src/settlement.ts` — monthly payout aggregation
- `src/subscription.ts` — partner subscription tier management
- `src/email.ts` — shared Resend email sender
- `src/business-entity.ts` — platform business entity for invoicing

## Testing

```bash
npm run test                  # unit tests — pure logic, no DB, no mocking
npm run test:integration      # integration tests — requires local sunbnb_test DB
npm run test:integration:setup  # run prisma migrate deploy against sunbnb_test
```

- **Unit tests** (`src/*.test.ts`): `payment.test.ts` (28 tests — round, VAT, fee cascade, fee calculation), `rate-limit.test.ts` (7 tests — sliding window, expiry, independent keys), `reservation-status.test.ts` (8 tests — status groupings, overlap checks)
- **Integration tests** (`src/*.integration.test.ts`): `payment.integration.test.ts` (18 tests — processConfirmedReservation/Order, invoice creation, idempotency, hash chain, VAT, fees), `fee-context.integration.test.ts` (7 tests — loadFeeContext three-tier cascade), `password-reset.integration.test.ts` (15 tests — token lifecycle, rate limiting, expiry, password strength)
- **Config**: `vitest.config.ts` (unit, excludes `*.integration.test.ts`), `vitest.integration.config.ts` (integration, `fileParallelism: false` for shared DB)
- **Test helpers**: `src/test/setup.ts` (DB connection, `cleanDatabase()` via TRUNCATE CASCADE), `src/test/fixtures.ts` (factory functions for all models)

## Known Quirks
- Exports both Prisma client AND duplicated UI components (TextField, Button) — same components also exist in `@repo/ui`
- Export path typo: `"./PrismaCient"` (missing 'l' in Client)
