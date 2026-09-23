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

Prisma schema at `packages/data/prisma/schema.prisma` — 70+ migrations, `@prisma/adapter-pg` driver
adapter, PostGIS (`geometry` + GiST index) for spatial queries.

Core models: User, PartnerAccount, Site, InventoryItem, SunbedGroup, Reservation, ReservationDay,
Order, OrderItem, RentalItem, RentalBooking, Restaurant, Table, TableTab, MenuItem, Invoice,
InvoiceLine, Settlement, ServiceFee, Settings, Employee, TillEntry, TillClose, Device,
PlatformPreference, FeatureFlag, SecurityToken, PasswordResetToken, Product.

**Model histories, identifier conventions and in-flight retirements** — why `Site.code` exists and
is never rewritten, the `SunbedGroup` address (`parcel`/`row_idx`/`seq`) and its single writer, the
three-step `InventoryItem.pairId` retirement, `Device` placement by address, brand-manifest gating,
`PlatformPreference` vs `FeatureFlag`, and the shared `unit-address` helpers: **`packages/data/REFERENCE.md`**.
Read it before touching any of those — several carry constraints that are not visible in the schema.

Migration doctrine: `.claude/rules/migrations.md` (rules) · `.claude/wiki/subsystems/migrations.md`
(topology + sequence).

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
  change or arrive by direct SQL and its consumers are in the field. Types are `number` ·
  `boolean` · `string` · `enum` (a closed set rendered as a dropdown; the stored value is the
  WIRE ID, never the label, because the id travels to a potted device). Entries:
  `device-power-mode` (enum, default `deep_sleep`) and `device-poll-interval-sec` (default 60) —
  the power policy the user app's `/api/hw/{code}/state` serves as `powerMode` + `pollAfterSec`,
  both formerly constants in that route.
  **These two are the one COUPLED pair in an otherwise flat registry**: each mode can only keep
  its own band of cadences (track 025), so `setPreference` refuses an interval the active mode
  cannot serve and RE-FITS the stored interval when the mode changes, and
  `getPreferenceAdminRows` reports the interval a device would actually get rather than the
  stored one. The coupling lives in this module, not the admin form, so a script obeys it too.
  `setDevicePolicy(mode, interval, adminId)` is the PAIRED writer the admin form uses: it
  validates the interval against the mode *being saved* (not the stored one) and upserts both
  keys in one `$transaction`, so the poll route can never read a switched mode beside the old
  interval. It REFUSES rather than re-fits, because a caller that can see both values is
  choosing, not drifting — the silent re-fit stays only on the single-key path, where the
  caller does not know about the other key. `resetDevicePolicy()` drops both rows together.
  `getPlatformDevicePolicy()` reads the pair RAW through the cache — the poll route and the
  partner fleet query both call it, and hand it to `resolveDevicePolicyForDevice` together with
  the device's own override (`Device.powerMode` / `pollIntervalSec`), so the platform value is
  now a DEFAULT rather than the fleet's policy. Note the deliberate asymmetry: a platform change
  reaches a device within the 5-min cache TTL plus one poll, a per-device override on its very
  next poll (it rides the device row the route already reads) — do not "fix" that by caching the
  override. Third entry, uncoupled: `device-telemetry-retention-days` (default 365) bounds the
  `device_telemetry` series and is the ONLY thing that does, so treat it as a storage budget —
  shortening it DELETES history on the next daily sweep and cannot be undone. Writes are
  unthrottled, so ~2.2M rows/day at a 1500-unit fleet on a 60 s cadence: shorten it before then
- `src/device-telemetry.ts` — the retention sweep for `device_telemetry`, the time series behind
  `Device`'s telemetry columns (track 019 P6). A row is appended per POLL that carries a report,
  UNTHROTTLED (founder call 2026-09-23) — `reportIsDue` throttles only the `Device` last-value
  row, which costs nothing since that row is a cache of the latest reading and this table is the
  record. The poll interval therefore sets the row rate (1440/device/day at 60 s), so retention is
  load-bearing at fleet scale. `pruneDeviceTelemetry()` deletes past
  `device-telemetry-retention-days`, oldest first, in bounded chunks: the sweep runs in a
  serverless invocation against a table that is largest exactly when someone has just shortened
  the window, so it is RESUMABLE (whatever it commits stands) and capped per run rather than
  unbounded. Called by the user app's `/api/cron/prune-telemetry` daily. The volume arithmetic
  is in the module header — read it before raising the default
- `src/device-power.ts` — **PURE** (no Prisma; a client component may import it): the three
  device power modes, their poll bands (continuous 1–15 s · light sleep 10–45 s · deep
  sleep 30–300 s — floors from `../sunbnb-hw` exp 005, light sleep's ceiling an operating
  choice past the 27 s crossover), `clampPollInterval`, `resolveDevicePolicy`, and the
  person-facing `validatePollInterval` / `describePollBand` / `validateDevicePolicy` (the ONE
  write-path pair check, called by both the admin preferences writer and the partner per-device
  writer so a refusal reads the same on both), plus `resolveDevicePolicyForDevice` — the
  device-over-platform cascade, shaped like `resolveServiceFee`. Its rules are deliberate: a
  half-set or unreadable override INHERITS the platform pair (half a policy is not one, and an
  illegal mode leaves no band to clamp against), while an out-of-band interval is CLAMPED inside
  the device's own mode rather than bounced to the platform — bands have moved once already, and
  a narrowing that flipped a `deep_sleep`/300 device to a `continuous`/5 platform default would
  flatten its cell in three days. The bands OVERLAP on purpose —
  the mode is an explicit field precisely because it cannot be inferred from a cadence in the
  overlap. Both fallbacks point at `deep_sleep` / the cheap end of a band: a wrong slow value
  costs response time, a wrong fast one costs the battery in days.
  **`clampPollInterval` vs `validatePollInterval`** is the same band asked by different
  callers: a fielded device gets the nearest legal cadence (it cannot read an error), a person
  choosing one gets a refusal naming the mode and its band. The admin form and `setDevicePolicy`
  both call the latter, so what the operator reads while typing is what the server would answer

## Testing

```bash
npm run test                    # unit — pure logic, no DB, no mocking
npm run test:integration        # requires local sunbnb_test DB
npm run test:integration:setup  # prisma migrate deploy against sunbnb_test
```

A separate `sunbnb_scale` DB backs the track-020 benchmark harness (`npm run scale:*`); its target
guard refuses any non-local host even with `--force`.

Full per-file inventory, config split and the scale harness: **`packages/data/TESTING.md`**.

## Known Quirks
- Exports both Prisma client AND duplicated UI components (TextField, Button) — same components also exist in `@repo/ui`
- Export path typo: `"./PrismaCient"` (missing 'l' in Client)
