# data-dev Knowledge Base

Accumulated learnings from past tasks. Entries are appended automatically after solving novel problems.

## Migration Issues & Solutions

<!-- Format: ### YYYY-MM-DD: <issue title>
**Problem:** what went wrong
**Solution:** how it was fixed
**Prevention:** how to avoid it next time -->

## Schema Quirks & Gotchas

<!-- Unexpected behaviors, constraints, or patterns in the Prisma schema -->

### 2026-05-20: prisma migrate dev advisory lock contention from background process
**Problem:** Running `npm run migrate:local` in the background (via `run_in_background`) then attempting a second `prisma migrate dev` in the foreground fails immediately with `P1002: Timed out trying to acquire a postgres advisory lock`. The background process holds the lock even when stdin is waiting for input.
**Solution:** Kill the background process with `pkill -f "prisma migrate dev"` before retrying. Then pipe the migration name via stdin: `echo "migration_name" | npx prisma migrate dev`.
**Prevention:** Never run `prisma migrate dev` as a background task. Always run it in the foreground with stdin piped for the name prompt.

### 2026-05-20: effective-subscription resolution convention (CustomSubscription)
**Problem:** Need a canonical way to merge a partner's base `SubscriptionPlan` with a sparse `CustomSubscription` override (null field = inherit base).
**Solution:** `resolveEffectiveSubscription(plan, custom)` in `src/subscription.ts` — pure function, no DB. Custom non-null field wins; falls back to plan; then hard defaults (tier=STARTER, maxSites=1, price=0). `isCustom` is true only when the custom record has a non-null `maxSites`. `canCreateSite` uses a single `partnerAccount.findUnique` selecting both `customSubscription` and `subscription.plan`, then calls this helper.
**Prevention:** All future per-partner plan overrides should go through `resolveEffectiveSubscription` (add nullable fields to `CustomSubscription` and extend the helper). Never derive effective limits directly from `subscription.plan` alone.

### 2026-05-20: feature entitlements — catalog/resolver pattern + circular import avoidance
**Problem:** Adding a feature-flag catalog (`SUBSCRIPTION_FEATURES`, `TIER_FEATURE_DEFAULTS`, `resolveEffectiveFeatures`) and integrating it with fee contexts in `payment.ts`. Risk of circular import: if `payment.ts` imported from `subscription.ts` AND `subscription.ts` imported from `payment.ts`.
**Solution:** `resolveEffectiveFeatures` is pure (no DB) and lives in `subscription.ts`. `payment.ts` imports it with `import { resolveEffectiveFeatures, type SubscriptionFeatureKey } from './subscription'`. `subscription.ts` does NOT import from `payment.ts`. No cycle. `featureOverrides` on `CustomSubscription` is `Json?` (JSONB) — cast as `any` at the DB boundary before passing to the pure resolver. Fee contexts (`SiteFeeContext`, `PartnerFeeContext`) add `features: Record<SubscriptionFeatureKey, boolean>` as an additive field; both `getSiteFeeContext` and `getPartnerFeeContext` add `customSubscription: true` to their partnerAccount includes.
**Prevention:** Keep the feature resolver pure and in `subscription.ts`. Always cast Prisma `Json` fields to the expected type at the DB boundary, not inside pure helpers. Adding a new feature to the catalog is a one-liner in `SUBSCRIPTION_FEATURES` + `TIER_FEATURE_DEFAULTS` — no migration needed (sparse JSON map).

## Integration Test Failures & Fixes

<!-- Test failures that required non-obvious fixes -->

## PostGIS Notes

<!-- Spatial query patterns, index behaviors, geometry gotchas -->
