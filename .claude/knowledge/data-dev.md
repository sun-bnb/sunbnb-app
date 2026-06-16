# data-dev playbook

`data-dev`'s curated, growing memory for `packages/data` (`@repo/data`). Governed by
`.claude/knowledge/README.md` (layer spec + trust ladder). Grow it via the gated
retrospective; curate it via `workflows/groom.md`.

## Navigation index

What this playbook knows, by theme. Maintained by grooming; scan it before reading
sections.

- **Schema & migrations** — `prisma migrate dev` advisory-lock contention (never background it) (2026-05-20)
- **Payment / invoice / fee / subscription** — `resolveEffectiveSubscription` override convention (2026-05-20); feature-entitlement catalog/resolver + circular-import avoidance (2026-05-20)
- **Reservation conflict guard** — `reserveWithConflictGuard` (FOR UPDATE on InventoryItem, structured conflict return, race test) (2026-06-16)
- **Integration test failures & fixes** — _none yet_
- **PostGIS notes** — _none yet_
- **Cross-app blast radius** — schema/export changes that rippled to app mocks — see SunbedGroup (2026-06-14)
- **Rejected approaches** — dead-ends, so nobody re-tries them — _none yet_

---

## Schema & migrations

### 2026-05-20: prisma migrate dev advisory lock contention from background process
**Problem:** Running `npm run migrate:local` in the background (via `run_in_background`) then attempting a second `prisma migrate dev` in the foreground fails immediately with `P1002: Timed out trying to acquire a postgres advisory lock`. The background process holds the lock even when stdin is waiting for input.
**Solution:** Kill the background process with `pkill -f "prisma migrate dev"` before retrying. Then pipe the migration name via stdin: `echo "migration_name" | npx prisma migrate dev`.
**Prevention:** Never run `prisma migrate dev` as a background task. Always run it in the foreground with stdin piped for the name prompt.

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

## Rejected approaches

<!-- Approaches tried and rejected — record so a future session doesn't re-try them -->
