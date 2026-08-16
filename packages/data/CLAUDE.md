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

**`Device` / `DeviceSeat`** (track 019 P2) — the parasol-mounted HW devices served by the user app's `/api/hw/{code}/*`. `Device.code` is a PUBLIC 6-char Crockford-base32 identifier printed on the device's sticker; there is deliberately **no token/secret column** (Q9 — the endpoint is gated by a soft `User-Agent` client filter, not auth, because the data behind it is public occupancy). `DeviceSeat` binds seats to a device with `position` = **mount order** (0 = leftmost LED segment), stored explicitly and never derived from `SunbedGroup`: the binding is a *physical installation* fact, a group is a *booking* fact, and deriving one from the other over-scopes wherever grouping ≠ shading. `status`: `provisioned → active → retired`.

## Payment Service (`src/payment.ts`)

### Pure Functions (no DB, no side effects)
- `round(amount)` — financial rounding to 2 decimals
- `computeVatAndBaseAmounts(gross, vatRate)` — reverse VAT: `base = round(gross / (1 + rate/100))`
- `resolveServiceFee(siteFees, accountFees, settingsFees, serviceCode, tier?)` — three-tier cascade, first match wins
- `calculateServiceFeeAmount(fee, referenceAmount)` — fixed (`feeAmount`) or percentage calculation
- `computeInvoiceHash(number, date, amount, vatNumber, previousHash)` — SHA-256 chain for invoice integrity

### DB-Dependent Functions
- `loadFeeContext(siteId, serviceCode)` — loads site + partnerAccount + settings fees; bootstraps default Settings if missing (bootstrap shared with the restaurant loader via a private `ensureSettingsAndFee`)
- `loadRestaurantFeeContext(restaurantId, serviceCode)` — dine-in v2: partner resolved directly via `Restaurant.partnerAccountId` (a User.id), EMPTY site tier — cascade is partnerAccount → settings. For standalone (no-Site) restaurants
- `loadTabFeeContext(tab: { siteId, restaurantId }, serviceCode)` — branches: linked tab (siteId set) → `loadFeeContext` (site rail, byte-identical); standalone → `loadRestaurantFeeContext`. Returns `TabFeeContext { siteFees, partnerAccount, settings, tier }`
- `processConfirmedReservation(id)` — idempotent invoice creation: 2 invoices (partner + platform), per-sunbed lines + fee lines, sequential numbering with FOR UPDATE lock, hash chain, sends confirmation email
- `processConfirmedOrder(id)` — same pattern but per-item VAT (not site-wide)
- `processConfirmedRentalBooking(paymentRef)` — groups bookings by paymentRef, creates invoices for the group
- `calculateOrderServiceFee(orderId)` — read-only fee calculation for orders
- `issueCashCreditNote(reservationId, {amount?, invoicedAt?})` — credit note against a
  reservation's PARTNER cash receipt (track 018/015): NEGATIVE-total PARTNER invoice in
  its own `PARTNER-CN-YYYY-NNNNN` series, same hash chain, `creditsInvoiceId` link, VAT
  at the receipt's effective rate, partial credits capped at the receipt total.
  Existing PARTNER revenue aggregations net refunds automatically
- `calculateTabTotal(tabId)` — dine-in tab payable amount: sum of non-voided rounds — **menu prices only** (the commission is computed in parallel in the result's `serviceFee` for the Mollie applicationFee/PLATFORM invoice, never added to the customer total — uniform with reservations since 2026-07-25); single source for the Mollie/demo charge amount. Site-agnostic since dine-in v2 (fee context via `loadTabFeeContext`)
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

## Reservation State Machine (`src/reservation-machine.ts` + `-apply.ts`) — track 018

Reservation state is a COMPOUND (kind × pay-phase × occupancy) derived from storage; the
machine makes it explicit and is the ONLY sanctioned writer of reservation state fields.

- **`reservation-machine.ts`** (pure, CLIENT-SAFE — no prisma; also backs the partner
  grid's `bed-state.ts`): `deriveState(input) → { kind, pay, occ, released }` (kinds:
  online · walkin · hold · comp · block — disambiguates the overloaded `paid-in-cash`);
  `TRANSITIONS` — the founder-signed transition table as data (events × pre-state →
  post + named effect keys; anything unmatched is a MUST-REJECT cell);
  `resolveTransition`, `storageForState`/`opForOcc` (writer = reader's inverse),
  `partitionAmount` (largest-remainder cents — splits can never create/destroy money).
- **`reservation-machine-apply.ts`** (server-only interpreter):
  `applyTransition(reservationId, event, opts)` — load → deriveState → resolveTransition
  (typed rejection) → effect executors. Conditions (hasFutureDays/sameCivilDay/expired/
  subset…) are interpreter-computed FACTS; callers pass only intent (`itemIds`, `cash`,
  `amount`, a `buildRedirectUrl` builder, a `refund` handler). Executors: day-row +
  parent mirror (atomic), till record/void/PARTITION (splits carry the money with the
  seats), receipts + credit notes, split lineage (`splitFromId`), collect flow
  (demo/Mollie, abandon NEVER frees a bed), providerRefund, I4 delete defense (any
  till/invoice history — voided included — blocks hard delete).
- **`reservation-machine-guard.test.ts`** — single-writer ratchet: scans all apps for
  reservation state writes outside the sanctioned modules; exact-equality shrink-only
  allowlist (currently: cron sweep 1 — I4-filtered by design — + manage/actions.ts 8).
- Contract + design record: `.claude/tracks/018-state-machine-intended.md` (invariants
  I1–I7, decision record); de facto history: `018-state-machine-defacto.md`.
- Consumers: partner manage/frontdesk/reservation-detail actions, user-app webhook/
  poll/reconcile/cancel/delete/demo-initiate, partner matrix
  (`state-machine-matrix.integration.test.ts`) drives real actions against the table.

## HW Device Codes (`src/device-code.ts`) — track 019

Pure, client-safe (no prisma, no env): `DEVICE_CODE_ALPHABET` (Crockford base32 — `0-9A-Z` minus
`I L O U`; the ambiguous glyphs are out because a human reads a code aloud from a windy beach, `U`
so a sticker can't mint an obscenity), `DEVICE_CODE_LENGTH` (6 ≈ 1.07e9), `generateDeviceCode`
(CSPRNG + 5-bit mask — 256 is a multiple of 32, so no modulo bias; random NEVER sequential, which
would leak fleet size), `normalizeDeviceCode` (uppercase, `I`/`L`→`1`, `O`→`0`), `isValidDeviceCode`.

**The route re-exports `normalizeDeviceCode` rather than re-implementing it** (`hw-filter.ts`
`normalizeCode`): minting and lookup sit on opposite sides of a sticker glued to a potted device,
so a code minted under different folding rules than the route normalises by is permanently
unreachable. The round trip (`normalize(generate()) === generate()`) is the load-bearing test.

### Provisioning script (`scripts/provision-device.ts`) — track 019 P3

```bash
npm run device:provision -- --seats <itemId,itemId>   # local; :test / :production are env-tiered
```
Creates the `Device` row + `DeviceSeat` binding and prints the code for the sticker. `--seats` is
**LED MOUNT ORDER** (first id = leftmost segment, a physical fact — not a sort). Flags: `--code`
(reuse a code on a board swap), `--mac`, `--dry-run`. Validates BEFORE writing — unknown ids, seats
spanning >1 site (the state route rejects those), seats already under another device — because each
of those otherwise surfaces in the field as a silent amber LED. Retries on the `code` unique
collision, except when `--code` was explicit (retrying would mint a code that differs from the
sticker). There is no secret to hand over (Q9), which is why this is ~100 lines.

## Password Reset (`src/password-reset.ts`)

- `requestPasswordReset(email, appBaseUrl)` — SHA-256 hashed token, validates origin against `ALLOWED_ORIGINS`, max 3/hour per email, invalidates previous tokens, sends via Resend
- `resetPassword(token, password)` — verifies hashed token, checks expiry, enforces password strength (8+ chars, upper+lower+digit), bcrypt update in transaction
- `hashToken(raw)` — pure SHA-256 helper
- `passwordResetEmailHtml(url, hours)` — pure HTML template

## Rate Limiter (`src/rate-limit.ts`)

- `rateLimit(key, { maxAttempts, windowMs })` — in-memory sliding-window, cleanup every 5 min
- Per-process only (resets on serverless cold start)

## Till (`src/till.ts`)

Day-anchored per-worker cash till (tracks 008/013/016). `TillEntry` is the cash ledger
(`recordSettlement` / `voidSettlementsFor*`); `TillClose` rows are irreversible hand-in
snapshots. The open till is **two-bucketed** against a caller-supplied venue-local
`dayStart` (module is timezone-agnostic): **today** = non-voided entries since
`max(lastClose, dayStart)`; **carryOver** = unclosed entries from before today
(`(lastClose, dayStart]`, `oldestAt` labeled). `total` = today + carryOver = the sweepable
balance — a close always sweeps both (cash never orphaned). `closeEmployeeTill` is the
single snapshot writer (records `carryOverAmount`/`carryOverCount` on `TillClose`);
`closeAllOpenTills` builds on it and returns `carryOverClosed`. Civil-day reports
(`getTillByEmployee` → `EmployeeCashTotal[]`, `getEmployeeShiftItems`) sum by `settledAt`
window and are **close-independent** — daily accumulation never changes when tills close.

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

### Scale benchmark harness (track 020)

```bash
docker exec sunbnb-postgres psql -U postgres -c "CREATE DATABASE sunbnb_scale;"
npm run scale:setup    # migrate deploy → sunbnb_scale
npm run scale:seed     # deterministic fixture (flags: --parcels --seats --control-sites
                       #   --control-seats --history-months --history-per-month)
npm run scale:bench    # EXPLAIN ANALYZE the app's real query shapes (--json, --plans)
npm run scale:reset    # drop fixture data, keep the schema
```

A **separate `sunbnb_scale` DB** — never `sunbnb_test`, which the integration suites TRUNCATE
between files. `seed-scale-fixture.ts` truncates before seeding, so its target guard
(`scripts/scale-fixture-guard.ts`, unit-tested) refuses any non-local host and any database
off the allowlist **even with `--force`**. Measured baselines and the rejected-index record
live in `.claude/tracks/020-scale-baseline.md`.

Volume is not optional: Postgres prefers a sequential scan on a small table regardless of
indexes, so an index change is unobservable on a near-empty DB.

- **Unit tests** (`src/*.test.ts`): `payment.test.ts` (round, VAT, fee cascade, fee
  calculation), `rate-limit.test.ts`, `reservation-status.test.ts`,
  `reservation-machine.test.ts` (37 — deriveState kind/pay/occ mapping, allowed +
  must-reject cells, table properties incl. deletes-confined-to-zero-money, partition
  math), `reservation-machine-guard.test.ts` (single-writer ratchet), `device-code.test.ts` (14 — HW code alphabet/generation/normalisation, incl. the mint↔lookup round trip and unbiased byte mapping), `scripts/scale-fixture-guard.test.ts` (17 — destructive-write target guard for the track-020 scale harness: refuses `sunbnb_test`, the dev DB, and every remote host, each asserted to survive `--force`)
- **Integration tests** (`src/*.integration.test.ts`): `payment.integration.test.ts` (18 tests — processConfirmedReservation/Order, invoice creation, idempotency, hash chain, VAT, fees), `tab-payment.integration.test.ts` (29 tests — openTableId guard, calculateTabTotal, group invoicing, idempotency both directions, cash settle PARTNER-only receipt, kitchen-state preservation, void exclusion, standalone-restaurant block: null-siteId tabs, account/settings-tier fees, partner-anchored invoicing), `analytics.integration.test.ts` (incl. 5 tab-order paid-ness tests), `till.integration.test.ts` (79 tests — two-bucket window math, day-boundary inclusivity, closeEmployeeTill sweep + carry-over snapshot, void handling), `fee-context.integration.test.ts` (19 tests — loadFeeContext three-tier cascade + loadRestaurantFeeContext: empty site tier, account-tier override, bootstrap), `password-reset.integration.test.ts` (15 tests — token lifecycle, rate limiting, expiry, password strength), `reservation-machine-apply.integration.test.ts` (20 — settle/unreserve/split/undo-depart/GC/collect executors: till partition, money-rows-kept, I2 end-to-end, I4 defense, paid-race abandon), `credit-note.integration.test.ts` (6 — negative twin, chain link, capped partials, series independence)
- **Config**: `vitest.config.ts` (unit, excludes `*.integration.test.ts`), `vitest.integration.config.ts` (integration, `fileParallelism: false` for shared DB)
- **Test helpers**: `src/test/setup.ts` (DB connection, `cleanDatabase()` via TRUNCATE CASCADE), `src/test/fixtures.ts` (factory functions for all models)

## Known Quirks
- Exports both Prisma client AND duplicated UI components (TextField, Button) — same components also exist in `@repo/ui`
- Export path typo: `"./PrismaCient"` (missing 'l' in Client)
