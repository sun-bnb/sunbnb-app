---
id: 004-partner-test-architecture
title: Partner Test Architecture
status: active
created: 2026-06-16
updated: 2026-06-16
worktree: null
---

## Goal

Make the **partner app** backend *watertight by construction*: an architecture where it is
structurally impossible to add a server action / route handler that escapes regression
detection, and where the detection itself is trustworthy (no false-green). Coverage backfill
then becomes a steady-state activity the architecture **forces and locks in** — not a
checklist anyone has to remember. Partner is the proving ground; the helpers are built
**shared-ready** so user + admin inherit the same spine later.

This came out of a full audit of partner backend test coverage (4 domains). The audit found
~30 exported backend functions with **zero** tests, and — more fundamentally — that the
highest-risk behaviours (token/accessKey auth, check-then-write races, money cascades,
missing-ownership reads) are *structurally* uncovered in ways the current test style can't
catch. Two suspected **live production bugs** surfaced (to be fixed *after* the harness
proves them): `getSite` leaks guest emails with no ownership check; pair/group expansion
double-books a sibling because availability is checked on the requested itemIds, not the
expanded set.

**Locked decisions (2026-06-16):**
- **Automation:** turbo `test:integration` task + run integration in `promote-to-test.sh`.
  **No cloud CI** (deferred).
- **Red tests:** *fail loudly* — bug-revealing tests stay red until the bug is fixed. Suite
  is intentionally red between Phase 2 and Phase 3.
- **Harness reuse:** *partner-first, shared-ready* — build in `apps/partner/app/test/` with
  clean interfaces, extract to `@repo/test-utils` in Phase 4.
- **Mock drift:** *lighter contract test* — assert each per-app mock's exported surface is a
  superset of the real module's (keys only), not a shared/generated mock.

## Resume here

- **Next action:** **Phase 1 COMPLETE + fully green** (P1a restaurant, P1b rentals [found+fixed
  bug #3 `deleteRentalItem`], P1c rest). Partner 901 unit + 89 integration, 0 red. Spine (Phase 0)
  + Phase 3 fixes already pushed (up to `14993b8`). All Phase-1 work is **uncommitted** (~7 new
  test files + restaurant/rental-booking fixtures + the deleteRentalItem source fix + mock
  additions). Next: commit Phase 1 (proposed: deleteRentalItem-fix+rentals-tests commit, a backfill
  commit, a docs commit), then **Phase 4** — coverage ratchet (now buildable on a green suite),
  stale-`BUG:`/tautological-test cleanup, refresh `apps/partner/CLAUDE.md` counts.
  (`@repo/test-utils` extraction + `createWalkInRental` rental-race stay deferred — partner-only
  focus.) Nothing newer than `14993b8` pushed.
- **Context needed:** the spine — 0.1 mock-contract, 0.2 auth-matrix (107-entry registry in
  `app/test/gated-actions.ts`), 0.3 coverage-contract (47-entry allowlist in
  `app/test/coverage-contract.test.ts`), 0.4 no-inline-money guard + `@repo/data/reservations`
  race chokepoint, 0.5 gate (turbo `test:integration` + promote wiring). **Red ledger / Phase-3
  backlog:** (1) `getSite` no ownership guard (`queries.getSite`, 2 reds); (2) `products/actions.ts`
  inline VAT math → use `@repo/data` `round()`/reverse-VAT (8 sites, 1 red); (3) token-scope
  divergence `verifySiteOwnership` `hasSome` vs `verifySiteAccess` `has` (1 integration red,
  decide direction); (4) partner blocking-status divergence + `blockBed` missing conflict check
  (surfaced in 0.4); adopt `reserveWithConflictGuard` at the 5 call sites. Also confirm the
  pre-existing `saveGeneral` integration red (subscription-plan guard fixture gap vs real bug).
  ⚠️ Promote is blocked until these land. **0.5 gate config is uncommitted** (turbo.json,
  package.json, promote-to-test.sh + track docs).
- **Blocked by:** —

## Roadmap

### ▶ Phase 0 — Architectural spine (lands first; some sub-items go red by design)
- ✅ **0.1 Mock-contract test** — `securityToken` into the Prisma mock; `mock-contract.test.ts`
  (superset assertion, keys only). Also fixed 3 additional drifts found by the test:
  `resolveEffectiveFeatures` missing from subscription mock; `sendDueReminders` missing from
  reservation-emails mock; 14 Prisma models absent from PrismaCient mock. 389 tests green.
- ✅ **0.2 Gated-action registry + auth-matrix** — `app/test/gated-actions.ts` (19
  token-or-session + 4 session-owner entries; closure invokers, TS-checked),
  `app/test/token-fixtures.ts` (valid/expired/wrongScope/foreign token fixtures + apply*
  helpers), `app/test/auth-matrix.ts` (SCENARIOS per GateType + runAuthMatrix; ok/reject
  distinguished by auth-error message set), `app/test/auth-matrix.test.ts` (for-loop
  auto-emits full matrix per entry). **Result:** 534 total tests; 532 green, 2 intentionally
  red. Reds = `queries.getSite` unauthenticated→reject and non-owner→reject (bug #1: no
  ownership guard; getSite returns `undefined` status, not `{ status: 'error' }`).
  **Gate-impl divergence finding:** `verifySiteOwnership` (manage) uses `hasSome ['all',
  'manage_site']`; `verifySiteAccess` (orders/lib) uses `has 'all'` — a `manage_site`-only
  token would be accepted by manage but rejected by orders. Divergence is real but invisible
  in unit-mode (mock returns null for both wrong-scope cases). Closed in 0.2b. Green anchors:
  deleteSite, setPaymentProvider, saveGeneral all pass full 3-scenario matrix. Remaining
  domains to register: rest of session-owner (calendar, inventory, rentals, working-hours,
  products, content, schematic), restaurant-owner (restaurant/table/menu actions).
- ✅ **0.2b Integration token-scope test** — `app/test/fixtures.ts` gained
  `createTestSecurityToken(userId, resources, expiresOffsetMs)`. New test file:
  `app/sites/[id]/token-scope.integration.test.ts` (4 tests: 3 green, 1 red).
  Green: `['all']`-scoped token accepted by BOTH gates; expired token rejected by BOTH;
  foreign-site token (owner mismatch) rejected by BOTH — real DB confirms the
  `where`-clause filters actually fire. Red: `['manage_site']`-only token — manage
  (`hasSome`) accepts, orders (`has 'all'`) rejects — direction-agnostic consistency
  assertion fails on the mismatch. Divergence confirmed in real Postgres. Representative
  actions: `blockBed` (manage/actions.ts, hasSome gate) and `getOrders` (orders/actions.ts,
  has gate). Auth mocked null throughout so session path is never taken. 67 integration
  tests total: 65 green + 1 new red (token-scope) + 1 pre-existing red (saveGeneral
  subscription plan guard — unrelated to this phase). Unit test count unchanged: 534 total,
  532 green, 2 red.
- ✅ **0.2c Registry completion** (2026-06-16) — registry now **107 entries** (19
  token-or-session + 53 session-owner + 29 restaurant-owner) covering the full partner backend
  surface; the auth-matrix auto-runs **379 scenario-tests, 377 green, 2 red**. Session-owner
  (52 added) and restaurant-owner (29 added) are **both clean — no new auth/ownership reds**;
  the audit's auth concerns were missing *tests*, not broken gates. Only reds remain
  `queries.getSite` (bug #1). **Review caveats — residual risk the matrix can't see** (carry
  into 0.3 / later phases): (1) **5 session-owner actions excluded** (non-standard return
  shape): `getBrand`/`getProducts` return data/list and rely on a query-side ownership filter
  the matrix can't assert → eyeball before allowlisting; `checkSlug`/`generateSlug` (auth-only),
  `createSite` (session-only by design). (2) **Cross-entity ownership** (does a
  `combinationId`/`reservationId` belong to THIS restaurant) is delegated to
  `@repo/table-reservations-core` — the matrix tests the restaurant-level gate only, not the
  sub-entity check. (3) The matrix tests **auth only** — race/double-booking/money bugs are
  Phase 1/2.
- ✅ **0.3 Export/coverage contract meta-test (keystone)** (2026-06-16) —
  `app/test/coverage-contract.test.ts`: static regex enumeration (no server-module imports) of
  every `'use server'` action export + every `route.ts` handler; fails the build naming any
  `{ file, export }` not in `GATED_ACTIONS` or the `UNGATED_ALLOWLIST`. **Teeth proven** via a
  `__contractCanary` export → contract went red naming it. Full surface now accounted for:
  **107 matrix-gated actions + 47 justified-allowlisted exports = 154 entry points**, all
  documented. The contract forced enumeration of API surfaces not previously catalogued
  (`mollie/*` OAuth, `subscription/checkout`+`portal`, `account.submitForm`, NextAuth,
  `locale.setLocale`) — each allowlisted with its real gate. `getBrand`/`getProducts` verified
  SAFE (ownership via query-side `where: { userId }` / `requireSiteOwner` — file:line quoted in
  the allowlist), not blind-stamped. 772 tests, 770 green, 2 red (still only `getSite`). No new
  bugs. A 155th unregistered export now fails the build.
- ✅ **0.4 Risk chokepoints** (2026-06-16). **(a) Money guard:** `app/test/no-inline-money.test.ts`
  static-scans action source for money-context `.toFixed(` + inline reverse-VAT (`/ (1 + tax`),
  scoped by a money-identifier regex so geometry `.toFixed` is not flagged. RED on 8
  `products/actions.ts` violations, **zero false positives**; empty allowlist + stale-entry guard.
  **(b) `reserveWithConflictGuard`** (decided: pessimistic lock, no migration; home **@repo/data**) —
  `packages/data/src/reservations.ts`, new `@repo/data/reservations` export. Single interactive
  `$transaction`: `SELECT id FROM "InventoryItem" WHERE id = ANY(...) FOR UPDATE` (locks contended
  bed rows) → re-check conflict in-tx → create-or-return-`{outcome:'conflict'}`. Reuses
  `reservation-status` constants; default blocking set = `BLOCKING_STATUSES` with override.
  26 unit + 15 integration tests; **headline race test green** (2 concurrent same-bed calls →
  exactly one created, one conflict, one row). Additive — nothing imports it until Phase 3, so
  blast radius = 0. **Two findings logged for Phase 3:** (i) blocking-status divergence — partner
  uses `{ notIn: [CANCELED] }` so PAYMENT_FAILED/REFUNDED beds stay unavailable (likely a bug; user
  app frees them); (ii) `blockBed` has NO conflict check (double-block, confirms audit).
- ✅ **0.5 Erosion-proof gate** (2026-06-16 — gate wiring; ratchet deferred to Phase 4).
  `test:integration` turbo task (`cache:false`) added; root `npm run test:integration` =
  `turbo run test:integration --concurrency=1` (**serial across packages** — partner/user/data
  share one `sunbnb_test` DB and each TRUNCATEs, so parallel would clobber). `promote-to-test.sh`
  step [4/6] now runs lint + unit + **integration** (local `migrate:integration` first, distinct
  from Neon `migrate:test`; `SKIP_INTEGRATION=1` finer bypass for docs/DB-less promotes).
  Validated via JSON parse + `bash -n` + `turbo run --dry-run` (`@repo/data#test:integration`,
  cache off). **⚠ Promote is now blocked until Phase 3 fixes land** (fail-loud, intended).
  Per-file **coverage ratchet deferred to Phase 4** — can't validate against a red suite; it's
  steady-state erosion protection that only matters once green.

### ▶ Phase 1 — Behavioral backfill (flows through the contract; green unless a bug surfaces)
Close the contract's to-do list with the non-auth dimensions (happy / error / state-machine /
integration-if-stateful), requirements-driven/bug-revealing. Sequenced by risk, partner-only:
- ✅ **P1a — restaurant reservations (money + double-booking)** (2026-06-17). New restaurant
  fixtures (`createTestRestaurant`/`createTestTable`/`createTestTableReservation`). Integration:
  `chargeRestaurantReservationDeposit` real deposit→invoice cascade (PARTNER+PLATFORM pair incl.
  bootstrap `no-show-deposit` fee, hash chain, **idempotency**); `modifyRestaurantReservation`
  double-booking — **bug-revealing test GREEN** (no bug: core `reapplyReservation` has a
  transactional overlap check excluding the row's own reservation → rejects with 'Slot no longer
  available'). Unit: `setRestaurantServiceShifts` (8), `duplicateTableForRestaurant` (7). Partner
  **792 unit + 84 integration green**. (kb: `importOriginal` partial-mock doesn't rebind a module's
  internal closures → fully mock the core pkg; `processChargedTableDeposit` always bootstraps a
  €1 default fee so empty-DB cascade yields 2 invoices.)
- ✅ **P1b — rentals** (2026-06-17). Behavioral coverage for all 7 `rentals/actions.ts` (65 unit +
  5 integration); new `createTestRentalBooking` fixture. **FOUND A REAL BUG (#3): `deleteRentalItem`
  silently cascade-deletes active bookings** — no guard + `RentalBooking.rentalItemId onDelete:
  Cascade`, so `prisma.rentalItem.delete()` destroys paid/pending bookings and returns `{status:
  'ok'}`. 2 integration tests RED (fail-loud) until fixed. **Fix needs a decision** (reject-if-active
  vs soft-delete; and what counts as "active" — any booking vs only future/non-returned). Partner
  838 unit green; 87 integration green + 2 reds.
- ✅ **P1c — the rest** (2026-06-17). 64 unit tests, no bugs: working-hours ×3 (incl. the manual
  `auth()+wh.site.userId` non-owner path), `addProduct` (17 — real-number VAT via
  `computeVatAndBaseAmounts`), orders-version `toggleProductSoldOut` (6, token path), validation
  guards `isValidPaymentProvider`/`isValidRentalPaymentType`/`isValidItemStatus`/`safeBlobKey` (20).
- ✅ **Bug #3 `deleteRentalItem` FIXED** (2026-06-17; decided: reject-with-guard) — added a
  `rentalBooking.count` guard; any booking → `{status:'error', errors:['Cannot delete item with
  bookings — deactivate it instead']}`; hard-delete only when zero bookings. The 2 P1b reds flipped
  GREEN. (Also added `rentalBooking.count` to the Prisma mock + an auth-matrix `beforeEach` stub —
  a method-level mock gap the model-level mock-contract doesn't cover by design.)
- **Phase 1 backfill COMPLETE + fully GREEN.** Partner **901 unit + 89 integration, 0 red.** All
  Phase-1 work + the bug #3 fix are **uncommitted**. Next: commit Phase 1, then Phase 4 ratchet
  locks the raised coverage.

### ☐ Phase 2 — Remaining bug-revealing tests (intentionally RED)
`app/test/race.ts` `expectExactlyOneSucceeds(...)` over `reserveItem`, `blockBed`,
`moveReservation`, `createPartnerReservation`, `createWalkInRental`, `setOrderStatus`;
pair-expansion double-booking tests (manage + calendar). Each red = one bug ticket. Promote
intentionally blocked.

### ▶ Phase 3 — Fixes (the "afterward")
- ✅ **`getSite` ownership** (2026-06-16) — query-side `where: { id, userId }` (mirrors `getBrand`)
  + `queries.test.ts` regression test + moved registry→allowlist. 2 matrix reds gone. Callers all
  session-auth owner contexts (verified).
- ✅ **products VAT math** (2026-06-16) — all 8 inline sites → `@repo/data` `computeVatAndBaseAmounts`;
  tax-only branch now tested; `no-inline-money` green (empty allowlist). **Partner unit suite: 775
  green, 0 red.**
- ✅ **Token-scope divergence** (2026-06-16; decided: `manage_site` authorizes both). Consolidated
  to ONE gate — `verifySiteAccess` (`lib/auth-helpers.ts`) is now canonical with
  `hasSome ['all','manage_site']`; manage's `verifySiteOwnership` is a 3-line delegating wrapper
  (was a 30-line duplicate, never exported → zero blast radius). Behavior change: orders dashboard
  (`setOrderStatus`/`getOrders`/`toggleProductSoldOut`) now also accepts `manage_site` tokens.
  `token-scope.integration.test.ts` strengthened to assert the unified policy (manage_site accepted
  by both, `orders_only` rejected by both) — **5/5 green** (was 4+1 red). Unit suite unchanged.
- ☐ **Reservation race adoption** (decided: free the bed → default `BLOCKING_STATUSES`). Adopt
  `@repo/data/reservations` `reserveWithConflictGuard` at the **4 sunbed-reservation** call sites,
  expanding SunbedGroup/pair siblings BEFORE the call (fixes pair-expansion double-booking,
  suspected bug #2): **partner** (partner-dev) manage `reserveItem`, manage `blockBed` (also ADD a
  conflict check — it has none today), calendar `createPartnerReservation`; **user** (user-dev)
  `saveReservationForMultipleItems`. Write bug-revealing call-site tests (pair-expansion sibling →
  conflict; the @repo/data race test already proves serialization). ⚠️ **Cross-app** — touches
  apps/user (consumer booking flow); architecture pass. **Rental wrinkle:** manage
  `createWalkInRental` is RentalBooking (quantity-based availability), NOT InventoryItem bed-lock —
  `reserveWithConflictGuard` doesn't fit it; its race needs a separate quantity guard → **follow-up,
  not this packet.**
- ✅ `saveGeneral` integration red (2026-06-16) — **confirmed fixture gap, NOT a product bug.**
  The `paid→unpaid` entitlement gate (OFF_PLATFORM_BILLING, Pro/Business) is correct; the test
  created a plan-less partner. Fix: added `createTestPartnerAccount` + `createTestSubscription`
  fixtures and granted a real PRO subscription in the test. **Partner integration suite now 68
  green, 0 red.**
- ✅ **Reservation race adoption / bug #2 FIXED** (2026-06-16, cross-app). Adopted
  `@repo/data/reservations` `reserveWithConflictGuard` (expand-then-guard, free-the-bed default):
  **partner** (R1) `manage.reserveItem`, `manage.blockBed` (gained its missing conflict check),
  `calendar.createPartnerReservation`; **user** (R2) `saveReservationForMultipleItems` (anon flow
  confirmed compatible — no guard extension). Unit harness: `@repo/data/reservations` mocked in
  both apps; partner `mock-contract` extended to cover it. **Bug-revealing integration tests** (real
  guard): partner +8 (pair-expansion + blockBed conflict), user +1 (SunbedGroup sibling) — all
  GREEN; each would have silently double-booked before. Partner suite **777 unit + 76 integration
  green**. `createWalkInRental` (rental quantity race) left as a flagged follow-up. **R2 introduced
  ZERO regressions** (baseline-verified). Uncommitted.
- ✅ **21 pre-existing `apps/user` integration reds FIXED** (2026-06-16, user-dev) — both confirmed
  fixture/mock gaps, no product bugs: (1) ×16 — removed the partial `vi.mock` of the pure
  `payment-ids` helpers (it omitted `isValidEntityId`; pure helpers shouldn't be mocked in
  integration); (2) ×5 — `createTestSite` now defaults `type:'paid'` (was null → silently exercised
  the *unpaid* path; tests needing unpaid pass it explicitly). User integration now **31 green**.
  The gate caught real rot that was invisible because integration ran nowhere — exactly the point.
- ✅ **FULL GATE GREEN — promote unblocked** (2026-06-16). Verified the whole `promote-to-test.sh`
  gate across all workspaces: unit **8/8 turbo tasks** (partner 777, user 255, @repo/data 160,
  +admin/others); integration **3/3 tasks** (partner 76, @repo/data 89, user 31 = 196). Every
  test-pinned red green; bug #2 fixed cross-app with bug-revealing tests.

### ▶ Phase 4 — Steady state & extraction
- ✅ **Cleanup** (2026-06-17) — removed all 5 stale `BUG:`/"will FAIL" comments (every described
  bug was already fixed: type/NaN-price validation, cross-site pairing, `deleteItemsByGroup` shape,
  401 status); the `paymentAmount === totalPrice` walk-in-cash test confirmed **correct** (renamed,
  not a bug); refreshed `apps/partner/CLAUDE.md` Testing section (159 → 901 unit / 89 integration,
  full file table + "test-architecture spine" subsection).
- ✅ **Per-file coverage ratchet** (2026-06-17; decided: Full). `apps/partner/vitest.config.ts` adds
  the `json-summary` reporter; `scripts/coverage-ratchet.mjs` compares touched partner source files
  (`BASE...HEAD` + working changes) against the committed `apps/partner/coverage-baseline.json` (62
  files), failing on any line% drop below baseline (epsilon 0.01); new files skipped (the
  coverage-contract already forces new exports tested). Root scripts `coverage:ratchet` (check) +
  `coverage:baseline` (regen to ratchet up). Wired into `promote-to-test.sh` step [4/6] with
  `BASE=origin/test` + a `SKIP_RATCHET=1` bypass. **Verified:** green check passes; canary (doctor a
  touched file's baseline to 100%) correctly fails naming the −drop.
- ☐ **Deferred (out of partner-only scope):** extract `auth-matrix`/`race`/fixtures into
  `@repo/test-utils` for user + admin; the `createWalkInRental` rental-quantity race.

## Log

- **2026-06-16** — Track created from the partner backend test-coverage audit. Scope and four
  locked decisions recorded above (turbo+promote gate / fail-loud / partner-first shared-ready
  / lighter mock-contract). Architecture-first framing chosen deliberately over coverage-first:
  the spine (0.3 contract + 0.2 auth-matrix + 0.1 mock-contract + 0.4 chokepoints + 0.5 gate)
  is the fundamental deliverable; coverage backfill flows through it. Starting Phase 0.1.
- **2026-06-16** — Phase 0.1 complete. `securityToken` added to PrismaCient mock (methods:
  `findUnique`, `findMany`, `create`, `delete`). 14 additional Prisma model stubs added to
  make the mock a true superset of the real client. `mock-contract.test.ts` written —
  Prisma model check uses `Prisma.dmmf` (connection-free); submodule checks parse source
  files via regex (alias-independent, no DB import side-effects). Test verifiably goes RED
  on `securityToken` absence and GREEN with it present. Fixed 3 pre-existing drifts:
  `resolveEffectiveFeatures` in subscription mock, `sendDueReminders` in reservation-emails
  mock. All 389 partner unit tests green; tsc and lint clean.

- **2026-06-16** — Phase 0.2 interface reviewed and settled with the user before build:
  (1) **closure invokers** over declarative arg-maps (TS-checked against real signatures);
  (2) auth-matrix runner owns **session/token/restaurant action gates only** — cron/signature
  remain in the registry for 0.3's completeness check but keep their existing route tests
  (audit found those adequate); (3) **unit-mode breadth now** across all gated actions, with
  the query-side scope-filter blind spot (`resources: { hasSome }` in the Prisma where) split
  into **0.2b** integration token-scope. Registry is the single source of truth that 0.3's
  coverage-contract will read.

- **2026-06-16** — Phase 0.2 complete. Built 4 files in `apps/partner/app/test/`:
  `token-fixtures.ts` (4 token scenarios + apply* helpers; stable owner/site/item IDs exported
  as OWNER_ID, SITE_ID, etc.), `gated-actions.ts` (19 token-or-session + 4 session-owner
  entries; closure invokers typed against real signatures), `auth-matrix.ts` (SCENARIOS map +
  runAuthMatrix; ok/reject predicate uses AUTH_ERROR_MESSAGES set to distinguish auth
  rejections from downstream errors — key design decision that made the runner resilient to
  downstream stub gaps), `auth-matrix.test.ts` (for-loop emits matrix per entry; global
  vi.mock for auth/next-cache/payment/subscription/flags; per-test beforeEach with sensible
  prisma stubs). 534 total tests: 532 green + 2 intentionally red (queries.getSite bug #1 —
  returns `undefined` status, no auth gate). Gate-impl divergence finding: `verifySiteOwnership`
  (manage) accepts `manage_site`-scope tokens; `verifySiteAccess` (orders/lib) requires `all`
  scope — divergence confirmed in source but invisible in unit-mode. Documented for 0.2b.

- **2026-06-16** — Phase 0.2b complete. Added `createTestSecurityToken` factory to
  `apps/partner/app/test/fixtures.ts` (params: userId, resources[], expiresOffsetMs;
  creates real `SecurityToken` row via Prisma). New integration test file
  `apps/partner/app/sites/[id]/token-scope.integration.test.ts` (4 tests). Three green
  tests confirm real Postgres array operators fire as expected: `['all']` token accepted
  by both gates, expired token rejected by both, foreign-site token rejected by both.
  One intentional red confirms the `hasSome` vs `has` divergence: `['manage_site']`-only
  token — `blockBed` (hasSome gate) accepted it, `getOrders` (has gate) rejected it —
  direction-agnostic consistency assertion fails on the mismatch. This is the only new red.
  Pre-existing red (`saveGeneral` integration test, subscription plan guard) unchanged.
  Unit tests unchanged (534 total, 532 green, 2 red). tsc clean.

- **2026-06-16** — Phase 0.2c (registry completion) + Phase 0.3 (keystone) complete; user
  reviewed the combined ledger at the registry-completion pause. **0.2c:** registered all
  remaining session-owner (52) + restaurant-owner (29) actions → registry **107 entries**, the
  matrix auto-runs **379 scenario-tests, 377 green**. Both domains **clean — no new auth reds**;
  the audit's auth concerns were missing tests, not broken gates. Review caveats recorded on the
  0.2c roadmap bullet (5 excluded non-standard-return actions; cross-entity ownership delegated
  to `@repo/table-reservations-core`; matrix is auth-only). **0.3:** `coverage-contract.test.ts`
  static-enumerates every `'use server'` export + `route.ts` handler, fails on anything not in
  `GATED_ACTIONS` or the 47-entry `UNGATED_ALLOWLIST`. Teeth proven via `__contractCanary`.
  Forced accounting of the whole backend (154 entry points) — surfaced previously-uncatalogued
  API routes (`mollie/*`, `subscription/checkout`+`portal`, `account.submitForm`, NextAuth,
  `locale.setLocale`), each allowlisted with its real gate. `getBrand`/`getProducts` verified
  SAFE (query-side ownership; file:line quoted), not blind-stamped. 772 tests, 770 green, 2 red
  (only `getSite`). No new bugs. The spine's "coverage is enforced, not remembered" mechanism is
  now live.

- **2026-06-16** — Partner test-architecture **spine committed** (`f724891`, not pushed): the
  0.1–0.3 test infra (mock-contract, auth-matrix + 107-entry registry, coverage-contract) +
  mock additions + track/knowledge docs. 14 files, ~3,650 lines. Test-only; no app behavior
  change. (`commit` skill, `.claude/rules/commits.md`.)

- **2026-06-16** — Phase 0.4 complete (both chokepoints). Money guard
  (`app/test/no-inline-money.test.ts`): RED on 8 `products/actions.ts` inline-VAT violations, 0
  false positives. Race chokepoint `reserveWithConflictGuard` in `packages/data/src/reservations.ts`
  (decided: pessimistic FOR-UPDATE lock, home `@repo/data`, no migration; new `./reservations`
  export) — interactive `$transaction` locks candidate `InventoryItem` rows, re-checks conflict,
  creates-or-returns-conflict; 26 unit + 15 integration tests, headline 2-concurrent-call race
  test green (exactly one created). Additive, nothing imports it yet (blast radius 0 pre-Phase-3).
  data-dev surfaced 2 Phase-3 findings: partner blocking-status divergence (`{notIn:[CANCELED]}`
  keeps PAYMENT_FAILED/REFUNDED beds unavailable) and `blockBed`'s missing conflict check.
  `packages/data` work is **uncommitted** (separate workspace from the f724891 partner commit).

- **2026-06-16** — Phase 0.4 committed as two atomic commits (not pushed): `95e310e` (partner
  no-inline-money guard) + `c082f3d` (`@repo/data` reserveWithConflictGuard chokepoint + track
  docs). Split because they're different logical changes in different packages.

- **2026-06-16** — **Phase 0.5 complete → the spine (Phase 0) is DONE.** Gate wiring applied
  (user-approved): `turbo.json` `test:integration` task (`cache:false`); root script
  `turbo run test:integration --concurrency=1` (serial — shared `sunbnb_test` DB); `promote-to-test.sh`
  now runs lint + unit + integration at step [4/6] (local `migrate:integration` first;
  `SKIP_INTEGRATION=1` bypass). Validated (JSON / `bash -n` / turbo dry-run). Coverage ratchet
  deferred to Phase 4 (defer decided with user — can't validate against a red suite). Gate config
  is **uncommitted**. The "watertight by construction" architecture is now built AND enforced:
  mock-contract (no false-green) + auth-matrix/registry (auth tested by construction) +
  coverage-contract (no ungoverned exports) + money/race chokepoints + integration in the gate.
  Remaining is application: Phase 1 backfill (green) and Phase 3 fixes (flip the 4-item red
  ledger, unblock promote).

- **2026-06-16** — Gate config committed `514b243`. **Phase 3 started** — 2 of 4 reds fixed in
  parallel (partner-dev ×2, disjoint files). **`getSite`** ownership leak (bug #1): query-side
  `where: {id, userId}` + `queries.test.ts` regression test + registry→allowlist move (48
  allowlisted); all callers verified session-auth owner. **products VAT**: 8 inline sites →
  `@repo/data` `computeVatAndBaseAmounts`, tax-only branch tested, `no-inline-money` green.
  Orchestrator re-ran to confirm combined state (the parallel agents' handoff counts disagreed):
  partner unit suite **775 green, 0 red**. Both fixes **uncommitted**. Remaining Phase 3:
  token-scope divergence + reservation race adoption — both awaiting user direction decisions.

- **2026-06-16** — getSite + products committed `b7b22c5` / `8918f0b` (two atomic, not pushed).
  User decisions: token-scope → `manage_site` authorizes both; bed-blocking → free the bed
  (`BLOCKING_STATUSES`). **Token-scope FIXED** (partner-dev): consolidated to one gate
  (`verifySiteAccess` canonical, `hasSome ['all','manage_site']`; `verifySiteOwnership` → thin
  wrapper); orders dashboard now accepts `manage_site`; integration token-scope 5/5 green; unit
  unchanged. **`saveGeneral` FIXED** (partner-dev): fixture gap confirmed (not a bug) — granted a
  real PRO subscription via new `createTestPartnerAccount`/`createTestSubscription` fixtures;
  partner integration **68 green**. **All test-pinned reds now green; promote unblocked.** Only the
  proactive reservation-race (bug #2, cross-app) remains. Token-scope + saveGeneral **uncommitted**.

## Open decisions

- Cloud CI deferred — revisit once the turbo/promote gate is proven and the team grows.
- ~~Coverage-contract enumeration mechanism~~ **Settled (0.3):** static regex parse, no
  server-module imports (avoids side effects); registry coverage matched via reverse alias-map
  at (source-file, export) granularity to handle the `toggleProductSoldOut` duplicate.
- ~~`reserveWithConflictGuard` final home~~ **Settled (0.4):** `@repo/data` (`src/reservations.ts`,
  `./reservations` export) — shared, fixes partner + user; pessimistic FOR-UPDATE lock, no migration.

## Links

Proving ground for a spine intended to extract into `[[subsystem:design-system]]`-style shared
tooling (`@repo/test-utils`). Touches `[[entity:reservation]]`, `[[entity:invoice]]`,
`[[entity:order]]`, `[[entity:settlement]]`-adjacent partner flows. Governed by
`.claude/rules/migrations.md` (integration DB lockstep) and `.claude/rules/architecture.md`
(schema/payment-core changes are architecture passes). No sibling tracks; user/admin
extraction is downstream of Phase 4.
