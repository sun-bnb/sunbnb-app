# partner-dev playbook

`partner-dev`'s curated, growing memory for `apps/partner`. Governed by
`.claude/knowledge/README.md` (layer spec + trust ladder). Grow it via the gated
retrospective; curate it via `workflows/groom.md`.

## Navigation index

What this playbook knows, by theme. Maintained by grooming; scan it before reading
sections. *(Empty — entries are added as the agent learns. Each entry: a one-line
pointer here + the full entry in its section below.)*

- **Auth & ownership** — `requireSiteOwner` / `verifySiteOwnership` / sudo edge cases — _none yet_
- **State machines** — operational status extension pattern (7-file checklist), color palette — see "Adding a new manage-page operational status"
- **Test failures & fixes** — mock/fixture gotchas — see "Mock-contract test", "saveInventoryItemProperties", "auth-matrix ok/reject predicate"
- **Accounting analytics remodel** — coverage-contract allowlist + analytics mock + TREND_WINDOWS extension pattern — see "Adding analytics actions to accounting/actions.ts"
- **Bug patterns & fixes** — recurring partner-app bugs — see "verifySiteOwnership vs verifySiteAccess scope divergence", "Prisma upsert is not atomic — RSC-prefetch concurrency crash on manage page"
- **Component decomposition** — manage page decomposition, shared state boundary, pinch handler scroll-target — see "Decomposing view.tsx manage monolith"
- **Manage page naming** — hold/reserve/rent action-row distinction — see "Reserve vs Rent vs Hold terminology"
- **Till conservation** — unreserveItem disconnect + splitWalkInSeat reduce paymentAmount; depart-split pattern — see "Till conservation in per-seat walk-in operations"
- **Cash rental settlement (track 013 P3b)** — `createWalkInRental` `recordCashSettlement` param; Card(QR) path must NOT pass it; free path auto-skips — see "Cash walk-in rental TillEntry (P3b)"
- **BedDetail state-machine patterns** — convertHoldToWalkIn in-place update + multi-day $transaction extend, pendingConfirm per-branch guards, inSync-gated toggle, walk-in disconnect depart — see "BedDetail state-machine patterns"
- **Manage surface routing** — token-gated sub-routes, admin-tier gating, `validateManageToken` convention, `closeDay` cash-up-only contract, `DayCloseView` frontend pattern — see "Token-gated sub-routes and admin-tier gating on the manage surface", "closeDay — cash-up only, does not touch the floor", "DayCloseView — todayIso derivation and dual-fetch pattern"
- **Rejected approaches** — dead-ends, so nobody re-tries them — see "React onWheel prop"
- **Mollie lib tests** — mocking strategy for app/api/_lib/mollie.ts — see "Testing mollie.ts: mocking boundary + scope separator"
- **Restaurant query tests** — mocking @repo/table-reservations-core while keeping real auth-helpers — see "Mocking @repo/table-reservations-core for queries.ts tests"

---

## Auth & ownership

<!-- Entry format:
### YYYY-MM-DD: <concise title>
**Problem:** what went wrong / what was non-obvious
**Solution:** what actually worked
**Prevention:** how a future session avoids it (cite path/file.ts#symbol) -->

## State machines

### 2026-06-17: Adding a new manage-page operational status (comp example)
**Pattern:** A new `operationalStatus` value for the manage page needs a 7-file checklist:
1. `@repo/data/reservation-status.ts` — add the constant (e.g. `OP_COMP = 'comp' as const`).
2. `manage/actions.ts` — add the create action (mirror `blockBed`) and the release action (mirror
   `unblockBed`); import the new constant. Both must go through `reserveWithConflictGuard`.
3. `app/test/gated-actions.ts` — register both actions as `token-or-session`; auth-matrix picks
   them up automatically (coverage-contract fails if you skip this).
4. `view.tsx` AND `ParcelView.tsx` — **both** have their own copy of `BedState` + `getBedState`;
   both need the new case. `POOL_STATE_STYLES` and `POOL_ICONS` only exist in `ParcelView.tsx`.
5. `ManageToolbar.tsx` — extend its local `BedState` type; add counter segment to the readout.
6. `BedDetail.tsx` — extend its local `BedState` type, `getBedState`, `stateBadgeColors`,
   `stateLabels`, `TOGGLE_VISIBLE_STATES`; add action from available state + state UI section.
7. `types/shared.ts` `Reservation` interface — add any new durable field (e.g. `isComp?: boolean`).
**Color guidance:** green=free, yellow=expected, blue=checked-in, orange=walked-in, gray=blocked,
purple=comp. Pick the next unused hue for P5+ states.
**Revenue exclusion:** `paymentAmount: 0` + no `processConfirmedReservation` call = no Invoice →
automatically excluded from invoice-driven accounting. No accounting changes needed.

## Accounting analytics — extension patterns

### 2026-07-19: Invoice header field semantics — totalCharge is NET, totalAmount is GROSS
**Problem:** A phase-5F report claimed `Invoice.totalCharge` is the gross (VAT-inclusive) amount and derived net as `totalCharge - totalTax`. That is INVERTED. In every `processConfirmed*` creator (`packages/data/src/payment.ts`): `totalCharge` = summed line BASE amounts (net), `totalTax` = VAT, `totalAmount` = gross (VAT-inclusive, what the consumer paid). The dine-in tabs accounting card initially shipped with the inverted mapping and showed net-minus-VAT as "net".
**Solution:** When rendering or aggregating invoice headers: net = `totalCharge`, VAT = `totalTax`, gross = `totalAmount`; sanity check `totalCharge + totalTax ≈ totalAmount`. Same convention at line level (`charge`/`tax`/`amount`).
**Prevention:** Don't infer money-field semantics from names — read the creating function in `payment.ts` and check the arithmetic identity against a real row before wiring a display.


### 2026-07-10: Adding analytics actions to accounting/actions.ts
**Pattern:** When adding new server actions to `accounting/actions.ts`:
1. **TREND_WINDOWS const** — extend `[7,30,365]` to `[1,7,30,365]` to support single-day window. The `const` drives the type used in `getOperationsTrend`'s guard expression.
2. **analytics mock** — add any new `export async function` from `packages/data/src/analytics.ts` to `apps/partner/__mocks__/@repo/data/analytics.ts` as `vi.fn().mockResolvedValue(...)`. The mock-contract test parses both files with regex and fails with a clear "missing exported functions" message if you forget.
3. **coverage-contract allowlist** — every new `export async function` in `accounting/actions.ts` must be added to `UNGATED_ALLOWLIST` in `app/test/coverage-contract.test.ts` with the auth pattern documented. The coverage-contract test enumerates all `'use server'` exports via glob and fails if any are ungoverned.
4. **No gated-actions entry needed** for read-only session+owner analytics actions — they're allowlisted (read-only, session-gated, ownership via `site.userId !== session.user.id`), not token-or-session.
**Prevention:** Run `npm run test` and watch for `coverage-contract` and `mock-contract` failures immediately after adding any new action or analytics import. Both tests give pinpoint diagnostics.

### 2026-07-10: Replacing the monthly summary cards — source-summary pattern
**Pattern:** When redesigning the accounting summary cards to use `getMonthlySourceSummary`:
- The action (`getMonthlySummary`) fetches current + prev month via `Promise.all` server-side and returns `{ current: MonthlySourceSummary, prevTotal: number }` — keeps the delta calculation off the client and avoids two separate effects.
- Use a local interface in view.tsx mirroring `MonthlySourceSummary` rather than importing from `@repo/data/analytics` (client bundle isolation).
- `salesCount` already exists in `Till` namespace; add it separately to `SiteAccounting` namespace for transaction counts — they're different plural formats and must remain independent.
- Remove `grandTotal`/`totalTax`/`orderTotal`/`reservationTotal` useMemos when they're no longer rendered; keep `totalTransactions` (used by the fiscal-tables empty-state guard).
- i18n: remove dead keys in one block replacement so en/es/fi stay in lock-step (73 keys each). Verify with `python3 -c "import json; [print(lang, len(json.load(open(f'messages/{lang}.json'))['SiteAccounting'])) for lang in ['en','es','fi']]"`.
**Prevention:** Run `npx tsc --noEmit` after the card swap to catch any dangling refs to removed computed variables.

## Test failures & fixes

### 2026-06-16: Mock-contract test — source parsing vs dynamic import
**Problem:** Writing a contract test that checks mocks are a superset of real module exports.
Two traps: (1) vitest aliases redirect `@repo/data/*` to mock files at import time, so
`vi.importActual('@repo/data/subscription')` still returns the mock. (2) Mock files use
`export const name = vi.fn()` — not `export const name = () =>` — so a strict
`(?:\(|function)` regex on mock sources returns no matches.
**Solution:** (a) Parse the REAL source files from `packages/data/src/*.ts` via `fs.readFileSync`
and regex — alias-independent, no DB side-effects. (b) Use two different regexes: narrow
pattern for real files (exclude exported object/const literals: require `(?:\(|function)`
after `=`); wide pattern for mock files (`export const (\w+) =` catches `vi.fn()`).
(c) For the Prisma client model list, use `Prisma.dmmf.datamodel.models` from `@prisma/client`
directly — connection-free, not aliased, gives PascalCase names.
(d) For the PrismaCient mock key check, parse the mock source for `/^  (\w+):\s*\{/gm`
(two-space-indented keys of the top-level object) — works without importing the TS mock.
**Prevention:** See `apps/partner/app/test/mock-contract.test.ts`. `spatial_ref_sys` is
excluded (PostGIS system table, never queried via Prisma delegate in partner). Do NOT
use `vi.importActual` with package paths for the "real" side; always use file paths.

### 2026-06-14: saveInventoryItemProperties dual-write mock exhaustion
**Problem:** Adding SunbedGroup dual-write to `saveInventoryItemProperties` added 3 extra `prisma.inventoryItem.findUnique` calls (fetch `sunbedGroupId` for current item, for pair, then re-fetch `siteId` for group creation). Existing test only mocked 3 calls; the 4th–6th returned `undefined`, crashing with `TypeError: Cannot read properties of undefined (reading 'id')` on `newGroup.id`.
**Solution:** Extend the `mockResolvedValueOnce` chain to cover all sequential `findUnique` calls in order, plus mock `prisma.sunbedGroup.create` and `prisma.inventoryItem.updateMany`.
**Prevention:** When a server action calls `findUnique` multiple times in sequence, count them carefully and chain `mockResolvedValueOnce` for each. Any un-mocked call returns `undefined` (not throws), so the crash can appear far from the missing mock.

### 2026-06-16: auth-matrix ok/reject predicate — downstream stubs vs auth errors
**Problem:** Auth-matrix "ok" scenario needed to distinguish "auth passed, downstream
stub returned error" from "auth gate rejected." A single `status === 'error'` predicate
would false-fail when the downstream mock returned wrong data (e.g. `markDeparted`
needs `operationalStatus: 'checked-in'`; with `'expected'` the action returns
`{ status: 'error', errors: ['Cannot mark departed from: expected'] }` — same shape as
an auth rejection). Setting up per-action stubs in a flat `beforeEach` is fragile.
**Solution:** Check the error *message* not just the status. Auth gate helpers emit a
fixed set of messages: `'Not authenticated'`, `'Not authorized'`, `'Invalid or expired
access key'`. assertReject verifies status='error' AND errors contains one of these.
assertOk verifies errors contains NONE of these (downstream errors like "Reservation not
found" are acceptable — the test only cares that auth passed). This made the runner
robust to stub gaps without forcing per-action stub configuration.
**Prevention:** See `AUTH_ERROR_MESSAGES` in `apps/partner/app/test/auth-matrix.ts`.
When extending the matrix to new actions, check that the auth-gate helper emits one of
those three messages on rejection.

### 2026-06-16: verifySiteOwnership vs verifySiteAccess scope divergence
**Problem:** Two separate token-gate implementations in the codebase with different scope
requirements. `verifySiteOwnership` (manage/actions.ts) uses `resources: { hasSome:
['all', 'manage_site'] }` — accepts either scope. `verifySiteAccess` (lib/auth-helpers.ts)
uses `resources: { has: 'all' }` — requires exactly `'all'`. A token with only
`'manage_site'` scope is accepted for manage-page actions but rejected for orders actions.
**Discovery:** Confirmed by reading both source files; NOT surfaced by unit-mode matrix
(mock returns null for both "wrong scope" cases — the Prisma where clause filter is not
executed on a vi.fn()). Requires integration test (Phase 0.2b) to confirm.
**Prevention:** When adding a new token-gated action, check which helper it uses and which
scope its tokens must include. Staff tokens for manage-only should use `'manage_site'`;
tokens needing full access (orders, etc.) must have `'all'`.

## Bug patterns & fixes

<!-- Recurring bug shapes specific to apps/partner -->

## Mollie lib tests

### 2026-06-17: Route-level tests for Mollie OAuth + subscription routes — mocking matrix
**Problem:** Seven route handlers (authorize, callback, client-link, readiness-check,
setup-test-merchant, subscription/checkout, subscription/portal) had 0% coverage. Each route
needed a different combination of mocks.
**Solution:** Mock matrix per route:
- `authorize`: mock `@/app/auth` + `@/app/api/_lib/mollie` (for `buildAuthorizationUrl`)
- `callback`: mock `@/app/auth` + `@/app/api/_lib/mollie` (all three exchange/profile/bootstrap
  fns) + `@repo/data/mollie-tokens` (for `mollieTokenExpiresAtFrom` — NOT aliased in vitest.config);
  pass cookies via the `cookie` header in `NextRequest`
- `client-link`: mock `@/app/auth` + `@/app/api/_lib/mollie` (createClientLink, getMollieClientId,
  OAUTH_SCOPES as a string constant)
- `readiness-check`: mock `@/app/auth` + `@mollie/api-client` (imported directly in the route,
  not via _lib/mollie) + `vi.stubGlobal('fetch', vi.fn())` for the methods/all HTTP call
- `setup-test-merchant`: mock `@/app/auth` + `@/app/api/_lib/mollie` (bootstrapMollieAccount)
- `checkout` / `portal`: mock `@/app/auth` + `@/app/api/_lib/stripe` (getStripeClient)
**CSRF verdict (callback route):** IMPLEMENTED CORRECTLY. The callback checks
`request.cookies.get('mollie_oauth_state')?.value !== state` and redirects with
`error=invalid_state` when the cookie is missing or mismatched. Tests confirm both rejection
paths and the happy path. `stripe.ts`'s `getStripeClient` stays at 0% coverage by design —
the function is always mocked to avoid real Stripe calls in unit tests.
**Prevention:** When a route handler imports `@repo/data/mollie-tokens` or `@mollie/api-client`
directly (not via `_lib/mollie`), they're NOT aliased in vitest.config.ts and must be explicitly
`vi.mock()`ed. Redirects return status 307; check `response.headers.get('location')`. To pass
cookies, use the `cookie` header in the `NextRequest` constructor options (NextRequest parses it
via `RequestCookies`).

### 2026-06-17: Testing mollie.ts: mocking boundary + scope separator
**Problem:** `app/api/_lib/mollie.ts` imports three different external concerns: raw `fetch`
(for OAuth token endpoints), the `@mollie/api-client` SDK (for clientLinks, profiles,
profileMethods, payments, paymentRefunds), and `@repo/data/mollie-tokens` (centralized
token manager that imports Prisma). The file also has a dynamic `import('@repo/data/PrismaCient')`
inside `bootstrapMollieAccount`. Getting all of these mocked without a real DB took three separate
strategies.
**Solution:**
- `vi.mock('@mollie/api-client', () => ({ default: vi.fn() }))` — replaces the SDK entirely.
  Each test sets `mockCreateMollieClient.mockReturnValue({ payments: {...}, ... })` locally.
- `vi.mock('@repo/data/mollie-tokens', ...)` + `vi.mock('@repo/data/env', ...)` — prevents
  the centralized token manager (which imports Prisma) from loading. Both resolved as mocked
  module paths, not as aliased paths.
- `vi.stubGlobal('fetch', vi.fn())` in `beforeEach` + `vi.unstubAllGlobals()` in `afterEach` —
  intercepts all raw `fetch(...)` calls at the global level.
- The dynamic `import('@repo/data/PrismaCient')` inside `bootstrapMollieAccount` resolves via the
  vitest.config.ts alias (no extra work needed — alias applies to dynamic imports too).
**Observation:** `OAUTH_SCOPES` joins scope names with `+`, but `URLSearchParams` encodes `+`
as `%2B`. The authorization URL ends up with `scope=payments.read%2Bpayments.write%2B...`.
Mollie's parser accepts this in production (partners connect successfully), so this is
functionally correct but non-standard (RFC 6749 specifies space-separated). If Mollie changes
behavior, switching `OAUTH_SCOPES` to use space (` `) as separator would produce the standard
form (`scope=payments.read+payments.write`).
**Prevention:** For any `app/api/_lib/` utility that mixes raw fetch + SDK + a @repo/data helper:
stub fetch globally, vi.mock the SDK and the data helper; let vitest.config.ts alias handle
Prisma. Don't use `vi.importActual` for @repo/data paths — aliases redirect them to mocks anyway.

## Component decomposition

### 2026-06-17: Decomposing view.tsx manage monolith — shared state boundary
**Problem:** The 1043-line `view.tsx` manage monolith mixed zoom/pinch/drag gesture state,
per-parcel reversed-order state, inventory grouping logic, summary computation, sectioned vs
scroll rendering paths, pool section, rental section, and modals all in one component. The
sectioned view used `containerWidth`/ResizeObserver to compute `chunkSize`; removing it meant
also dropping the ResizeObserver (the ref itself was still needed for the wheel-zoom handler).
**Solution:** Keep in `ManageView`: zoom state + refs (zoomRef, containerRef), pinch handler,
drag-to-pan handlers (passed as props to each `ParcelView`), reversed-parcel state,
inventory-grouping logic, summary computation, modal state. Extract to `ManageToolbar.tsx`
(occupancy pips + zoom buttons), `ParcelView.tsx` (one parcel's scroll grid + PoolSection),
`RentalsSection.tsx` (rental block). `PoolCell`/`PoolSection` live inside `ParcelView.tsx`
(colocated — they depend on bed-state helpers only used within the scroll grid).
**Gotcha:** The pinch handler finds the scroll container via
`(e.target).closest('.overflow-x-auto')`. Each `ParcelView` scroll div must keep that class
name for pinch-scroll-nudge to work. Verified kept in the `overflow-x-auto` div in ParcelView.
**Prevention:** When decomposing, map which gesture handlers reference which refs/state before
splitting. The drag-to-pan handler uses `e.currentTarget` (the scroll div) but is safe to pass
as a prop callback since the element capture (`el.setPointerCapture`) is inside the handler.

## Restaurant query tests

### 2026-06-17: Mocking @repo/table-reservations-core for queries.ts tests
**Problem:** `app/restaurants/[id]/queries.ts` imports read helpers (`getRestaurantById`,
`listTablesForRestaurant`, etc.) from `@repo/table-reservations-core`. That package uses the
aliased `@repo/data/PrismaCient`, so importing it in tests triggers the mock — but the core
functions still run real code, making test setup non-deterministic.
**Solution:** Fully mock `@repo/table-reservations-core` with `vi.mock('@repo/table-reservations-core', () => ({ ... }))`, listing only the functions used by the file under test. The `lib/auth-helpers.ts` is intentionally NOT mocked — it runs its real ownership logic through `auth()` + the mocked Prisma client, which is the actual regression guard.
**Pattern:** Mock only the "outbound calls" (core data helpers), but keep the "inbound gate" (`requireRestaurantOwner`) real. This way the tests prove that the ownership check actually runs and controls data access, not just that a mock returns null.
**Return shape:** The queries return `null` on failure (not `{ status: 'error' }`) — assert `toBeNull()`, not `res.status`. Spy on the core mock with `.not.toHaveBeenCalled()` to prove the gate fires before any data fetch.
**Prevention:** See `app/restaurants/[id]/queries.test.ts`. File is named `queries.ts`, not `*actions*.ts`, so the coverage-contract glob does NOT scan it — no allowlist entry needed.

## Manage page — hold/reserve/rent naming

### 2026-06-17: "Reserve" vs "Rent" vs "Hold" terminology on the manage page
**Context:** The manage page had a single "Reserve" button that was actually a paid walk-in
(status=`paid-in-cash`, operationalStatus=`walked-in`, `checkedInAt: now`). Adding a lightweight
hold (Alonso's `reservada` concept) required distinguishing the two.
**Decision (with user):**
- The old "Reserve" button → renamed **"Rent"** (`reserveItem` unchanged — paid walk-in, orange).
- A new **"Reserve"** button → lightweight hold (`holdBed`, yellow, today-only, no payment).
- Action row: Block | Comp | Reserve | Rent (left to right: maintenance, free, hold, paid).
**Hold implementation:** `status=RESERVATION_HELD` (`held`), `operationalStatus=OP_EXPECTED`
(`expected`). No new bed-state/color/`Item.tsx`/`ManageToolbar` changes — the hold renders as the
existing yellow "booked" lane and resolves via the existing check-in / no-show buttons. `RESERVATION_HELD`
is already in `BLOCKING_STATUSES` so a hold occupies the bed correctly. No DB migration — the
`status` column is a plain String.
**Cleanup:** Expired holds cleaned by the cron alongside stale walk-ins (same `createdAt < today-start
+ to < now` guards). Add `RESERVATION_HELD` to the `status: { in: [...] }` clause in
`app/api/reservations-cleanup/route.ts`.
**Prevention:** When extending the manage-page with a new lightweight state that maps to an existing
`operationalStatus`, check whether it needs any of the 7-file state-add checklist. A `held` hold
maps to `OP_EXPECTED` — zero state-file changes — but still needs: `actions.ts` action, gated-actions
registry, cleanup cron update, i18n, tests.

## Multiselect subset split

### 2026-06-21: Generalising per-seat split to multi-seat MULTISELECT subset
**Pattern:** `markDeparted(siteId, resId, accessKey, splitItemIds?: string[])` and `convertHoldToWalkIn(..., applyToGroup, splitItemIds?: string[])` now accept an array. When the array covers a PROPER SUBSET of the reservation's items, ONE new reservation is created with the whole subset (not one-per-seat). When the array covers ALL items, the action falls through to whole-depart/whole-convert.

**Gotcha 1 — lazy splitSet:** Computing `splitSet = (splitItemIds ?? [...]).filter(id => reservation.items.some(...))` unconditionally crashes when existing tests mock `findFirst` without `items`. Fix: wrap in `!applyToGroup && reservation.items ? ... : []` so `.some()` is never called when `applyToGroup=true` or `items` is absent.

**Gotcha 2 — existing callers must be updated to array form:** BedDetail.tsx passed `item.id` (string); integration tests passed `itemA.id` (string). Both must become `[item.id]` / `[itemA.id]`. TypeScript won't flag it because `string | undefined` matches `string[] | undefined` in some interpretations — only `(splitItemIds ?? []).filter is not a function` reveals the bug at runtime.

**view.tsx helper:** `getSelectionGroups()` maps selectedIds → `{ anyItemId, selectedItemIds, isSubset }` per reservationId, using `inventoryItems` (full floor, not just selection) for `totalSeats`. `bulkRent` uses `isSubset` to pick `applyToGroup=false` + `splitItemIds` vs `applyToGroup=true`; `bulkDepart` uses it to pass `selectedItemIds` or no-ids.

## Till conservation in per-seat walk-in operations

### 2026-06-21: unreserveItem disconnect + splitWalkInSeat — till conservation pattern
**Problem:** Freeing one seat of a multi-seat cash walk-in (Seat-unreserve or Seat-collect split) without reducing `paymentAmount` leaves the freed seat's cash counted in the till even though the guest is no longer there. The depart-split in `markDeparted` handled this correctly; the disconnect path in `unreserveItem` and the new `splitWalkInSeat` action needed the same treatment.

**Fix — `unreserveItem` disconnect path:** The `findFirst` select was changed from `include: { items: true }` to `select: { id, from, to, items: { select: { id, price } }, site: { select: { type, price } } }`. On the `items.length > 1` branch, `computeWalkInAmount(remainingItems, site.price, from, to)` is called and the update now carries `paymentAmount: remainingAmount` alongside `items: { disconnect }`. The whole-delete path (single item or `applyToPair=true`) is unchanged — deleting removes all cash from the till naturally.

**New action — `splitWalkInSeat(siteId, reservationId, itemId, accessKey)`:** "Peel without departing." Same `$transaction` shape as depart-split in `markDeparted` but without the depart transition — the new reservation stays `walked-in`. Returns `{ status: 'ok', reservationId: <newId> }`. Only valid for `paid-in-cash` + `walked-in` + `items.length > 1`. Returns errors for: online collected (complete), single-item, item not on reservation. Attribution (employeeId, guestName, userId, from, to, checkedInAt) is copied to the new reservation.

**BedDetail wiring (Collect button):** Added `collectTargetId` state (default null). In Seat mode (`groupedReservation && !applyToGroup`): call `splitWalkInSeat` inside a transition, set `collectTargetId = result.reservationId`, then open the modal. In Group mode: set `collectTargetId = reservation.id` directly. `CollectPaymentModal` actions now bind to `collectTargetId`. On close: reset both `setShowCollect(false)` AND `setCollectTargetId(null)` — if only one resets, a stale id leaks into the next open.

**Till conservation invariant:** `original.paymentAmount + new.paymentAmount == originalTotal` when prices are unchanged. Assert this in integration tests, not just that the individual values are correct.

**Registration:** `splitWalkInSeat` is a gated action — registered in `app/test/gated-actions.ts` as `token-or-session`, same as all other manage actions.

**Test pattern for `$transaction` with captured tx args:** Mock `prisma.$transaction.mockImplementationOnce(async (fn: any) => fn({ reservation: { update: vi.fn().mockImplementation((args) => { captured = args; return {} }), create: vi.fn()... } }))`. This intercepts both sides of the transaction with independent captures.

## Cash walk-in rental TillEntry (track 013 P3b)

### 2026-06-21: createWalkInRental — genuine cash vs Card(QR) settlement distinction

**Problem:** After P3a re-sourced the till from the ledger, cash walk-in rentals no longer hit the till because no `TillEntry` was recorded. The fix needed to call `recordSettlement` for genuine cash — but the Card(QR) path also calls `createWalkInRental` with `paymentType='cash'` (so paymentAmount is persisted before `collectRentalPayment`/Mollie). Recording a TillEntry on the card path would double-count: once as cash, once when Mollie settles.

**Distinguishing signal — `recordCashSettlement: boolean` param:** `CreateRentalModal` distinguishes cash/card/free in its own state (`paymentType: 'cash' | 'free' | 'card'`). It wires `paymentType = paymentType === 'card' ? 'cash' : paymentType` for the action, then passes `recordCashSettlement: paymentType === 'cash'` (so card → false, cash → true, free → false because paymentType becomes 'free'). The action records a `TillEntry` per booking only when both `recordCashSettlement === true` AND `paymentType === 'cash'` AND `paymentAmount > 0`. Free bookings auto-skip even if the flag were somehow set (paymentAmount 0 guard).

**Amount source:** Per-booking amount comes from `bookingInputs[i].paymentAmount` — the already-computed DB-fetched price passed to the guard. Never recomputed after guard returns (payments.md). Map booking index → amount before the Promise.all.

**Mock update:** `voidSettlementsForRentalBooking` must be added to `apps/partner/__mocks__/@repo/data/till.ts` whenever the real `@repo/data/till` gains it — the mock-contract guard enforces this.

**Test invariants:** (1) genuine cash → `recordSettlement` called with `rentalBookingId` + the per-booking amount; (2) card path (recordCashSettlement omitted) → `recordSettlement` NOT called; (3) free → NOT called. Assert all three in unit tests. Integration: cash → `TillEntry` exists with `voidedAt: null`, `getTillStatus` reflects it; card path / free → zero entries.

## BedDetail state-machine patterns

### 2026-06-17: convertHoldToWalkIn — in-place UPDATE vs delete+create; multi-day extension
**Today-only path:** When a held guest arrives (staff taps "Rent" in the Held panel with no `until`),
the hold is converted IN PLACE via `prisma.reservation.update` — same row, same items, same today
range. NO conflict re-check is needed: the seat is already occupied by this hold.
**Multi-day extension (`until` param):** A hold only covers TODAY. Extending `to` into future days
opens a race window: a concurrent consumer booking on those days could land between the `findFirst` and
the `update`. Fix: run find + conflict-check + update in one `prisma.$transaction` with a `SELECT ...
FOR UPDATE` lock on the item rows (same pattern as `reserveWithConflictGuard`). The conflict query
excludes the hold's own id (`id: { not: hold.id }`) — otherwise the hold itself (which overlaps today)
appears as a false-positive conflict.
**$transaction mock:** The PrismaCient mock implements `$transaction: vi.fn((arg) => arg(prisma))`
(i.e. the tx callback receives the same mock prisma client). Unit tests can therefore wire up
`reservation.findFirst` call sequences (first: hold lookup, second: conflict check) and
`reservation.update` on the same mock without any extra setup.
**Contract:** `toDate` is always written (including today-only), so the walk-in has an authoritative
`to` regardless of what the original hold stored.

### 2026-06-17: shared confirmPanel + pendingConfirm — extending to walk-in actions
**Gotcha:** `runPendingConfirm` previously required a non-null `reservation` as a precondition
before dispatching any case. When `'unreserve'` was added (which targets `item.id`, not
`reservation.id`), the top-level null-guard had to be removed from `runPendingConfirm` and moved to
the individual branches that actually need the reservation object (`'no-show'`, `'depart'`). The
`'cancel'` and `'unreserve'` branches use `item.id` and don't need `reservation`.
**Prevention:** When adding a new `PendingConfirm` case that doesn't need `reservation`, guard
per-branch, not at the top of `runPendingConfirm`.

### 2026-06-17: inSync-gated toggle + walk-in disconnect depart
**Invariant (group/pair scope toggle):** The two-option [Group/Pair | Seat] toggle in `BedDetail`
must only render when `inSync` (all `groupItems` share the same active reservation id as the
selected item, or all are free). An out-of-sync group (e.g. one seat walked-in, one seat free) must
collapse to a single non-interactive "Seat" indicator. Otherwise:
- The "Group" button is shown for a state where only one seat can be acted on → staff confusion.
- Attempting a Group walk-in/block/comp on a partially occupied pair hits the conflict guard.
**Implementation:** Move `thisResId`/`inSync` computation BEFORE `pairNumber`. Use `reservation?.id`
(not a second `getActiveReservation(item)` call — `reservation` is already computed). Gate
`pairNumber` on `inSync` by adding `|| !inSync` to its undefined condition.
`applyToPair` defaults to `inSync` and can only be toggled via the Group button; when `!inSync` no
Group button renders, so `applyToPair` stays `false` even if it happens to equal the old `true` value
from a prior `useState(inSync)` call before the item change — the `useEffect` re-sets it on `item.id`.

**Walk-in Depart dispatch:** A paired walk-in shares ONE reservation row (all seats in the group are
connected to the same Reservation record). When staff pick "Seat" mode (`!applyToPair`) and confirm
Depart, calling `markDeparted(reservationId)` would set `operationalStatus=departed` on the whole
row, immediately freeing the other seat. The correct "one seat left" semantic is to disconnect just
this item: `unreserveItem(itemId, ..., false)`. Condition: `state === 'walked-in' && !applyToPair &&
inSync && groupItems.length > 0`. All other depart paths (Group mode, non-grouped walk-in, checked-in
depart, out-of-sync seat reservation) keep `markDeparted(reservationId)`.

**`cancelReservation` applyToPair removal:** Cancel is whole-reservation by design (the status update
covers all items in the booking). The `applyToPair` param was never used by any call site that
actually passed it — it was always the default. Remove it so the signature is honest and the
auth-matrix invoke and test call sites can stay simple.

## Bug patterns & fixes

### 2026-06-21: Prisma upsert is not atomic — RSC-prefetch concurrency crash on manage page
**Problem:** `prisma.reservationDay.upsert()` with `update: {}` (no-op) is implemented as SELECT-then-INSERT/UPDATE inside Prisma — NOT a single atomic statement. Next.js RSC prefetch fires the manage page route 4× simultaneously. Two renders both see "no row" for the same `(reservationId, date)` pair, both attempt INSERT, and the loser throws `PrismaClientKnownRequestError: P2002 Unique constraint failed`. The error surfaced at `resolveTodayRow` inside `ManagePage` — page crashed for all concurrent prefetch requests.
**Fix (two cases):**
- **`resolveTodayRow`** — `update: {}` is a no-op; the row the winner wrote is exactly what we want. Wrap the upsert in try/catch; on `P2002` re-fetch with `findUniqueOrThrow` on the same composite key and return that. Never re-throw P2002 from this path.
- **`applyDayTransition`** — `update` carries real state; re-fetching the winner's row would lose our transition. Wrap the entire `$transaction` call in a helper `runTransaction()`, catch P2002 at the outer level, and RETRY (call `runTransaction()` again). The retry finds the row and takes the update branch. The legacy mirror write stays inside the same transaction — both writes happen together or not at all.
**P2002 detection idiom** (repo convention): `(err as { code?: string }).code === 'P2002'` — duck-typed, no `PrismaClientKnownRequestError` import needed (follows `packages/data/src/impersonation.ts`).
**File:** `apps/partner/app/sites/[id]/manage/reservation-day.ts`
**Test:** Added two bug-revealing integration tests in `actions.integration.test.ts` (describe `resolveTodayRow — concurrent upsert race safety`): `Promise.all` on the same reservation+date asserts both calls resolve to the same row id without throwing; a second test confirms different-reservation concurrent calls all succeed.
**Prevention:** Any lazy get-or-create (`upsert` with `update: {}`) that runs under RSC-prefetch or other concurrent request patterns hits this race. Either (a) add a DB-level partial unique index + `INSERT ... ON CONFLICT DO NOTHING RETURNING *` via `$queryRaw`, or (b) use the try/catch P2002 + re-fetch pattern above. Option (b) keeps Prisma ergonomics and is the established repo pattern.

## Manage surface routing

### 2026-07-10: Token-gated sub-routes and admin-tier gating on the manage surface
**Pattern:** The manage surface uses a shared `validateManageToken` (in `manage/token.ts`) that
returns `{ ok, isAdmin, site: { id, name } }`. Sub-routes follow a uniform server-page convention:
1. Call `validateManageToken(params.id, key)` — render `<ErrorCard showBackLink={false} />` on failure.
2. For admin-only pages: additionally check `!result.isAdmin` — render another `ErrorCard` (defense-in-depth; the actions gate too).
3. Pass `accessKey`, `siteId`, `siteName`, `backHref` down to the client view component.

`DailySummaryView.tsx` is the admin-only full-page till view at `/manage/summary`. The action gate is
`verifySiteAdmin` (requires `'admin'` in token resources) — stricter than the standard
`verifySiteAccess` (`['all','manage_site']`) used by the floor-staff manage and orders surfaces.

**Token scope tiers:**
- `['all']` or `['manage_site']` → floor staff operations (sunbeds, orders)
- `+ ['admin']` → admin summary operations (`getOpenTills`, `getTillDayReport`, `closeTill`, `closeDay`)

**Prevention:** When adding future admin-only manage sub-routes, use the same two-check pattern
(ok check + isAdmin check) in the server page, `DailySummaryView` as the reference client impl.

### 2026-07-10: closeDay — cash-up only, does not touch the floor
**Contract (pinned 2026-07-10):** `closeDay` is **cash-up only** — it calls `closeAllOpenTills(siteId)` and returns `{ status, closedCount, totalClosed }`. It does NOT mutate any `Reservation` row. A real calendar-day change in Sunbnb mutates no reservations automatically (occupants age out of the date window, stayovers carry over, blocks persist), so `closeDay` matching "same effect as a day change" means leaving the floor completely untouched.
**Why the depart step was removed:** The original implementation bulk-updated `CHECKED_IN`/`WALKED_IN` reservations to `DEPARTED` via `prisma.reservation.updateMany`. This was wrong — it treated end-of-day as a hard checkout, conflicting with multiday stays and stayover semantics. The cleanup cron + per-day `ReservationDay` rows handle expiry automatically.
**Return shape:** `{ status: 'ok', closedCount: number, totalClosed: number }`. No `departedCount` field — its absence is the contract. Unit test asserts `(result as any).departedCount` is `undefined`.
**Regression test:** integration test seeds `CHECKED_IN` and `WALKED_IN` reservations, calls `closeDay`, and asserts they remain `CHECKED_IN` / `WALKED_IN` afterwards. This pins the cash-up-only contract against regressions.
**Idempotency:** `closeAllOpenTills` re-runs safe (no-op when all tills at zero) — `closedCount: 0, totalClosed: 0` on re-run.
**Employee fixture gotcha (integration tests):** `Employee.accountId` → FK to `PartnerAccount`, NOT `User`. Always call `createTestPartnerAccount(user.id)` before `prisma.employee.create({ data: { accountId: user.id } })`.

### 2026-07-10: DayCloseView — todayIso derivation and dual-fetch pattern
**Pattern:** The `close/page.tsx` server page must derive the venue-local `YYYY-MM-DD` string to pass to `DayCloseView`. Use `siteDayKey(buildSiteTimezone(siteMeta))` — exactly the same helper `sunbeds/page.tsx` uses with `siteDayBounds`. `validateManageToken` returns only `{id, name}`, so one extra `prisma.site.findFirst({ select: { timeZone, locationLat, locationLng } })` is needed.
**Client fetch strategy:** `DayCloseView` fires both `getTillDayReport(siteId, todayIso, accessKey)` and `getOpenTills(siteId, accessKey)` in a single `Promise.all` on mount. The report shows today's per-employee totals; `getOpenTills` provides the open-till count for the pre-close note. After a successful `closeDay`, re-fetch only the day report (open tills become zero).
**Two-step confirm state:** `ClosePhase = 'idle' | 'confirming' | 'closing' | 'done'` — mirrors `DailySummaryView`'s `ClosePhase` pattern. 'done' hides the confirm section and shows the success card with back-to-menu link.
**Pre-close note copy:** Cash-up only — note says how many open tills will be closed. Only rendered when `openTillsCount > 0` (hide when all already closed; no "all tills already closed" variant needed). Success state shows tills closed + total; no guest/depart line.

## Rejected approaches

### 2026-06-15: React onWheel prop for wheel zoom (passive listener no-op)
**Problem:** React's synthetic `onWheel` prop attaches a passive listener. Calling `e.preventDefault()` inside it is silently ignored by the browser — the native page zoom fires anyway (and on macOS, ctrl+wheel triggers OS-level zoom).
**Solution:** Register via `el.addEventListener('wheel', handler, { passive: false })` inside a `useEffect` on the element ref, with cleanup `removeEventListener`. This is what `SchematicRenderer.tsx` does (lines 340–363).
**Prevention:** Any time you need to `preventDefault()` on a wheel event, skip `onWheel` prop and use the manual `addEventListener` pattern. The eslint-disable comment on the empty dep array is standard for this pattern — the handler reads a ref, not state.
