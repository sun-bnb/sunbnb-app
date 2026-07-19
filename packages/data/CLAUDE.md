# Data Package (packages/data)

`@repo/data` — shared Prisma schema, DB client, payment logic, auth helpers, email, and business utilities. This is the single source of truth for all database access and core business logic.

## Commands

```bash
cd packages/data
npm run migrate:local        # local Docker DB — prisma migrate dev + generate, then migrate deploy to sunbnb_test (lockstep)
npm run migrate:test         # Neon test DB — POSTGRES_URL_TEST via scripts/with-db-url.sh, prisma migrate deploy
npm run migrate:production   # Neon prod DB — POSTGRES_URL_PRODUCTION via scripts/with-db-url.sh, prisma migrate deploy
npm run migrate:check        # fails (exit 2) if schema.prisma has changes no committed migration captures
npm run migrate:status:local        # pending / failed / checksum-drift status per environment
npm run migrate:status:test         #   (test)
npm run migrate:status:production   #   (production)
source .env.local && npx prisma studio   # Prisma Studio
source .env.local && ./sync-local-db.sh  # Sync local DB from test
```

`migrate:test`/`:production`/`:status:*`/`:check` route the right DB URL from `.env.local`
through `scripts/with-db-url.sh` as an **inline `POSTGRES_URL` override** — `.env` is never
rewritten, so prod/test creds never linger in `.env`. Migration workflow doctrine
(immutable applied migrations, expand/contract, migrate-before-deploy) lives in
`.claude/rules/migrations.md`; the `./promote-to-test.sh` / `./deploy-to-production.sh`
scripts enforce migrate-before-deploy.

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
- `processConfirmedOrder(id)` — same pattern but per-item VAT (not site-wide)
- `processConfirmedRentalBooking(paymentRef)` — groups bookings by paymentRef, creates invoices for the group
- `calculateOrderServiceFee(orderId)` — read-only fee calculation for orders
- `calculateTabTotal(tabId)` — dine-in tab payable amount: sum of non-voided rounds + service fee ADDED on top (orders add fee to customer total); single source for the Mollie/demo charge amount
- `processConfirmedTabPayment(tabId, opts?)` — idempotent group invoicing for a dine-in tab across all rounds (per-item VAT). Default: PARTNER + PLATFORM invoices, tab → `paid`. `{ cash: true }` (staff settle-as-cash, track 015 precedent): PARTNER-only receipt, NO commission, no paymentRef, tab → `settled_cash`. Both paths null `openTableId` (mandatory — releases the one-open-tab-per-table guard); both terminal statuses block re-processing by the other path

### Tab-order paid-ness rule (analytics)
Tab orders enter kitchen states at PLACEMENT, before payment — `order.status` does not imply paid-ness when `Order.tabId` is set. Every Order-based revenue/refund aggregation in `analytics.ts` applies: an order with `tabId != null` counts only when its tab is `paid` or `settled_cash` (`TAB_PAID_FILTER`, module-local). Non-tab orders unaffected.

### Invoice Creation Rules
- **Agent/marketplace model**: the PARTNER invoice is booked GROSS (the full price the consumer paid); the fee is never netted out of partner revenue or added to the consumer total
- Two invoices per payment: **PARTNER** (gross consumer sale, partner = merchant of record) and **PLATFORM** (B2B commission billed TO the partner — recipient fields populated; `reverseCharge` + 0 VAT for cross-border EU B2B). They do NOT sum to the consumer payment
- All prices are VAT-inclusive; reverse calculation to get base amounts
- `Invoice.processingFee` holds the (VAT-exempt) Mollie/PSP fee for reconciliation — populated by a deferred settlement-sync step
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
- **Integration tests** (`src/*.integration.test.ts`): `payment.integration.test.ts` (18 tests — processConfirmedReservation/Order, invoice creation, idempotency, hash chain, VAT, fees), `tab-payment.integration.test.ts` (23 tests — openTableId guard, calculateTabTotal, group invoicing, idempotency both directions, cash settle PARTNER-only receipt, kitchen-state preservation, void exclusion), `analytics.integration.test.ts` (incl. 5 tab-order paid-ness tests), `fee-context.integration.test.ts` (7 tests — loadFeeContext three-tier cascade), `password-reset.integration.test.ts` (15 tests — token lifecycle, rate limiting, expiry, password strength)
- **Config**: `vitest.config.ts` (unit, excludes `*.integration.test.ts`), `vitest.integration.config.ts` (integration, `fileParallelism: false` for shared DB)
- **Test helpers**: `src/test/setup.ts` (DB connection, `cleanDatabase()` via TRUNCATE CASCADE), `src/test/fixtures.ts` (factory functions for all models)

## Known Quirks
- Exports both Prisma client AND duplicated UI components (TextField, Button) — same components also exist in `@repo/ui`
- Export path typo: `"./PrismaCient"` (missing 'l' in Client)
