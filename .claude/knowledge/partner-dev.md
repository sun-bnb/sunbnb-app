# partner-dev playbook

`partner-dev`'s curated, growing memory for `apps/partner`. Governed by
`.claude/knowledge/README.md` (layer spec + trust ladder). Grow it via the gated
retrospective; curate it via `workflows/groom.md`.

## Navigation index

What this playbook knows, by theme. Maintained by grooming; scan it before reading
sections. *(Empty — entries are added as the agent learns. Each entry: a one-line
pointer here + the full entry in its section below.)*

- **Auth & ownership** — `requireSiteOwner` / `verifySiteOwnership` / sudo edge cases — _none yet_
- **State machines** — order / operational / rental transition gaps — _none yet_
- **Test failures & fixes** — mock/fixture gotchas — see "Mock-contract test", "saveInventoryItemProperties", "auth-matrix ok/reject predicate"
- **Bug patterns & fixes** — recurring partner-app bugs — see "verifySiteOwnership vs verifySiteAccess scope divergence"
- **Rejected approaches** — dead-ends, so nobody re-tries them — see "React onWheel prop"
- **Mollie lib tests** — mocking strategy for app/api/_lib/mollie.ts — see "Testing mollie.ts: mocking boundary + scope separator"

---

## Auth & ownership

<!-- Entry format:
### YYYY-MM-DD: <concise title>
**Problem:** what went wrong / what was non-obvious
**Solution:** what actually worked
**Prevention:** how a future session avoids it (cite path/file.ts#symbol) -->

## State machines

<!-- Order status, operational status, rental status — unexpected transitions or gaps -->

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

## Rejected approaches

### 2026-06-15: React onWheel prop for wheel zoom (passive listener no-op)
**Problem:** React's synthetic `onWheel` prop attaches a passive listener. Calling `e.preventDefault()` inside it is silently ignored by the browser — the native page zoom fires anyway (and on macOS, ctrl+wheel triggers OS-level zoom).
**Solution:** Register via `el.addEventListener('wheel', handler, { passive: false })` inside a `useEffect` on the element ref, with cleanup `removeEventListener`. This is what `SchematicRenderer.tsx` does (lines 340–363).
**Prevention:** Any time you need to `preventDefault()` on a wheel event, skip `onWheel` prop and use the manual `addEventListener` pattern. The eslint-disable comment on the empty dep array is standard for this pattern — the handler reads a ref, not state.
