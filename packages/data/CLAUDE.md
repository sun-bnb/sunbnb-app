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

**`Device`** (track 019 P2 / 021) — the parasol-mounted HW devices served by the user app's `/api/hw/{code}/*`. `Device.code` is a PUBLIC 6-char Crockford-base32 identifier printed on the device's sticker; there is deliberately **no token/secret column** (Q9 — the endpoint is gated by a soft `User-Agent` client filter, not auth, because the data behind it is public occupancy). A device is placed by an **assigned ADDRESS** (`assignedSiteId`/`assignedParcel`/`assignedRow`/`assignedSeq`) set in the partner fleet UI, and answers for whatever unit occupies that address today — so a parcel rebuilt at the same spot needs no re-assignment. `status`: `provisioned → active → retired`.

**`DeviceSeat` is GONE** (dropped 2026-08-17). It bound a device to specific seat rows before resolution moved to addresses; nothing read it, and nothing held a foreign key to it, so the table drop was a single safe contract step.

**`InventoryItem.pairId` is retiring in three steps** (track 021). It is fully redundant with `SunbedGroup` — every row carrying one points at a seat in its OWN unit (2,251/2,251 dev, 216/216 test), and nothing reads it. Step 1 (done) dropped the FOREIGN KEY only, which is what the `updateMany({ pairId: null })` sweeps in the delete paths existed to protect against. Step 2 removes those sweeps and the remaining `pairId: null` writes in a code release. Step 3 drops the unique index and the column. The column cannot go earlier because `main` and `test` share one database and the branch that is behind still writes the field.

**`SunbedGroup` address** (track 021) — `parcel` + `row` (column `row_idx`; `ROW` is reserved and the inventory editor writes raw SQL) complete the unit's address alongside `seq`, under `@@unique([siteId, parcel, row, seq])`. Before this, parcel lived on `InventoryItem.group` and row was decoded out of `InventoryItem.number`, so two-thirds of a unit's address sat on its members — unconstrainable (no unique index spans two tables), resolvable only by fetching a parcel and filtering in JS, and silently re-pointable by a seat renumber. Derived from **placed seats only**: a `pool` extra carries a `nextPoolNumber` value decoding to a different row, so counting it relocates the unit. **`recomputeSeatLabels` is the only writer** — units are created bare everywhere and get their address there. A unit whose placed seats disagree (mid-rearrange) keeps its stored address rather than being given a guess; one with no placed seats surrenders it, so it cannot block the index against a real unit built on that spot later. Backfill: `npm run backfill:addresses:{local,test,production}[:dry]`, which verifies itself in raw SQL and fails if any address disagrees with the data or any `seq` moved.

**`Site.code`** (track 022) — the site's stable EXTERNAL identifier, `S-` + 6 Crockford
symbols, and the site half of the printed QR URL (`/q/S-K7M2X9/1-1-1`). Nullable during
expand, `@unique`, backfilled. Rules in `src/site-code.ts`; never rewritten once assigned.

**`Site.customBrandEnabled`** (track 023) — this site renders a BESPOKE brand page (a per-site
React module in `apps/user/brands`) instead of the standard `/s/{slug}` one. Admin-only. One of
TWO gates: the registry answers "does a bespoke page exist", this column answers "is it live",
so a merged page can sit dark and a broken one can be pulled without a deploy. On with no module
falls back to the standard page by design.

**`PlatformPreference`** — one global tunable per row (`key` → text `value`), the value
sibling of `FeatureFlag`: flags answer "does this feature exist yet", preferences answer
"with what value does it run". A row is only ever an OVERRIDE — which keys exist, their
type, bounds and default live in the `PREFERENCE_REGISTRY` in `src/preferences.ts`, so a
key dropped from the registry is inert rather than load-bearing, and a database that has
never been written to still produces the value the code was written against. Text `value`
parsed per the entry's type: one table serves every future setting with no migration per
setting.

**`src/unit-address.ts`** — pure (no prisma), the shared way to ask for a unit BY address: `unitAddressWhere` (a `findUnique` key on `UNIQUE(site_id, parcel, row_idx, seq)`), `SEGMENT_SEATS` (everything but `pool` spares), `formatUnitLocation` and its inverse `parseUnitAddress` (track 022 — reads `1-1-1` back out of a printed QR URL, and accepts the four-segment seat id `1-1-1-2` as the same unit; **syntax only, not domain bounds** — parcel 0 / row 0 are live addresses in real data, so it validates the shape and lets the DB say what exists, capping at int4 so a mistyped URL 404s instead of 500ing). Shared deliberately: a device's position is read by three parties that must agree — the HW state route serving it, the partner action assigning it, and `devicesBlockingSeatRemoval` refusing to delete the seats under it. Each used to re-derive the address itself, which is how a device, the UI that assigned it and the guard protecting it could hold three different opinions about where it was.

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
npm run device:provision -- --partner <partnerAccountId>   # local; :test / :production are env-tiered
```
Mints the `Device` row and prints the code for the sticker. It does **not** place the device:
position is an address assigned in the partner fleet UI once the unit is on a pole. It used to
require `--seats <itemId,itemId>` and write `DeviceSeat` rows — but nothing read those once
resolution moved to addresses, and it left the assigned address null, so every device it
provisioned was declined on its first poll until someone assigned it anyway. The flag was pure
ceremony and is gone; it also matches the model, since whoever runs this at a bench has no
business knowing which parasol a unit ends up under. Flags: `--partner` (whose fleet list it
appears in — without it nobody can see it to assign it), `--code` (reuse a code on a board swap),
`--mac`, `--dry-run`. Retries on the `code` unique collision, except when `--code` was explicit
(retrying would mint a code that differs from the sticker). There is no secret to hand over (Q9),
which is why this is short.

## Site Codes (`src/site-code.ts`) — track 022

Pure, client-safe (no prisma, no env): the **site half of the printed QR URL**
(`/q/S-K7M2X9/1-1-1`). `SITE_CODE_PREFIX` (`S-`, so a site, partner (`P-`) and device
(bare) code can't be confused in a support call), `SITE_CODE_BODY_LENGTH` (6 = 32^6 ≈
1.07e9), `generateSiteCode` (CSPRNG + 5-bit mask over `DEVICE_CODE_ALPHABET`, random never
sequential), `normalizeSiteCode` (uppercase, `I`/`L`→`1`, `O`→`0`, `U`→`V`, prefix restored
whether given or not — so a hand-typed lowercase URL still resolves), `isValidSiteCode`,
`isSiteCodeCollision` (P2002 attributed to `code` — every writer mints optimistically and
retries, and must NOT swallow the other unique constraints on `Site`).

Why a site needs an external id: `Site.id` is a 25-char cuid — half of the old 80-char POS
URL, and therefore half of the card's QR-density problem. **Not `slug`**: partner-editable
(a rename kills every printed card), variable-length, no uniqueness constraint.

The **round trip** (`normalize(generate()) === generate()`) is the load-bearing test, for the
same reason as the device code: minting and lookup sit on opposite sides of a card glued to
a lounger. `SITE_CODE_BODY_LENGTH` is deliberately its own constant, not a reuse of
`DEVICE_CODE_LENGTH` — the 4 characters of slack under the QR version-3 cap are reserved
for a longer unit ADDRESS (a venue past parcel 99), not for the fleet to spend.

**Minting**: `apps/partner/lib/site-create.ts` `createSiteWithCode` — both partner creation
paths (the wizard and `submitForm`) route through it. Backfill for existing rows:
`npm run backfill:site-codes:{local,test,production}[:dry]` (fills NULLs only — never
rewrites a code, which would orphan every card already printed for that venue).

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
- `src/preferences.ts` — **platform preferences** (admin app → `/preferences`): registry-driven
  global tunables. `PREFERENCE_REGISTRY` (key · type · label · group · bounds · default) is the
  source of truth; resolution is env var (`PREF_<UPPER_SNAKE_KEY>`) → `platform_preference` row →
  registry default. `getPreference` / `getPreferenceCached` (5-min per-instance cache, for hot
  paths) / `setPreference` (validates, invalidates the cache) / `getPreferenceAdminRows`.
  **Values are validated on the way in AND on the way out** — the setter explains a rejection to
  the admin, the reader silently falls back to the default, because a row can outlive a bounds
  change or arrive by direct SQL and its consumers are in the field. First entry:
  `device-poll-interval-sec` (default 60) — the HW poll cadence the user app's
  `/api/hw/{code}/state` serves as `pollAfterSec`, formerly a constant in that route

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
  math), `reservation-machine-guard.test.ts` (single-writer ratchet), `device-code.test.ts` (14 — HW code alphabet/generation/normalisation, incl. the mint↔lookup round trip and unbiased byte mapping), `preferences.test.ts` (30 — registry/env/DB/default resolution, and the property that matters: an out-of-range or unparseable value NEVER reaches a consumer, it falls through to the shipped default; plus cache TTL + write invalidation), `scripts/scale-fixture-guard.test.ts` (17 — destructive-write target guard for the track-020 scale harness: refuses `sunbnb_test`, the dev DB, and every remote host, each asserted to survive `--force`), `unit-address.test.ts` (40 — unit address derivation + `parseUnitAddress` round trip/rejection: placed-seats-only (a pool extra must not relocate the unit), absent status = placed, declines rather than guesses when a unit's seats disagree about parcel or row, and one ordinal can never be claimed twice in a row. Both defects were injected back into the source to confirm the tests catch them — 2 failures each, no collateral)
- **Integration tests** (`src/*.integration.test.ts`): `payment.integration.test.ts` (18 tests — processConfirmedReservation/Order, invoice creation, idempotency, hash chain, VAT, fees), `tab-payment.integration.test.ts` (29 tests — openTableId guard, calculateTabTotal, group invoicing, idempotency both directions, cash settle PARTNER-only receipt, kitchen-state preservation, void exclusion, standalone-restaurant block: null-siteId tabs, account/settings-tier fees, partner-anchored invoicing), `analytics.integration.test.ts` (incl. 5 tab-order paid-ness tests), `till.integration.test.ts` (79 tests — two-bucket window math, day-boundary inclusivity, closeEmployeeTill sweep + carry-over snapshot, void handling), `fee-context.integration.test.ts` (19 tests — loadFeeContext three-tier cascade + loadRestaurantFeeContext: empty site tier, account-tier override, bootstrap), `password-reset.integration.test.ts` (15 tests — token lifecycle, rate limiting, expiry, password strength), `reservation-machine-apply.integration.test.ts` (20 — settle/unreserve/split/undo-depart/GC/collect executors: till partition, money-rows-kept, I2 end-to-end, I4 defense, paid-race abandon), `credit-note.integration.test.ts` (6 — negative twin, chain link, capped partials, series independence), `unit-address.integration.test.ts` (11 — `recomputeSeatLabels` as address writer, checked against a RAW-SQL oracle that derives the address the pre-column way: idempotency, no seq ever moves, pool-only unit stays unaddressed, address follows a genuine row change, is surrendered when the unit stops standing anywhere, is held rather than clobbered mid-rearrange, and the unique constraint refusing a second unit on one spot while allowing the same address at another site), `device-guard.integration.test.ts` (8 — `devicesBlockingSeatRemoval`: refuses to delete a unit's last placed seat while a device is assigned to it, allows it while a sibling survives, still refuses when only a `pool` spare would be left, and ignores devices at the same address on another site or in a different ROW of the same parcel. Two defects — dropping the row from the device match, and counting spares as survivors — were injected to confirm the tests catch them)
- **Config**: `vitest.config.ts` (unit, excludes `*.integration.test.ts`), `vitest.integration.config.ts` (integration, `fileParallelism: false` for shared DB)
- **Test helpers**: `src/test/setup.ts` (DB connection, `cleanDatabase()` via TRUNCATE CASCADE), `src/test/fixtures.ts` (factory functions for all models)

## Known Quirks
- Exports both Prisma client AND duplicated UI components (TextField, Button) — same components also exist in `@repo/ui`
- Export path typo: `"./PrismaCient"` (missing 'l' in Client)
