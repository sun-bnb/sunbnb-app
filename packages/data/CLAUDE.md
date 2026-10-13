# Data Package (packages/data)

`@repo/data` — shared Prisma schema, DB client, payment logic, auth helpers, email, and business
utilities. The single source of truth for all database access and core business logic.

**Pulled on demand** (not auto-loaded — read the one that matches your task):

- `packages/data/EXPORTS.md` — per-module detail: payment providers, state machine, printed codes,
  invoicing documents, preferences/devices, assistant SQL sandbox
- `packages/data/REFERENCE.md` — model histories, identifier conventions, in-flight retirements
- `packages/data/TESTING.md` — test inventory, config split, scale harness, shared-DB etiquette
- Wiki: `.claude/wiki/subsystems/{payments,reservation-state-machine,employee-till,migrations}.md`

## Commands

```bash
cd packages/data
npm run migrate:local        # local Docker DB — prisma migrate dev + generate, then migrate deploy to sunbnb_test (lockstep)
npm run migrate:test         # Neon test DB — POSTGRES_URL_TEST via scripts/with-db-url.sh, prisma migrate deploy
npm run migrate:production   # Neon prod DB — POSTGRES_URL_PRODUCTION via scripts/with-db-url.sh, prisma migrate deploy
npm run migrate:check        # fails (exit 2) if schema.prisma has changes no committed migration captures
npm run migrate:status:{local,test,production}   # pending / failed / checksum-drift per environment
source .env.local && npx prisma studio   # Prisma Studio
source .env.local && ./sync-local-db.sh  # Sync local DB from test
```

`migrate:test`/`:production`/`:status:*`/`:check` route the right DB URL from `.env.local`
through `scripts/with-db-url.sh` as an **inline `POSTGRES_URL` override** — `.env` is never
rewritten, so prod/test creds never linger in `.env`. Doctrine: `.claude/rules/migrations.md`
(rules) · `.claude/wiki/subsystems/migrations.md` (topology + sequence); the
`./promote-to-test.sh` / `./deploy-to-production.sh` scripts enforce migrate-before-deploy.

## Schema

`packages/data/prisma/schema.prisma` — 70+ migrations, `@prisma/adapter-pg` driver adapter, PostGIS (`geometry` +
GiST index) for spatial queries.

Core models: User, PartnerAccount, Site, InventoryItem, SunbedGroup, Reservation, ReservationDay,
Order, OrderItem, RentalItem, RentalBooking, Restaurant, Table, TableTab, MenuItem, Invoice,
InvoiceLine, Settlement, ServiceFee, Settings, Employee, TillEntry, TillClose, Device,
PlatformPreference, FeatureFlag, SecurityToken, PasswordResetToken, Product.

**Read `REFERENCE.md` before touching** `Site.code`, the `SunbedGroup` address
(`parcel`/`row_idx`/`seq`), `InventoryItem.pairId`, `Device` placement, brand manifests,
`PlatformPreference` vs `FeatureFlag`, or the `unit-address` helpers — several carry constraints
not visible in the schema.

## Payment Service (`src/payment.ts`)

### Pure functions (no DB, no side effects)
- `round(amount)` — financial rounding to 2 decimals
- `computeVatAndBaseAmounts(gross, vatRate)` — reverse VAT: `base = round(gross / (1 + rate/100))`
- `resolveServiceFee(siteFees, accountFees, settingsFees, serviceCode, tier?)` — three-tier cascade, first match wins
- `calculateServiceFeeAmount(fee, referenceAmount)` — fixed (`feeAmount`) or percentage calculation
- `serviceFeeForUnits(fee, { total, units })` — THE commission rule for every charge-time fee
  (Mollie `applicationFee`, Stripe `application_fee_amount`, Viva `isvAmount`) AND every PLATFORM
  invoice, so collected === invoiced. Fixed fee: per unit (bed / rental booking line); percentage:
  once on the total paid. Reservation units = items, rental units = bookings. Orders/tabs/deposits
  use `calculateServiceFeeAmount` (single unit, identical result). Pinned by
  `payment.commission-parity.integration.test.ts`.
- `computeInvoiceHash({ seriesKey, invoiceNumber, invoicedAt, totalAmount, issuerVatNumber,
  previousHash })` — versioned SHA-256 chain (`invoice-series.ts`); `seriesKey` binds a record to its issuer's chain

### DB-dependent functions
- `loadFeeContext(siteId, serviceCode)` — site + partnerAccount + settings fees; bootstraps default
  Settings if missing (shared with the restaurant loader via private `ensureSettingsAndFee`)
- `loadRestaurantFeeContext(restaurantId, serviceCode)` — dine-in v2: partner via
  `Restaurant.partnerAccountId` (a User.id), EMPTY site tier (partnerAccount → settings); standalone restaurants
- `loadTabFeeContext(tab: { siteId, restaurantId }, serviceCode)` — linked tab → `loadFeeContext`;
  standalone → `loadRestaurantFeeContext`. Returns `TabFeeContext { siteFees, partnerAccount, settings, tier }`
- `processConfirmedReservation(id)` — idempotent invoicing: PARTNER + PLATFORM, per-sunbed + fee
  lines, series numbering (`allocateInvoiceIdentity`), hash chain, confirmation email
- `processConfirmedOrder(id)` — same pattern, per-item VAT (not site-wide)
- `processConfirmedRentalBooking(paymentRef)` — groups bookings by paymentRef, invoices the group
- `calculateOrderServiceFee(orderId)` — read-only fee calculation for orders
- `issueCashCreditNote(reservationId, {amount?, invoicedAt?})` — credit note against a reservation's
  PARTNER cash receipt (tracks 018/015): NEGATIVE-total PARTNER invoice in its own
  `PARTNER-CN-YYYY-NNNNN` series, same hash chain, `creditsInvoiceId` link, VAT at the receipt's
  effective rate, partials capped at the receipt total. PARTNER revenue aggregations net refunds automatically
- `calculateTabTotal(tabId)` — dine-in tab payable: sum of non-voided rounds, **menu prices only**;
  the commission rides in parallel in `serviceFee` (Mollie applicationFee / PLATFORM invoice), never
  added to the customer total. Single source for the Mollie/demo charge amount. Site-agnostic
- `processConfirmedTabPayment(tabId, opts?)` — idempotent group invoicing across all rounds
  (per-item VAT). Default: PARTNER + PLATFORM, tab → `paid`. `{ cash: true }`: PARTNER-only receipt,
  NO commission, no paymentRef, tab → `settled_cash`. Both paths null `openTableId` (mandatory —
  releases the one-open-tab-per-table guard); each terminal status blocks the other path

### Tab-order paid-ness rule (analytics)
Tab orders enter kitchen states at PLACEMENT, before payment — `order.status` does not imply
paid-ness when `Order.tabId` is set. Every Order-based revenue/refund aggregation in `analytics.ts`
counts a `tabId != null` order only when its tab is `paid` or `settled_cash` (`TAB_PAID_FILTER`).

### Invoice creation rules
- **Agent/marketplace model**: PARTNER invoice booked GROSS; the fee is never netted out of partner
  revenue or added to the consumer total (`.claude/rules/payments.md`)
- Two invoices per payment: **PARTNER** (gross sale, partner = merchant of record) and **PLATFORM**
  (B2B commission billed TO the partner; `reverseCharge` + 0 VAT cross-border EU B2B). They do NOT
  sum to the consumer payment
- All prices VAT-inclusive; reverse calculation for base amounts
- `Invoice.processingFee` (VAT-exempt PSP fee) — **Stripe refs only**, on the PLATFORM invoice with a
  `payment-processing` line (`platformPassThroughFor`). Mollie/Viva leave it empty
- **Zero commission**: every `processConfirmed*` writes the PLATFORM invoice only when
  `commission > 0 || passThrough > 0` — a zero-commission Stripe payment still gets a
  processing-only PLATFORM invoice; zero-commission Mollie/Viva get none (PARTNER invoice only)
- Invoice numbers: one series per issuer (`seriesKey`, F/R codes, year from `invoicedAt`),
  serialised by `lockInvoiceSeries` (`pg_advisory_xact_lock`) at the TOP of the invoicing
  transaction + an `InvoiceSeries` counter row; each hash includes the previous (`InvoiceChain`)

## Payment providers (track 028)

One consumer rail per `PartnerAccount` (selected), mirrored onto `Site.paymentProvider`
(effective, via `syncEffectiveProvider`). `processConfirmed*` is provider-neutral; coupling lives in
create / confirm / refund / connect, keyed off the ref prefix. **No `Payment` ledger — the prefix
is the only discriminator** (`payment-refs.ts`, PURE): `tr_` mollie · `pi_demo_` demo · `viva_`
viva-terminal · `vso_` viva (online) · `stripe_cs_` stripe · `stripe_pi_` stripe-terminal.

Modules: `payment-refs`, `payment-providers/*`, `checkout`, `stripe/*` (server-only, the only
`stripe` SDK import), `viva/checkout-*`. Module detail → `EXPORTS.md` § Payment providers;
end-to-end → `.claude/wiki/subsystems/payments.md`.

## Status Constants (`src/reservation-status.ts`)

Single source of truth. Status fields are plain String columns (not enums). Import as `@repo/data/reservation-status`.

- **Reservation payment**: PENDING → PROCESSING → COMPLETE (or PAYMENT_FAILED / CANCELED / REFUNDED);
  off-platform: PAID_IN_CASH (`'paid-in-cash'`), HELD (unpaid hold, blocks). `PAID_STATUSES` = complete only
- **Reservation operational**: EXPECTED → CHECKED_IN → DEPARTED (also: WALKED_IN, NO_SHOW, COMP);
  `'blocked'` (out of service) is a manage-grid item state, not a constant here
- **Order**: PENDING → PROCESSING → COMPLETE → ACCEPTED → PREPARING → READY → DELIVERED → COMPLETED (or REJECTED / DISCARDED / CANCELED / REFUNDED)
- **Rental payment**: PENDING → PROCESSING → COMPLETE (or PAYMENT_FAILED / CANCELED / REFUNDED)
- **Rental operational**: RESERVED → PICKED_UP → RETURNED
- Semantic groupings: `BLOCKING_STATUSES`, `PAID_STATUSES`, `TERMINAL_STATUSES`, `RESERVATION_STATUSES`

## Reservation State Machine (track 018)

`reservation-machine.ts` (pure, client-safe: `deriveState`, `TRANSITIONS`, `resolveTransition`) +
`reservation-machine-apply.ts` (server-only `applyTransition`) — the ONLY sanctioned writer of
reservation state fields; `reservation-machine-guard.test.ts` is a shrink-only single-writer
ratchet over all apps. Add behaviour by editing the table, never with a guard inside an action.
Detail → `EXPORTS.md`; model + invariants I1–I7 → `.claude/wiki/subsystems/reservation-state-machine.md`.

## Printed codes (`device-code.ts`, `site-code.ts`, `partner-code.ts`) — tracks 019 / 022

Pure, client-safe Crockford-base32 identifiers (`S-` site, `P-` partner, bare device), CSPRNG,
never sequential. The load-bearing test is the round trip `normalize(generate()) === generate()` —
mint and lookup sit on opposite sides of a printed sticker/card, so apps import the `normalize*`
helpers, never re-implement them. `Site.code` is never rewritten once assigned. Minting,
provisioning script (`npm run device:provision`), backfill → `EXPORTS.md`.

## Password Reset (`src/password-reset.ts`)

- `requestPasswordReset(email, appBaseUrl)` — SHA-256 hashed token, validates origin against `ALLOWED_ORIGINS`, max 3/hour per email, invalidates previous tokens, sends via Resend
- `resetPassword(token, password)` — verifies hashed token, checks expiry, enforces password strength (8+ chars, upper+lower+digit), bcrypt update in transaction
- `hashToken(raw)` — pure SHA-256 helper; `passwordResetEmailHtml(url, hours)` — pure HTML template

## Rate Limiter (`src/rate-limit.ts`)

`rateLimit(key, { maxAttempts, windowMs })` — in-memory sliding window, cleanup every 5 min.
Per-process only (resets on serverless cold start).

## Till (`src/till.ts`)

Day-anchored per-worker cash till (tracks 008/013/016): `TillEntry` ledger, irreversible `TillClose`
snapshots, two buckets (today + carry-over) against a caller-supplied venue-local `dayStart`;
`closeEmployeeTill` is the single snapshot writer. → `.claude/wiki/subsystems/employee-till.md`.

## Other exports

| Module | Purpose |
|---|---|
| `invoice-fiscal` | the one AEAT QR builder — regime via issuer jurisdiction, never `invoice.account` |
| `commission-invoice(-model)` | our B2B commission invoice as a document; ownership scoped in the loader |
| `reservation-emails` · `email` | confirmation/reminder/cancellation emails · shared Resend sender |
| `subscription` · `business-entity` | partner tiers · platform invoicing entity |
| `preferences` | platform tunables: env `PREF_*` → DB row → registry default; validated in AND out |
| `device-power` · `device-wifi` · `device-telemetry` | power bands + cascade · Wi-Fi rules + broadcast · retention sweep |

Detail and rationale for each → `EXPORTS.md`.

## Partner AI assistant (`src/assistant.ts`) — track 030

`@repo/data/assistant` — server-only persistence for `AssistantConversation`, `AssistantAction`,
`AssistantUpload`. **Every reader/writer is ACCOUNT-SCOPED** (`accountId` always in the predicate,
so another account's id behaves like a missing row). `ASSISTANT_ACTION_STATUS` plain strings, pure
`canTransition` + compare-and-set in each UPDATE so two racing requests cannot both apply. TTLs,
conversation and aerial helpers → `EXPORTS.md`.

**SQL sandbox** (`src/assistant-claim.ts`, D1): model-written SQL runs as Postgres role
`assistant_reader` over allowlisted `assistant.*` views (RLS + column grants + HMAC site claim), so
isolation holds even if the app's SQL checker is bypassed. `runAssistantSql` is the only runner.
Views pin base-table columns (`.claude/rules/migrations.md`). Role, views, env, ops → `EXPORTS.md`.

## Coastline lookup (`coastline-lookup`, `coastline-overpass`) — track 027 → 030 S7a

`shoreAround(lat, lng, radiusM)` — DB-then-Overpass shoreline lookup shared by marketing
`/api/coastline` and the assistant's aerial land check. Needs `COASTLINE_POSTGRES_URL` (throws
without it; callers skip the land check). An Overpass answer counts only if complete. → `EXPORTS.md`.

## Testing

```bash
npm run test                    # unit — pure logic, no DB, no mocking
npm run test:integration        # requires local sunbnb_test DB
npm run test:integration:setup  # prisma migrate deploy against sunbnb_test
npx tsc --noEmit                # real typecheck gate (tsconfig rootDir "."); no npm script — run with lint
```

The local `sunbnb_test` DB is shared, mutable state across sessions — run integration suites
serially, one agent at a time (`TESTING.md` § Shared test DB). A separate `sunbnb_scale` DB backs
the track-020 benchmark (`npm run scale:*`); its guard refuses any non-local host even with `--force`.

## Known Quirks
- Exports both Prisma client AND duplicated UI components (TextField, Button) — same components also exist in `@repo/ui`
- Export path typo: `"./PrismaCient"` (missing 'l' in Client)
