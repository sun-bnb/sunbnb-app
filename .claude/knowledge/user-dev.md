# user-dev playbook

`user-dev`'s curated, growing memory for `apps/user`. Governed by
`.claude/knowledge/README.md` (layer spec + trust ladder). Grow it via the gated
retrospective; curate it via `workflows/groom.md`.

## Navigation index

What this playbook knows, by theme. Maintained by grooming; scan it before reading
sections.

- **Payment flow** — Stripe / Mollie / demo issues — _none yet_
- **Anonymous (anonId) flow** — POS/QR ownership, localStorage — `anonId` must be a valid UUID v4 in tests (2026-03-17)
- **Webhook & polling** — webhook failures, polling races, reconciliation — tab payment revert asymmetry (2026-07-19); adaptive dine-in tab polling, testing timers with no jsdom (2026-07-23)
- **Test failures & fixes** — mock/fixture gotchas — `rentalBooking.findUnique` missing from mock (2026-06-19)
- **i18n & locale** — next-intl edge cases — _none yet_
- **Sunbed preselection / reserve-first flow** — pair resolution, dispatch loop, single-day default — (2026-07-09)
- **Integration test infra** — `sunbnb_test` deadlocks were cross-session contention, not container/infra rot — never run two integration suites concurrently (2026-07-25)
- **Rejected approaches** — dead-ends, so nobody re-tries them — _none yet_

---

## Payment flow

<!-- Entry format:
### YYYY-MM-DD: <concise title>
**Problem:** what went wrong / what was non-obvious
**Solution:** what actually worked
**Prevention:** how a future session avoids it (cite path/file.ts#symbol) -->

## Anonymous (anonId) flow

### 2026-03-17: anonId UUID validation broke existing tests using 'anon-123'
**Problem:** Adding UUID format validation to `getRequestIdentity` in `app/api/_lib/auth.ts` caused two existing tests to fail — they passed `'anon-123'` as `anonId`, which is not a valid UUID. The route then returned 401 because identity was null.
**Solution:** Updated the test values in `route.test.ts` files for `/api/reservations/[id]` and `/api/payment/stripe/payment-intent` to use a valid UUID (`550e8400-e29b-41d4-a716-446655440000`).
**Prevention:** Any test that exercises anonymous auth must use a valid UUID v4 string for `anonId`. The format is `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`.

### 2026-06-19: Conditional-skip ownership bug pattern in rental Mollie route
**Problem:** `app/api/payment/mollie/create-rental-payment/route.ts` had `if (identity.userId && booking.userId !== identity.userId) { reject }`. When `identity.userId` is falsy (anon path), the entire condition body is skipped — an anon caller with the wrong `anonId` (or no `anonId`) was let through silently.
**Solution:** Replace with `verifyOwnership(identity, booking)` (the shared helper from `app/api/_lib/auth.ts`), called unconditionally for every booking in the group. The helper returns `false` for any identity that doesn't match, anon or session.
**Prevention:** Never write `if (identity.userId && ...)` as an ownership guard — the identity may legitimately have no `userId` (anon path). Always use `verifyOwnership(identity, entity)` which handles both paths and returns `false` (deny) by default.

### 2026-06-19: anonId UUID validation must fire before ownership check in server actions
**Problem:** In `initiateDemoRentalPayment`, adding `anonId` format validation at the top of the function (before DB access) meant that test fixtures using informal strings like `'anon-real'` or `'anon-wrong'` got `'Invalid anonId format'` instead of reaching the ownership logic, masking the actual bug being tested.
**Solution:** In tests for anon ownership paths, use valid UUID v4 strings (e.g. `'550e8400-e29b-41d4-a716-446655440000'` and `'660e8400-e29b-41d4-a716-446655440001'`) to ensure the UUID validator passes and the ownership logic is actually exercised.

## Webhook & polling

### 2026-07-19: Tab payment claim — revert-on-failure asymmetry (demo vs Mollie)
**Problem:** Two similar payment flows (Mollie route and demo action) have subtly different revert policies after setting `paymentRef`. In the Mollie route, if `getCheckoutUrl()` returns null after a successful Mollie API call, we do NOT revert (paymentRef is already on Mollie's side — poll route will recover). In the demo action, if `processConfirmedTabPayment` throws after setting paymentRef, we also do NOT revert — the payment is considered made and the poll route will retry.
**Solution:** Only revert the `TAB_PENDING_PAYMENT → TAB_OPEN` claim (clearing `paymentRef: null`) when the failure happens BEFORE a real payment commitment: credential failures, zero-total, Mollie API errors. Once paymentRef is set (either on the tab row or confirmed by Mollie), never revert — return ok and let the poll route recover.
**Prevention:** The rule: revert = before-commitment failures; no-revert = after-commitment failures. Apply to any new payment type that follows this claim-before-total pattern.

### 2026-07-19: getTabState visibility — openTableId nulls at CLOSE, not at pending_payment
**Problem:** Easy to misread the `TableTab.openTableId` guard as clearing when payment starts. It does NOT: the pay claim only flips `status` open→pending_payment; `openTableId` stays set (that is what lets `placeTabOrder` find the tab and reject with "payment in progress", and what keeps the dine view's pending_payment banner working). `openTableId` is nulled only by tab-CLOSING paths (paid / settled_cash / discarded), after which `getTabState` returns `tab: null`. A phase-4B report stated the opposite ("returns null the moment a tab transitions to pending_payment") — that claim is wrong; the shipped code is correct.
**Solution:** Companion-phone paid detection in the dine view relies on exactly this: poll shows `pending_payment` (tab still visible) → later poll shows `null` (tab closed) ⇒ treat as paid. Note `settled_cash` also produces this transition (still "paid", by cash); `discarded` does too (rare walk-out path — accepted v1 imprecision).
**Prevention:** When reasoning about tab lifecycle, check the closing paths in `processConfirmedTabPayment` (and future settle/discard actions): every one MUST null `openTableId` in the same update that sets the terminal status, and NONE of the non-terminal transitions may touch it.

### 2026-07-19: TAB_OPEN constant used as revert target in guarded updateMany
**Problem:** The webhook `handlePaymentFailed` for `tab` type uses `data: { status: 'open', paymentRef: null }` — not the `TAB_OPEN` constant — because the constant isn't imported in the test fixture but the string `'open'` IS what Prisma stores (it equals `TAB_OPEN`). Using the constant import is cleaner but the string literal is what test assertions compare against.
**Solution:** In production code use `TAB_OPEN` constant (imported). In test assertions, compare against `'open'` string literal (or the constant if imported). The guarded `where: { status: TAB_PENDING_PAYMENT }` is the critical safety constraint preventing a late failure from reopening a paid tab.
**Prevention:** When writing tests for revert logic, assert the EXACT where-clause guard: `{ id: tabId, status: 'pending_payment' }`. If the guard is missing, a paid tab could be reopened by a replayed webhook.

### 2026-07-23: Extract timer/scheduling logic to a pure exported function when there's no jsdom
**Problem:** `apps/user` has NO jsdom/testing-library (confirmed via `package.json` devDependencies and `vitest.config.ts` — no `environment: 'jsdom'`, default is `node`). A client component's `useEffect` polling logic (e.g. `DineView`'s tab poll) can never be exercised by rendering — existing tests in this file only replicate logic inline (parallel copies), which is weak (doesn't catch drift between the copy and the real implementation).
**Solution:** For `view.tsx`'s adaptive poll (5s cadence while visible, paused hidden, immediate refetch on visibility return), extracted the whole scheduler into a standalone exported pure function `createTabPoller({ fetchTab, intervalMs, doc })` returning `{ start, stop }` — no React, no refs, just closures + `setTimeout`/`visibilitychange`. The `useEffect` shrinks to `const poller = createTabPoller({ fetchTab }); poller.start(); return () => poller.stop()`. The test file imports `createTabPoller` directly from `./view` and drives it with `vi.useFakeTimers()` + a hand-rolled `EventTarget`-like stub object (a `Set` of listeners + a `setVisibility()` helper that invokes them synchronously) — no need for a real DOM `document`.
**Prevention:** When a client-component effect has non-trivial scheduling/timer logic you need to unit-test bug-revealingly, extract it to a plain exported function taking its dependencies (including `document`) as injectable params, rather than writing a parallel "replica" test that only proves the test author's own understanding, not the shipped code. This works within a single-file scope boundary too — the extracted function doesn't need to move to a new file, just needs a named export.

### 2026-07-23: TS interface method params trigger apps/user's no-unused-vars in TYPE position — Pick<> sidesteps it
**Problem:** Declaring `interface Foo { addEventListener(type: 'x', listener: () => void): void }` in `apps/user` (which uses the plain `no-unused-vars` from `eslint:recommended` via `packages/eslint-config/next.js`, NOT `@typescript-eslint/no-unused-vars`) flags `type`/`listener` as unused — even prefixing with `_` (the usual escape hatch) does NOT suppress it, because the ignore pattern only applies inside function *implementations*, not type-only declarations. `packages/eslint-config/react-internal.js` documents this exact bug ("The base no-unused-vars misreports parameter names in TYPE positions") and disables the rule in favor of the TS-aware one — but `next.js` (what apps/user extends) does not.
**Solution:** Don't hand-write the interface. Reference the ambient lib type instead: `export type PollDocument = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>`. No new parameter names are declared in your source, so there's nothing for the misfiring rule to flag, and a plain stub object (contextually typed against the `Pick`) still satisfies it.
**Prevention:** In apps/user (and any package still on the plain `next.js` eslint config, not `react-internal.js`), avoid hand-rolled interfaces for small subsets of a DOM/lib type — use `Pick<>`/`Omit<>` against the real lib type instead. Check `npm run lint` on the specific file before assuming underscore-prefixing param names fixes a type-position warning.

## Cron route patterns

### 2026-06-19: Independent try/catch per email type in the cron route
**Problem:** If two email batches share a single try/catch, a failure in the first batch 500s the whole request and discards the already-sent work of the second batch (which hasn't run yet).
**Solution:** Separate try/catch blocks with counters defaulting to 0. Each batch runs regardless of the other's outcome. The route always returns 200 with whatever counts were produced. Errors are `console.error`-logged.
**Prevention:** When adding a second async batch to a cron route, never wrap both in one try — use independent catches so partial success is always reported. See `app/api/cron/send-reminders/route.ts`.

### 2026-06-19: `sendDueReminders` missing from reservation-emails mock
**Problem:** `__mocks__/@repo/data/reservation-emails.ts` had individual email helpers but not the batch `sendDueReminders`. The cron route imports `sendDueReminders`, so any cron unit test would fall through to the real Prisma-backed function and fail with a DB error.
**Solution:** Add `export const sendDueReminders = vi.fn().mockResolvedValue(0)` to the reservation-emails mock.
**Prevention:** Before writing route tests that import a cron-level batch function, verify it's in the mock. The mock only had per-reservation email helpers, not the cron-facing aggregator.

## Test failures & fixes

### 2026-06-19: rentalBooking mock missing `findUnique` broke route unit tests
**Problem:** `__mocks__/@repo/data/PrismaCient.ts` had `rentalBooking` with `findFirst/findMany/create/updateMany/aggregate` but NOT `findUnique`. The `GET /api/rental-bookings/[id]` route calls `prisma.rentalBooking.findUnique(...)`. Without the mock entry, calling the route in unit tests silently calls `undefined()` and throws, rather than returning a controlled mock response.
**Solution:** Add `findUnique: vi.fn()` to the `rentalBooking` section of the mock.
**Prevention:** Before writing route unit tests, verify the mock shape matches every Prisma method the route calls. If it's missing, add it — `undefined()` errors are confusing because they surface as test errors rather than mock setup warnings.

## i18n & locale

<!-- next-intl edge cases, missing translations, locale detection -->

## SunbedGroup migration pattern

### 2026-06-14: POS direct-item page — group-first, pair fallback
**Problem:** `pos/[itemId]/page.tsx` built the reservation item list from `item.pair || item.pairedBy` (single pair). As `SunbedGroup` becomes source of truth for paired beds, the page needed to resolve siblings from the group first.
**Solution:** In the `sunbedGroup` include, switch from `items: { select: { id: true } }` to `items: { include: { reservations: true } }` so sibling items carry all scalar fields + reservations (same shape as the top-level `item`). Resolution: filter `sunbedGroup.items` to exclude `item.id`, use `[item, ...otherGroupMembers]`. Fall back to `pair || pairedBy` when no group is present (un-migrated beds).
**Prevention:** When expanding a `sunbedGroup.items` include to carry sub-relations, use `include: { ... }` not `select: { ... }` — Prisma can't combine both at the same nesting level. All scalar fields are returned automatically with `include`.

## Equipment rental anon flow (Track 009)

### 2026-06-19: EquipmentBookingSection anon gate was UI-only, backend was already ready
**Problem:** `EquipmentBookingSection` had `!session?.user?.id` early-returns in `handleBook` and `handleConfirmBooking`, plus a "Login to reserve" hard-gate in the render — blocking anon users entirely. The backend (`saveRentalBooking`) already accepted `anonId` + `guestEmail` from Phase 1–3 work.
**Solution:** Added `guestEmail` + `emailError` state to `EquipmentBookingSection`, added email validation in `handleBook` (mirrors `ReservationButton`), removed both `!session?.user?.id` early-returns, read/generated `anonId` in `handleConfirmBooking` (same localStorage pattern as sunbed flow), passed `anonId` + `guestEmail` into `saveRentalBooking`, threaded `anonId` into the unpaid-site navigation URL. Replaced the login-only button render with the anon affordance (email input + "Reserve as guest" + "Sign in instead" link).
**Prevention:** When adding auth-gated features, check that the backend server action already supports anon (look for `anonId?` parameter). If it does, the UI is the only change. All i18n keys for the anon affordance (`Email`, `Enter a valid email`, `Reserve as guest`, `Sign in instead`) already existed in `SiteView` from the sunbed flow — no new keys needed.

## Rental cancellation (Track 009 Phase 5b)

### 2026-06-19: paymentRef-group cancel — one refund for all bookings sharing a payment
**Problem:** A single Mollie payment can cover multiple `RentalBooking` rows (see `processConfirmedRentalBooking` — groups by `paymentRef`). Cancelling one booking must cancel all siblings and issue exactly one `issueRefund(paymentRef)`, not one per row.
**Solution:** In `cancelRentalBooking`, after the ownership/terminal-state guard, cancel by `paymentRef` via `updateMany({ where: { paymentRef } })` when a `paymentRef` exists; fall back to `updateMany({ where: { id } })` for unpaid (no paymentRef) bookings. Issue at most one `issueRefund(paymentRef)` call.
**Prevention:** Any rental cancel action must think in paymentRef groups, not individual rows. The test for this is "create two bookings with same paymentRef → cancel one → assert both canceled + one refund".

### 2026-06-19: Past-pickup terminal guard for rental cancellations
**Problem:** Rental cancellation must not be allowed once the item has been picked up or returned — the service has been delivered. The status groupings (`TERMINAL_STATUSES`) apply to reservation payments, not rental operational statuses.
**Solution:** Explicit guard: reject if `operationalStatus === OP_PICKED_UP || operationalStatus === OP_RETURNED`. Also guard `status === RENTAL_CANCELED || status === RENTAL_REFUNDED` (already terminal) — return idempotent ok.
**Prevention:** Always check both the payment status AND the operational status for rental cancellation. The rental analogue of the sunbed TERMINAL_STATUSES list does not exist as a shared constant — write explicit guards.

### 2026-06-19: Anon ownership in a server action (no getRequestIdentity helper)
**Problem:** `getRequestIdentity` is an API-route helper that reads the session via `NextRequest`. Server actions can't call it. The pattern for server actions is explicit: `if (session?.user?.id) { check userId } else { check anonId }`.
**Solution:** After fetching the booking, use `if (session?.user?.id) { if (booking.userId !== session.user.id) reject } else { if (!booking.anonId || booking.anonId !== anonId) reject }`. Validate anonId as UUID v4 before the DB fetch to fail fast.
**Prevention:** Server actions own their identity check inline. API routes use `verifyOwnership`; server actions use the two-branch pattern above. Never write `if (identity.userId && ...)` — always use an else to cover the anon path.

## Sunbed preselection / reserve-first flow (Track 014)

### 2026-07-09: Pairing is one-directional — walk BOTH pair and pairedBy to resolve
**Problem:** `InventoryItem.pair` only exists on the PRIMARY (the item that was paired TO another). The SECONDARY holds a back-pointer `pairedBy`. If you only walk `item.pair`, you miss half of all sunbeds in a pair (any secondary will look unpaired).
**Solution:** In `resolveSelectionSet` (and `pickFirstAvailablePair`): check `item.pair?.id ?? item.pairedBy?.id` to get the partner id, then look up the partner by id from the full inventory list. SunbedGroup (if present) supersedes bare pair pointers.
**Prevention:** Never write "resolve the partner" as just `item.pair`. Always check BOTH directions. See `apps/user/app/sites/[id]/sunbed-preselection.ts` for the canonical implementation.

### 2026-07-09: Pure preselection helpers extracted to avoid Google Maps import in tests
**Problem:** Preselection logic was initially written inline in `SunbedSelection.tsx`, which imports `@vis.gl/react-google-maps`, `next/image`, MUI, etc. Importing the component in vitest (no DOM) would crash the test.
**Solution:** Extract the two pure functions (`resolveSelectionSet`, `pickFirstAvailablePair`) to `apps/user/app/sites/[id]/sunbed-preselection.ts`. `SunbedSelection.tsx` re-exports them via `export { ... } from ...` for backward-compatible imports. Tests import the pure module directly.
**Prevention:** Any pure/testable logic that lives in a client component file with heavy browser deps should be extracted to a sibling `.ts` file. The test config (`vitest.config.ts`) only scans `app/**` and `store/**` — place tests in those directories.

### 2026-07-09: preselection useEffect must NOT depend on selectedItems to avoid dispatch loop
**Problem:** The `useEffect` that preselects items runs when `availabilityResponse` changes. If `selectedItems` were also in the dep array, every dispatch inside the effect (which changes `selectedItems`) would re-trigger the effect, causing an infinite loop.
**Solution:** Keep deps as `[availabilityResponse]` only. Read `selectedItems` from the outer closure (snapshot); it's captured at the time the effect fires, which is correct. The user toggling a seat changes `selectedItems` but NOT `availabilityResponse`, so preselection does NOT re-run on toggle — desired behavior.
**Prevention:** Effects that dispatch to Redux slices must not include the dispatched slice value in their dep array. The ESLint exhaustive-deps rule would flag this — but since we intentionally exclude `selectedItems`, document the reason in a comment (done in the code).

### 2026-07-09: Single-day default for sunbed reservations
**Problem:** The `dateRange` fallback in `SunbedSelection.tsx` and `Reservation.tsx` (the `ReservationTimerangeSelector`) used `dayjs().add(1,'day').endOf('day')` as the end — creating a 2-day default. A first-time visitor who didn't touch the picker would book 2 days instead of 1.
**Solution:** Change to `dayjs().endOf('day')` in both files (days-mode only — hours-mode untouched). Files: `components/reservation/SunbedSelection.tsx` (dateRange fallback, ~line 289) and `app/sites/[id]/Reservation.tsx` (ReservationTimerangeSelector dateRange fallback, ~line 111).
**Prevention:** Default date ranges must be single-day for a sunbed booking app. The committed `dateRange` in the availability useEffect derives from this fallback when `sitesState.dateRange` is null, so fixing the fallback fixes the committed value too.

## Integration test infra

### 2026-07-25: `sunbnb_test` deadlocks (`40P01`) / phantom FK failures = another session's integration run on the same DB — check pg_stat_activity before blaming infra or your diff
**Problem:** `npm run test:integration` in `apps/user` produced non-deterministic failures — `FK constraint violated` immediately after a fixture's `createTestUser()`, and `deadlock detected` (Postgres `40P01`) from plain sequential `create()` calls and from `cleanDatabase()`'s `TRUNCATE ... CASCADE` — differing on every rerun, and reproducing on completely untouched files. Root cause (established after the session): a **parallel agent session was running its own integration suite against the same `sunbnb_test` DB at the same time**. Every suite's `cleanDatabase()` TRUNCATE CASCADE tramples the other suite's fixtures — mutual deadlocks and mid-test row deletion are the guaranteed outcome, not flakiness. The same orchestration re-ran both suites serially immediately afterwards: 74/74 (apps/user) and 299/299 (packages/data) green, twice.
**Solution:** `docker exec sunbnb-postgres psql -U postgres -d sunbnb_test -c "SELECT pid, state, query FROM pg_stat_activity;"` — if connections you didn't open are active on `sunbnb_test`, another session is running tests. Wait for it (or coordinate via the orchestrator) and re-run serially; do NOT restart the container, chase Prisma pool tuning, or report the code broken.
**Prevention:** Integration suites against the shared local `sunbnb_test` must be serialized across sessions/agents — an orchestrator dispatching parallel agents must either tell exactly one of them to run integration tests or run them itself after the agents finish. If you see `40P01`/phantom-FK signatures, assume cross-session contention first; only suspect real infra after `pg_stat_activity` shows you are alone.

## Rejected approaches

<!-- Approaches tried and rejected — record so a future session doesn't re-try them -->
