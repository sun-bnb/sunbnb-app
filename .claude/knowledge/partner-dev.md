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
- **Bug patterns & fixes** — recurring partner-app bugs — see "verifySiteOwnership vs verifySiteAccess scope divergence", "Prisma upsert is not atomic — RSC-prefetch concurrency crash on manage page"
- **Component decomposition** — manage page decomposition, shared state boundary, pinch handler scroll-target — see "Decomposing view.tsx manage monolith"
- **Manage page naming** — hold/reserve/rent action-row distinction — see "Reserve vs Rent vs Hold terminology"
- **BedDetail state-machine patterns** — convertHoldToWalkIn in-place update + multi-day $transaction extend, pendingConfirm per-branch guards, inSync-gated toggle, walk-in disconnect depart — see "BedDetail state-machine patterns"
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

## Rejected approaches

### 2026-06-15: React onWheel prop for wheel zoom (passive listener no-op)
**Problem:** React's synthetic `onWheel` prop attaches a passive listener. Calling `e.preventDefault()` inside it is silently ignored by the browser — the native page zoom fires anyway (and on macOS, ctrl+wheel triggers OS-level zoom).
**Solution:** Register via `el.addEventListener('wheel', handler, { passive: false })` inside a `useEffect` on the element ref, with cleanup `removeEventListener`. This is what `SchematicRenderer.tsx` does (lines 340–363).
**Prevention:** Any time you need to `preventDefault()` on a wheel event, skip `onWheel` prop and use the manual `addEventListener` pattern. The eslint-disable comment on the empty dep array is standard for this pattern — the handler reads a ref, not state.
