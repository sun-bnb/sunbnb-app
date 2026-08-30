# data-dev playbook

`data-dev`'s curated, growing memory for `packages/data` (`@repo/data`). Governed by
`.claude/knowledge/README.md` (layer spec + trust ladder). Grow it via the gated
retrospective; curate it via `workflows/groom.md`.

## Navigation index

What this playbook knows, by theme. Maintained by grooming; scan it before reading
sections.

- **Schema & migrations** — `prisma migrate dev` advisory-lock contention (never background it) (2026-05-20)
- **Mollie payment cancel** — `cancelReservationMolliePayment`: 422→paid semantics, slim token lookup (no loadFeeContext), vi.hoisted() mock pattern for dual-findUnique test (2026-07-13)
- **Payment / invoice / fee / subscription** — `resolveEffectiveSubscription` override convention (2026-05-20); feature-entitlement catalog/resolver + circular-import avoidance (2026-05-20); `rental-payment.ts` shared Mollie create/verify/finalize for RentalBooking (2026-06-20)
- **Reservation conflict guard** — `reserveWithConflictGuard` (FOR UPDATE on InventoryItem, structured conflict return, race test) (2026-06-16)
- **Cash receipt path** — `processConfirmedReservation(id, { skipCommission: true, invoicedAt? })` — status must NOT be updated to COMPLETE; year threading via `nextInvoiceNumber year param` (2026-07-10)
- **Analytics — monthly source summary** — rental cash status shares `RESERVATION_PAID_IN_CASH`; Order.paymentAmount non-null for post-payment status rows (2026-07-10)
- **Integration test failures & fixes** — ESLint unused-var in destructuring + void binding (2026-07-11)
- **PostGIS notes** — _none yet_
- **Cross-app blast radius** — schema/export changes that rippled to app mocks — see SunbedGroup (2026-06-14)
- **Till module (day-anchored two-bucket rework)** — `closeEmployeeTill` shared writer, `today`/`carryOver` window math, keeping civil-day reports' return shape genuinely unchanged, `tsc --noEmit` non-functional for this package (2026-07-23)
- **Viva ISV Cloud Terminal client (track 024 W8 A1)** — stub-vs-http client contract split, module-level dev stub store, noUncheckedIndexedAccess in fetch-mock tests, spec-vs-brief contradictions (2026-08-30)
- **Viva merchant connect — schema + ISV accounts client (track 024 W8 A2)** — `/isv/v1/accounts` not `/platforms/v1/accounts`, `verified: boolean` not a status-string vocabulary, no legalName/taxNumber/etc in the create body, token cache generalised by scope (2026-08-30)
- **Viva card-present collect rows — machine table + executors + status/cancel/refund (track 024 W8 A3)** — edit-the-table-not-the-actions applied to a real payment rail; abandon-while-pending never reverts (the one Mollie divergence); vi.mock('./viva') wrapping pattern for spying on a stub singleton (2026-08-30)
- **Rejected approaches** — dead-ends, so nobody re-tries them — _none yet_

---

## Schema & migrations

### 2026-05-20: prisma migrate dev advisory lock contention from background process
**Problem:** Running `npm run migrate:local` in the background (via `run_in_background`) then attempting a second `prisma migrate dev` in the foreground fails immediately with `P1002: Timed out trying to acquire a postgres advisory lock`. The background process holds the lock even when stdin is waiting for input.
**Solution:** Kill the background process with `pkill -f "prisma migrate dev"` before retrying. Then pipe the migration name via stdin: `echo "migration_name" | npx prisma migrate dev`.
**Prevention:** Never run `prisma migrate dev` as a background task. Always run it in the foreground with stdin piped for the name prompt.

## Mollie payment cancel (reservation-payment.ts)

### 2026-07-13: cancelReservationMolliePayment — 422→paid semantics and slim token lookup
**Pattern:** `cancelReservationMolliePayment(reservationId)` issues `DELETE /payments/{ref}` on the partner's Mollie account. The caller (partner `cancelCollection`) owns all local state changes based on the returned status; this function only talks to Mollie.
**422 → `paid`:** Mollie returns 422 when a payment is no longer in `open` state (already `authorized` or `paid`). This means the consumer paid while the QR abandon was in flight. Return `{ status: 'paid' }` so the caller finalizes the reservation as complete rather than deleting it.
**Token lookup:** Use `prisma.partnerAccount.findUnique({ where: { userId: site.userId } })` — NOT `loadFeeContext`. `loadFeeContext` loads fees + subscription + settings for fee calculation; none of that is needed for a cancel. Use the same two-field reservation select as `getReservationPaymentStatus`: `select: { paymentRef, site: { select: { userId } } }`, then look up `partnerAccount` by `userId`.
**Short-circuit:** No `paymentRef` or `pi_demo_` prefix → `{ status: 'canceled' }` immediately with no fetch or token call.
**Test mocking:** The function calls `prisma.reservation.findUnique` AND `prisma.partnerAccount.findUnique`. Mock both via `vi.hoisted()` so they're initialized before `vi.mock('../index', ...)` runs. Declare `const { mockReservationFindUnique, mockPartnerAccountFindUnique } = vi.hoisted(...)` then use them inside the `vi.mock('../index', () => ...)` factory. Without `vi.hoisted()`, the factory closes over uninitialized variables and throws "Cannot access before initialization".

## Payment / invoice / fee / subscription

### 2026-05-20: effective-subscription resolution convention (CustomSubscription)
**Problem:** Need a canonical way to merge a partner's base `SubscriptionPlan` with a sparse `CustomSubscription` override (null field = inherit base).
**Solution:** `resolveEffectiveSubscription(plan, custom)` in `src/subscription.ts` — pure function, no DB. Custom non-null field wins; falls back to plan; then hard defaults (tier=STARTER, maxSites=1, price=0). `isCustom` is true only when the custom record has a non-null `maxSites`. `canCreateSite` uses a single `partnerAccount.findUnique` selecting both `customSubscription` and `subscription.plan`, then calls this helper.
**Prevention:** All future per-partner plan overrides should go through `resolveEffectiveSubscription` (add nullable fields to `CustomSubscription` and extend the helper). Never derive effective limits directly from `subscription.plan` alone.

### 2026-05-20: feature entitlements — catalog/resolver pattern + circular import avoidance
**Problem:** Adding a feature-flag catalog (`SUBSCRIPTION_FEATURES`, `TIER_FEATURE_DEFAULTS`, `resolveEffectiveFeatures`) and integrating it with fee contexts in `payment.ts`. Risk of circular import: if `payment.ts` imported from `subscription.ts` AND `subscription.ts` imported from `payment.ts`.
**Solution:** `resolveEffectiveFeatures` is pure (no DB) and lives in `subscription.ts`. `payment.ts` imports it with `import { resolveEffectiveFeatures, type SubscriptionFeatureKey } from './subscription'`. `subscription.ts` does NOT import from `payment.ts`. No cycle. `featureOverrides` on `CustomSubscription` is `Json?` (JSONB) — cast as `any` at the DB boundary before passing to the pure resolver. Fee contexts (`SiteFeeContext`, `PartnerFeeContext`) add `features: Record<SubscriptionFeatureKey, boolean>` as an additive field; both `getSiteFeeContext` and `getPartnerFeeContext` add `customSubscription: true` to their partnerAccount includes.
**Prevention:** Keep the feature resolver pure and in `subscription.ts`. Always cast Prisma `Json` fields to the expected type at the DB boundary, not inside pure helpers. Adding a new feature to the catalog is a one-liner in `SUBSCRIPTION_FEATURES` + `TIER_FEATURE_DEFAULTS` — no migration needed (sparse JSON map).

## Integration test failures & fixes

<!-- Entry format:
### YYYY-MM-DD: <concise title>
**Problem:** what went wrong / what was non-obvious
**Solution:** what actually worked
**Prevention:** how a future session avoids it (cite path/file.ts#symbol) -->

### 2026-07-11: till integration test ESLint unused-var trap in destructuring + void binding
**Problem:** `npm run lint` at `--max-warnings 0` catches two subtle unused-var patterns in integration tests: (1) destructuring `rentalItem` from `setup()` when the test doesn't use rentals; (2) binding the return of `await mkEmp('Zara')` to a `const zara` when the intent is only to create the roster row (zero-fill scenario).
**Solution:** (1) Omit unused fields from destructuring (`const { user, site, mkEmp } = await setup()`). (2) Call without binding (`await mkEmp('Zara')`).
**Prevention:** When a test's `setup()` call returns more fields than the test needs, destructure only what you use. For roster zero-fill employees, never bind the return value — just `await mkEmp(name)`.

## PostGIS notes

<!-- Spatial query patterns, GiST index behaviors, geometry gotchas -->

## Cross-app blast radius

### 2026-06-14: SunbedGroup model — additive, mocks updated in partner + user; admin skipped
**Change:** Added `SunbedGroup` model (id, siteId, createdAt, updatedAt, items[]) and `sunbedGroupId` nullable FK on `InventoryItem`. Back-relation `sunbedGroups` added to `Site`. `pairId`/`pair`/`pairedBy` kept intact.
**Blast radius:** `apps/partner/__mocks__/@repo/data/PrismaCient.ts` and `apps/user/__mocks__/@repo/data/PrismaCient.ts` both needed a `sunbedGroup` delegate. `apps/admin` mock skipped — admin never touches inventory items. `packages/data/src/test/fixtures.ts` got `createTestSunbedGroup()`.
**Prevention:** Any new top-level model that partner or user code might query must appear in both those mocks, even if no test currently calls it (missing mock delegate crashes the whole test file at import time).

### 2026-06-14: --create-only migration pattern for custom backfills
**Problem:** `migrate:local` (which runs `migrate dev`) auto-applies. When a migration needs a custom idempotent data backfill appended to the generated SQL, auto-apply would run before we could add the backfill.
**Solution:** Use `echo "name" | npx prisma migrate dev --create-only --name <name>` to generate the file only, append backfill SQL, then apply with `echo "" | npx prisma migrate dev` (no --create-only). Then manually run `migrate:integration` (`POSTGRES_URL=postgres://postgres:sunbnb@localhost:5432/sunbnb_test npx prisma migrate deploy`) to keep sunbnb_test in lockstep (mirrors what `migrate:local` does).
**Prevention:** Any migration with seed/backfill data must use `--create-only`. Backfill SQL must be idempotent (`ON CONFLICT DO NOTHING` / `WHERE col IS NULL` guards). Deterministic IDs (e.g., `'grp_' || LEAST(a, b)`) are simpler and safer than `gen_random_uuid()` inside CTEs because they avoid correlation problems and need no extension.

## Reservation conflict guard

### 2026-06-16: reserveWithConflictGuard — FOR UPDATE on InventoryItem, structured conflict return
**Problem:** Multiple call sites (partner: reserveItem, blockBed, createWalkInRental, createPartnerReservation; user: saveReservationForMultipleItems) do a conflict-check then a create as two separate awaits, enabling concurrent requests to both pass and create a double-booking.
**Solution:** `reserveWithConflictGuard` in `src/reservations.ts`, exported as `@repo/data/reservations`. Interactive `$transaction` with three steps: (1) `SELECT ... FOR UPDATE` on the candidate `InventoryItem` rows via `tx.$queryRaw` — serializes concurrent claimants; (2) conflict check via `tx.reservation.findFirst` (inside the transaction, sees committed state after lock acquire); (3) if clear, `tx.reservation.create`. Returns `{ outcome: 'created' | 'conflict' }` — never throws for normal conflict (throwing inside `$transaction` looks like a DB error to the caller, masking the business reason).
**Lock target:** InventoryItem rows, NOT Reservation rows — the reservation doesn't exist yet. Locking the bed is what prevents double-booking.
**Conflict semantics:** `blockingStatuses` defaults to `BLOCKING_STATUSES` (PENDING, PROCESSING, COMPLETE, PAID_IN_CASH). `nonBlockingOpStatuses` defaults to `[OP_NO_SHOW, OP_DEPARTED]`. Both are configurable. Partner call sites historically used `notIn [CANCELED]` (also blocks PAYMENT_FAILED + REFUNDED) — pass a custom `blockingStatuses` to match if needed.
**Divergence note:** Partner = stricter (PAYMENT_FAILED + REFUNDED block). User = BLOCKING_STATUSES only (PAYMENT_FAILED + REFUNDED are non-blocking). Default uses user semantics; override for partner if adopting those call sites.
**Race test:** `src/reservations.integration.test.ts` has a `Promise.all([makeCall(), makeCall()])` test that fires two concurrent claims on the same bed. Asserts exactly one `{ outcome: 'created' }` and one `{ outcome: 'conflict' }`, and exactly one reservation row in the DB. Passes consistently — the FOR UPDATE lock serializes them.
**Prevention:** Always expand SunbedGroup + pair sibling IDs BEFORE calling this helper — the helper does not expand items itself (caller responsibility, matches existing call-site pattern).

## Payment modules — shared Mollie create/verify/finalize

### 2026-06-20: rental-payment.ts — list-based create, single-id verify/finalize for RentalBooking
**Pattern:** `createRentalBookingMolliePayment(bookingIds: string[], opts)` accepts 1–20 booking ids; validates they're all real and share the same `siteId`. Amount = `round(sum of paymentAmount)` from DB only. Creates ONE Mollie payment and writes the same `paymentRef` + `RENTAL_PROCESSING` to ALL bookings via `updateMany`. On provider failure, sets ALL to `RENTAL_PAYMENT_FAILED` via `updateMany`. Single-card collect = `[bookingId]`; walk-in multi-item = all booking ids from the session.
**Finalize path:** `getRentalBookingPaymentStatus(bookingId)` and `reverifyAndFinalizeRentalBooking(bookingId)` are single-booking. `reverifyAndFinalizeRentalBooking` retrieves the booking's `paymentRef` before delegating to `processConfirmedRentalBooking(paymentRef)` — that finalizer is group-keyed, so it closes all bookings sharing the ref. Finalizing any one representative booking finalizes the group.
**Integration test coverage:** validation guards (empty list, missing booking, cross-site); no_mollie guard; two-booking group shares paymentRef and both flip to RENTAL_COMPLETE + 2 invoices after finalizing via representative; idempotency; amount pulled from `paymentAmount` not `totalPrice`; unknown ref stays pending without mutating status.
**Export path:** `"./rental-payment"` in both `exports` and `typesVersions` of `packages/data/package.json`.
**Prevention:** When the create path uses `updateMany`, the error path must also use `updateMany { id: { in: bookingIds } }` — not a single `update`. The user app's own `/api/payment/mollie/create-rental-payment/route.ts` is an independent implementation (uses `@mollie/api-client`, not `createRentalBookingMolliePayment`) — that route is NOT a caller of this module.

## Analytics — monthly source summary

### 2026-07-10: getMonthlySourceSummary — rental cash-walk-in status shares RESERVATION_PAID_IN_CASH
**Problem:** `RentalBooking.status` for cash walk-in rentals is the literal `'paid-in-cash'` (same value as `RESERVATION_PAID_IN_CASH` constant). No separate `RENTAL_PAID_IN_CASH` constant exists — they share the string. Online rentals use `RENTAL_COMPLETE` (`'complete'`).
**Solution:** Filter rentals with `status: { in: [RESERVATION_PAID_IN_CASH, RENTAL_COMPLETE] }` — imports just one constant from the reservation namespace. Verified against live DB (11 `paid-in-cash` + 3 `complete` rental bookings).
**Prevention:** When filtering rental bookings by paid status, always use both `RESERVATION_PAID_IN_CASH` (literal `'paid-in-cash'`) and `RENTAL_COMPLETE` (literal `'complete'`). Never invent a `RENTAL_PAID_IN_CASH` constant; check `reservation-status.ts` first.

### 2026-07-10: Order.paymentAmount — non-null only for post-payment status rows
**Observation:** The `createTestOrder` fixture defaults `paymentAmount: 30.0` regardless of status, so test rows always have non-null paymentAmount. In production, `paymentAmount` is populated when the payment is confirmed. For revenue accounting queries, always filter by status (post-payment states) — the paymentAmount itself is present on matching rows. Use `paymentAmount ?? 0` defensively in the aggregation loop.
**Prevention:** Always assert on revenue by seeding with explicit post-payment statuses AND confirming the expected totals from the paymentAmount column (not totalPrice) for takings-consistency with the Reservation and RentalBooking patterns.

## Cash receipt (PARTNER-only invoice) path

### 2026-07-10: processConfirmedReservation opts — skipCommission + invoicedAt threading
**Change:** Added `ProcessReservationOpts { skipCommission?: boolean; invoicedAt?: Date }` to `processConfirmedReservation`. Cash/walk-in path: `skipCommission: true` creates one PARTNER invoice, skips PLATFORM invoice AND skips `reservation.status = RESERVATION_COMPLETE` mutation (status stays `'paid-in-cash'`). `invoicedAt` override threads into `nextInvoiceNumber` via a new explicit `year` parameter — the function signature became `nextInvoiceNumber(tx, issuerType, year = new Date().getFullYear())`.
**Critical:** The `status = RESERVATION_COMPLETE` update inside the transaction MUST be gated on `!skipCommission`. Missing this would convert a `paid-in-cash` reservation to `complete`, breaking the manage-grid UI which distinguishes cash vs. online by status.
**Year threading:** `nextInvoiceNumber` previously hardcoded `new Date().getFullYear()` inside the function body. Now the caller passes `invoicedAt.getFullYear()` so a backfilled June sale gets a `PARTNER-2026-XXXXX` number even when called in a future calendar year.
**Idempotency:** The existing guard `invoices.length > 0` already blocks re-processing for cash receipts. The in-transaction double-check on `invoices.length` applies equally. No change needed to the guard logic.
**Prevention:** When extending the function again, check that the status mutation block is still inside `if (!skipCommission)`. Do not add a `RESERVATION_PAID_IN_CASH` constant to `PAID_STATUSES` — the paid-in-cash status deliberately sits outside the COMPLETE cycle so that settlement aggregation can distinguish cash from online.

## Backfill scripts — raw SQL column naming gotcha

### 2026-07-10: $queryRaw requires quoted camelCase for un-mapped Prisma columns
**Problem:** Prisma fields without `@map()` (e.g. `createdAt`, `updatedAt`) are stored in Postgres with their camelCase name. Raw SQL like `r.created_at` fails with `column does not exist` (code 42703). The column is actually `"createdAt"` (double-quoted in SQL).
**Solution:** Always double-quote unmapped Prisma camelCase columns in `$queryRaw`: `r."createdAt"`. Fields WITH `@map()` (e.g. `payment_amount`, `is_comp`, `refunded_at`) use the snake_case name without quotes.
**Prevention:** When writing any `$queryRaw` against Prisma models, run a `\d "TableName"` in psql first to see the exact column names. Un-mapped fields keep their Prisma camelCase name literally; `@map("snake_case")` fields use the mapped name.

## Fiscal report — invoice-based monthly export

### 2026-07-10: getMonthlyFiscalReport — site scoping for rental invoices via paymentRef-set join
**Pattern:** `Invoice` has no direct `siteId` column — it links to a site via `reservationId` or `orderId` relations. Rental invoices link only via `paymentRef` (same string stored on `RentalBooking.paymentRef`). Site-scoping for rentals: fetch `prisma.rentalBooking.findMany({ where: { siteId, paymentRef: { not: null } }, select: { paymentRef: true } })` then pass `paymentRef: { in: rentalPaymentRefs }` as a third OR clause on the Invoice query. If the site has no rental bookings the IN list is empty and the clause is omitted. Reservation and order invoices are scoped precisely via `reservation: { siteId }` and `order: { siteId }`.
**VAT bucketing:** `InvoiceLine.vatRate = null` maps to rate `0` for bucketing (treated as zero-VAT, consistent with PLATFORM reverse-charge lines). Buckets sorted ascending by rate; `round()` applied per-bucket.
**Refunds:** `refunds` is informational (derived from `refundedAt`/status on source records, not formal credit notes). Same population as `getMonthlySourceSummary`. When formal credit notes (counter-invoices) are introduced, update `lines` to include them.
**Prevention:** `RENTAL_REFUNDED` and `ORDER_REFUNDED` are the only status constants needed in fiscal.ts (the refund query). All other status filtering is done via the invoice record itself (invoicedAt filter). Never import the full ORDER_*/RENTAL_* set unless actually using them — ESLint's no-unused-vars at max-warnings 0 will block the build.

## Till module (day-anchored two-bucket rework, track 016)

### 2026-07-23: closeEmployeeTill shared writer + today/carryOver window math
**Pattern:** `getOpenTill(siteId, employeeId, dayStart)` now requires a caller-supplied `dayStart` (venue-local start of today — the module stays tz-agnostic, mirrors `getTillDayReport`'s `siteDayBounds(buildSiteTimezone(site), now).start` pattern). Window math: `floor = lastClose && lastClose > dayStart ? lastClose : dayStart`; `today` = non-voided entries `settledAt > floor`; `carryOver` = non-voided entries `settledAt <= dayStart AND (settledAt > lastClose OR lastClose is null)`. Key invariant that made this safe to add without breaking close semantics: `today.total + carryOver.total` always equals the old since-last-close total — the two windows are a partition of `settledAt > lastClose`, they never overlap and never double-count. Verified algebraically before coding: when `lastClose > dayStart` (closed today), `carryOver`'s upper bound (`dayStart`) is below its own lower bound (`lastClose`), so it's provably empty and everything lands in `today`.
**Shared writer:** `closeEmployeeTill(siteId, employeeId, dayStart)` is now the only place a `TillClose` row is created (reads `getOpenTill`, no-ops on zero, else snapshots `totalAmount/txnCount` = sweepable + `carryOverAmount/carryOverCount` = the carry-over bucket). `closeAllOpenTills` was rewritten to loop `closeEmployeeTill` per non-zero employee (via `Promise.all`) instead of a single `tillClose.createMany` — trades one batch insert for N sequential closes, in exchange for a single source of truth for the snapshot logic. Both were previously two independently-coded writers (a manual `manage/actions.ts closeTill` inline `prisma.tillClose.create` plus `closeAllOpenTills`'s `createMany`) — P3 needs to route the partner `closeTill` action through this new shared function too.
**Gotcha — don't let bucket fields leak into "unchanged" functions:** `getTillByEmployee`/`getEmployeeShiftItems` (civil-day `[from, to]` reports) were explicitly spec'd as unchanged. Reusing the same `EmployeeTill` interface (now carrying `today`/`carryOver`) for both the open-till functions AND `getTillByEmployee` would have silently forced bucket fields onto a report that has no "day" notion. Split into two types: `EmployeeTill` (bucketed, open-till only) and `EmployeeCashTotal` (plain `{employeeId,name,active,total,count}`, `getTillByEmployee`'s actual unchanged return shape).
**`tsc --noEmit` is non-functional for this package:** running it bare fails immediately with `TS2209: project root is ambiguous ... export map entry '.'` — a pre-existing issue with the package.json `exports` map, unrelated to any code change (reproduces on a clean checkout). No `typecheck` script exists in `package.json`; only `lint`+`test`+`test:integration` are the enforced gates. Even with `--rootDir .` to work around it, the package has pre-existing `noUncheckedIndexedAccess` violations in files never touched by this task (`payment.test.ts`, `refund.test.ts`, `rental-emails.test.ts`, `test/fixtures.ts`) — confirms tsc has never been clean here. The established integration-test convention for extracting one row from an array is `arr.find(...)!`, not raw `arr[0]` indexing (raw indexing trips `noUncheckedIndexedAccess`); `till.integration.test.ts` (both before and after this rework) uses raw indexing in several spots — a pre-existing pattern, not something to "fix" opportunistically mid-task.
**Prevention:** When a rework spec lists some functions as "unchanged", check whether a shared TS type is used by both the changed and unchanged functions before extending that type — split types rather than let field additions leak. When `npx tsc --noEmit` errors immediately with TS2209 in this package, that's the known ambiguous-rootDir issue, not something introduced by your change — verify via `git show HEAD:<file>` / a stash-free check that the same class of error predates your diff before spending time "fixing" it.

## Viva ISV Cloud Terminal client (track 024, W8, packet A1)

### 2026-08-30: stub-vs-http VivaClient split, module-level dev stub, spec contradicted the brief in three places
**Pattern:** Built `packages/data/src/viva/{types,refs,http-client,stub-client,index}.ts` as a
`VivaClient` interface (`createSale`/`getSession`/`abortSession`/`refund`/`searchDevices`) with
two implementations selected by `getVivaClient()` (`VIVA_MODE` env, defaults to stub when no
`VIVA_ISV_CLIENT_ID`). The fee guard (`isvDetails.amount` must be `>0` and `< amount` — Viva
declines a fee ≥ the sale) is a SHARED pure function (`assertValidIsvFee` in `types.ts`), called
by both implementations, so the http and stub clients can't drift on the one rule most worth
testing. `refs.ts` (the `viva_<sessionId>` payment-ref convention) is a separate file with zero
imports from `http-client`/`stub-client` — client-safe, mirrors `site-code.ts`/`device-code.ts`.

**Spec (OpenAPI, downloaded to scratchpad) contradicted the task brief in three places — always
verify against the actual `.yaml`, not just the track log's prose summary:**
1. All `/ecr/isv/v1/*` ISV endpoints live in `cloud.yaml` (the Cloud Terminal API spec), NOT
   `isv.yaml` (a different, unrelated ISV Payment API) — the brief pointed at both files as if
   the ISV scheme might be in either.
2. Abort is `DELETE /ecr/isv/v1/sessions/{SessionId}` with a REQUIRED `cashRegisterId` QUERY
   PARAM ("only the register that created the session may abort it") — not a bare DELETE by id.
   Response codes worth encoding: 200/409 both mean "go re-fetch the session" (409 = abort
   already in progress, possibly because the card already got read and the session resolved);
   404 = unknown; 403 = genuine permission error, not a race.
3. `ISVSearchDevicesOptions.merchantId` is REQUIRED by the spec, not optional as the brief's
   `searchDevices(merchantId?)` signature implied — made it required in the `VivaClient`
   interface and flagged the open question for A2 (where does a per-site `merchantId` come from
   before P1's merchant-connect model exists — needed to search a venue's devices at all).

**Dev-loop stub design:** `stub-client.ts`'s session store is MODULE-LEVEL (`Map`, not per-client-
instance) so a separately-constructed client in another route/test sees what an earlier one
wrote — matches the real API (the session lives at Viva regardless of which local call created
it). `createSale`'s `sessionId` carrying the substring `decline` or `abort` (case-insensitive)
forces an immediate terminal outcome instead of the timed auto-approve — lets a test or a partner
dev-loop drive every branch without waiting or mocking `fetch`. `stubState.reset()` must run in
`beforeEach`/`afterEach` or state leaks across tests in the same file (same failure mode as any
module-level store — see the `rate-limit.ts` per-process cleanup precedent).

**`toCents()` — round() first is NOT a float-precision fix; don't oversell it in a doc comment.**
Tried to find a real case where `Math.round(round(x)*100) !== Math.round(x*100)` by brute-force
search (thousands of values, including reverse-VAT-style divisions) — found NONE. Double-rounding
to the same precision (cents) essentially never crosses a boundary twice in JS float arithmetic.
The actual reason to route through `@repo/data`'s `round()` first is consistency (`round()` is
the ONE authoritative rounding decision for money everywhere else in the codebase per
`.claude/rules/payments.md`), not correctness-of-this-one-conversion. Don't write a test/comment
claiming a "verified pitfall divergence" without actually reproducing one — caught this in review
before it shipped as a false claim.

**`tsc --noEmit` in this package needs `--rootDir .`** (TS2209 ambiguous project root otherwise —
same pre-existing issue the till-module entry above documents) and even then flags
`noUncheckedIndexedAccess` on any NEW test file that indexes a mock-call array
(`fn.mock.calls[i][j]`) — same class as the existing `arr.find(...)!` convention. Fixed by adding
a small typed `call(fn, i)` helper in the test file that throws a clear message if the index is
missing, rather than sprinkling `!` at every call site (14 occurrences in one file — the helper
paid for itself immediately). Verify a `tsc --noEmit --rootDir .` failure predates your diff by
grepping the offending file list against files you didn't touch (`payment.test.ts`,
`refund.test.ts`, `rental-emails.test.ts`, `test/fixtures.ts`, `till.integration.test.ts` are the
known pre-existing set) before spending time on it.

**Prevention:** For any new `@repo/data` submodule with two implementations selected by env
(stub/real), put invariant validation (fee guards, amount checks) in a THIRD, shared pure
function/file both implementations call — never duplicate the rule into each implementation
separately, even when the brief only explicitly assigns it to one. When a task brief describes an
external API from a track log's prose summary, always re-derive the request/response shapes from
the actual downloaded spec file(s) before coding — the brief's field lists and endpoint
guesses can be stale or simply wrong about which file something lives in.


## Viva merchant connect — schema + ISV accounts client (track 024, W8, packet A2)

### 2026-08-30: PartnerAccount.viva* + VivaTerminal migration, and `src/viva/accounts.ts`
**Pattern:** Additive migration `add_viva_merchant_connect` — 5 nullable `PartnerAccount.viva*`
columns (mirrors the existing `mollie*` columns' `@map` snake_case style) + a new `VivaTerminal`
table (`@@map("viva_terminal")`, `terminalId @unique` — a physical terminal belongs to one site,
not a composite key) with `Site.vivaTerminals[]`. Ran clean: `npm run migrate:local` (Docker was
down at task start — `open -a Docker`, poll `docker info` in a loop, then `docker start
sunbnb-postgres`, all before the migrate step; the container had exited, not just "not running"),
`migrate:check` reports no drift, and all 20 integration test files / 378 tests still pass — proof
an additive migration doesn't perturb existing DB-dependent behavior.

**Reused A1's token cache by generalising it, not duplicating it** — exactly what A1's own
"Prevention" note (below) says to do, and the brief asked for explicitly. `http-client.ts`'s
`getAccessToken`/`fetchAccessToken`/`tokenCache` took a `scope` parameter (defaulted to the
existing `ECR_SCOPE` so Cloud Terminal call sites are unaffected) and the cache key became
`env:clientId:scope`; `apiBase`/`parseErrorBody`/`requireOk` were exported (previously
module-private) for `accounts.ts` to reuse — connected-accounts calls (`urn:viva:payments:core:api:isv`
scope) hit the SAME host (`{demo-,}api.vivapayments.com`) as the Cloud Terminal sale endpoints
(`urn:viva:payments:ecr:api` scope), just a different path prefix (`/isv/v1/*` vs `/ecr/isv/v1/*`).

**Spec (`isv.yaml`, `connected_account_request`/`connected_account_response`/
`retrieve_account_response` definitions) contradicted the task brief in three places — same
lesson as A1, verify the actual schema block, not the brief's field list or endpoint guess:**
1. Path is `/isv/v1/accounts[/{accountId}]`, NOT `/platforms/v1/accounts` as the brief stated.
2. The create request (`connected_account_request`) accepts ONLY `email`, `returnUrl`, and
   `branding { partnerName, logoUrl, primaryColor? }` — no `legalName`/`tradeName`/`taxNumber`/
   `mobile`/`address`, which the brief's `VivaCreateConnectedAccountInput` asked for. Kept those
   fields on the TypeScript input type (a caller's onboarding form already collects them) but the
   HTTP client deliberately drops them before building the wire body — verified by a test that
   asserts `body.legalName`/`taxNumber`/etc are `undefined` after a round trip with all of them set.
3. The retrieve response (`retrieve_account_response`) exposes a **boolean** `verified` field, not
   a status-STRING vocabulary. There is no API value distinguishing "rejected" from "still
   pending" — only the *webhook* is named "Account Verification Status Changed" (eventTypeId
   8194), implying a richer vocabulary exists somewhere Viva-side that this REST response doesn't
   surface. Normalised `verified: true -> 'verified'`, `false -> 'pending'`, missing/malformed ->
   `'unknown'`; kept `'rejected'` in the `VivaAccountVerificationStatus` union for forward
   compatibility with a future webhook consumer, but documented in three places (module doc
   comment, type doc comment, and this entry) that nothing in `accounts.ts` can produce it today —
   don't let a caller assume `getConnectedAccount` will ever return it.

**Single-file deliverable, unlike A1's five-file split.** The brief named one file
(`src/viva/accounts.ts`) for the whole feature — types + http client + stub client + module-level
store all live there, re-exported via `export * from './accounts'` in `index.ts` alongside a new
`getVivaAccountsClient()` that shares `resolveMode()`/`configFromEnv()` with `getVivaClient()`
(ONE `VIVA_MODE` switch controls both clients, deliberately — a dev/test session can't end up with
the sale client stubbed and the accounts client hitting the real API by forgetting a second flag).

**Prevention:** When a task brief's TypeScript interface has MORE fields than the actual API
schema declares, keep the extra fields on the input type (callers already have the data and
shouldn't need a Viva-specific subset) but add an explicit test proving they do NOT reach the wire
— an interface that silently over-promises is worse than one that's honest about what's optional.


## Rejected approaches

<!-- Approaches tried and rejected — record so a future session doesn't re-try them -->


## Viva card-present collect rows — machine table + executors + status/cancel/refund (track 024, W8, packet A3)

### 2026-08-30: cardPresent condition rows, runCollectStartCard/runCollectAbandonCard, viva branches in reservation-payment.ts
**Pattern:** Added `'cardPresent'` to `CONDITIONS` and `'vivaSale'`/`'vivaAbort'` to `EFFECTS` in
`reservation-machine.ts`. Two new TRANSITIONS rows (`collect.start` / `collect.abandon`, both
`when: ['cardPresent']`) inserted ABOVE the existing QR/Mollie rows for the same event — `resolveTransition`
takes the first full match, so ordering alone makes "cardPresent present → Viva row; absent → QR row"
work with zero branching logic in the resolver itself. `computeConditions` derives `cardPresent` as a
FACT: `opts.collect?.method === 'card'` on start, OR `isVivaPaymentRef(r.paymentRef)` on abandon/fail —
the abandon caller never has to repeat `method`, the stored ref prefix already says which rail. This is
the same edit-the-table-not-the-actions doctrine track 018 established, now proven on a second payment
provider without touching `resolveTransition`, `applyTransition`'s dispatch skeleton, or any other row.

**The one deliberate Mollie divergence, and why it's structurally different:** Mollie's
`collect.abandon` always resolves definitively (cancel succeeds, or 422→already-paid) because Mollie's
DELETE is synchronous. Viva's abort is NOT — it only works before the card is read; after that (or on
any ambiguity resolving *which* `cashRegisterId` opened the session) the caller must poll
`getSession` rather than guess. `runCollectAbandonCard` therefore has a THIRD outcome beyond
cash-revert/pay.confirm: "stays processing" (`data.paymentStatus: 'processing'`, no DB write at all) —
reverting a possibly-authorised card would strand a charge the guest's bank already approved.
Bug-revealing integration test: give the site a SECOND `VivaTerminal` (defeats
`cancelReservationVivaPayment`'s "exactly one terminal" cashRegisterId fallback) with a genuinely
unresolved session (never `stubState.resolveNow`'d) → `cancel.status === 'error'` → poll branch →
`abortPollMs: 0` keeps it fast → asserts status stays `'processing'`, ref still `viva_`.

**`getReservationPaymentStatus`'s viva branch is what makes `reverifyAndFinalizeReservation` "just
work" for Viva with zero changes to that function** — it already dispatches purely on the return shape
(`succeeded`/`failed`), so adding the viva branch inside `getReservationPaymentStatus` (approved→succeeded,
declined/aborted→failed, pending/unknown→neither — unknown must NOT read as failed, a transient 404
must not revert a live tap) was the only change needed for "abandon after approve resolves as
pay.confirm" to work identically to the Mollie case, via the SAME reverify-then-cancel call sequence
already in `runCollectAbandon`.

**`cancelReservationMolliePayment` gained a `cashRegisterId?` param and an early
`isVivaPaymentRef` branch delegating to a new `cancelReservationVivaPayment`** — the exported name
stays Mollie-specific (every app imports that path, same "don't fix the typo" discipline as
`./PrismaCient`) but now silently routes viva_ refs correctly. `cancelReservationVivaPayment` resolves
`cashRegisterId` from the caller OR (fallback) the site's `VivaTerminal`s when there's exactly one —
ambiguous with 0 or 2+, which is also the knob the test above uses to force the poll branch
deterministically without needing to fake a real Viva 409 race.

**Test technique — spying on a module-level stub singleton via `vi.mock` + `vi.hoisted`:**
`stub-client.ts`'s session store is module-level (by A1 design), so `getVivaClient()` returning a
FRESH object per call is fine for production but makes `vi.spyOn` on one instance useless for
intercepting calls the executor makes through its OWN `getVivaClient()` call. Fix:
`vi.mock('./viva', async (importOriginal) => { const client = actual.createStubVivaClient(); return
{ ...actual, getVivaClient: () => ({ ...client, createSale: (req) => { spy(req); return
client.createSale(req) } }) } })` with `const { spy } = vi.hoisted(...)` — ONE memoized client shared
by every `getVivaClient()` call in the file (executor's and the test's own), spread-copied because the
stub's methods don't use `this`. **Gotcha:** a *dynamic* `await import('./viva')` after the `vi.mock`
call to "guarantee" getting the mocked version is unnecessary AND breaks `tsc --noEmit` (`TS1309`
top-level await under this tsconfig's module setting) even though vitest/esbuild runs it fine — `vi.mock`
is hoisted above every static import in the same file by Vitest's transform, so a normal top-level
`import { getVivaClient } from './viva'` already receives the mocked version; no dynamic import needed.

**Fee guard test without inspecting internals:** to prove "fee-guard failure (fee ≥ amount) reverts to
cash" without needing an isvDetails spy, seed a SITE-level `ServiceFee` override (`chargeType:
'percentage', percentage: 150`, via `createTestServiceFee(settingsId, { siteId, ... })` — site-level wins
the cascade unconditionally over settings' bootstrap default) so the real `resolveServiceFee` +
`calculateServiceFeeAmount` cascade computes a fee exceeding the sale amount, and the shared
`assertValidIsvFee` (A1) throws for real. Cleaner than mocking `assertValidIsvFee` — exercises the
actual cascade.

**Prevention:** When a second payment provider needs the SAME abandon/reverify shape as an
existing one, check whether the existing generic function (`reverifyAndFinalizeReservation` here)
already dispatches purely on a normalized return shape from a per-provider function
(`getReservationPaymentStatus`) — if so, the new provider is a branch inside that ONE function, not a
parallel copy of the generic caller. When a stub client's session store is module-level, `vi.mock` +
`vi.hoisted` a single memoized instance rather than spying per-call-site — spread-copying the object to
override one method is safe exactly when the implementation doesn't close over `this`.
