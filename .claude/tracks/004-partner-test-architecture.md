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

- **Next action:** Phase 0.4 (risk chokepoints). (1) `reserveWithConflictGuard` —
  transactional check-then-create helper + tests (call-site adoption deferred to Phase 3).
  (2) `app/test/no-inline-money.test.ts` — grep guard failing on `toFixed(` / inline
  `/ (1 + vat`, directing to `@repo/data` `round()`/reverse-VAT; expected RED on
  `products/actions.ts` (the `toFixed(2)` VAT math) until Phase 3.
- **Context needed:** spine so far — 0.1 mock-contract, 0.2 auth-matrix (107-entry registry in
  `app/test/gated-actions.ts`), 0.3 coverage-contract (`app/test/coverage-contract.test.ts`,
  47-entry `UNGATED_ALLOWLIST`). Money chokepoint already exists in `@repo/data` (`round()`,
  reverse-VAT in `payment.ts`); the rule is "no inline money math in actions". Race chokepoint:
  see Phase 2's race-prone list. Decide `reserveWithConflictGuard`'s home (partner vs
  `@repo/data`) — open decision. Also still open: surface the pre-existing `saveGeneral`
  integration red (subscription-plan guard fixture gap) to the user; confirm fixture-gap vs
  real guard bug when wiring the gate (0.5).
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
- ☐ **0.4 Risk chokepoints** — `reserveWithConflictGuard` transactional check-then-create
  helper + tests (call-site adoption deferred to Phase 3); `app/test/no-inline-money.test.ts`
  grep guard (fails on `toFixed(` / inline `/ (1 + vat`, directs to `@repo/data` `round()`).
  *no-inline-money red on products until fixed.*
- ☐ **0.5 Real, erosion-proof gate** — `test:integration` turbo task (`cache:false`) + root
  script; `promote-to-test.sh` runs unit + integration with local `migrate:integration`
  first (distinct from Neon `migrate:test`); per-file coverage ratchet (touched file can't
  drop below baseline).

### ☐ Phase 1 — Behavioral backfill (flows through the contract; green)
Close the contract's to-do list with the non-auth dimensions (happy / error / state-machine /
integration-if-stateful): all 7 `rentals/actions.ts`, 3 working-hours actions, `addProduct`,
orders-version `toggleProductSoldOut`, `modifyRestaurantReservation`,
`setRestaurantServiceShifts`, `duplicateTableForRestaurant`, untested validation guards,
restaurant deposit→invoice integration cascade. Ratchet prevents backslide.

### ☐ Phase 2 — Remaining bug-revealing tests (intentionally RED)
`app/test/race.ts` `expectExactlyOneSucceeds(...)` over `reserveItem`, `blockBed`,
`moveReservation`, `createPartnerReservation`, `createWalkInRental`, `setOrderStatus`;
pair-expansion double-booking tests (manage + calendar). Each red = one bug ticket. Promote
intentionally blocked.

### 💤 Phase 3 — Fixes (the "afterward")
Flip reds green: `getSite` ownership; product money math; pair-expansion conflict check;
adopt `reserveWithConflictGuard` at race-prone call sites.

### 💤 Phase 4 — Steady state & extraction
Contract + ratchet keep coverage watertight. Clean stale `BUG:` comments + the tautological
`paymentAmount === totalPrice` test; refresh `apps/partner/CLAUDE.md` counts; extract
`auth-matrix` / `race` / fixtures into `@repo/test-utils` for user + admin.

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

## Open decisions

- Cloud CI deferred — revisit once the turbo/promote gate is proven and the team grows.
- ~~Coverage-contract enumeration mechanism~~ **Settled (0.3):** static regex parse, no
  server-module imports (avoids side effects); registry coverage matched via reverse alias-map
  at (source-file, export) granularity to handle the `toggleProductSoldOut` duplicate.
- `reserveWithConflictGuard` final home (partner vs. straight into `@repo/data`) — decide when
  adopting call sites in Phase 3.

## Links

Proving ground for a spine intended to extract into `[[subsystem:design-system]]`-style shared
tooling (`@repo/test-utils`). Touches `[[entity:reservation]]`, `[[entity:invoice]]`,
`[[entity:order]]`, `[[entity:settlement]]`-adjacent partner flows. Governed by
`.claude/rules/migrations.md` (integration DB lockstep) and `.claude/rules/architecture.md`
(schema/payment-core changes are architecture passes). No sibling tracks; user/admin
extraction is downstream of Phase 4.
