# user-dev playbook

`user-dev`'s curated, growing memory for `apps/user`. Governed by
`.claude/knowledge/README.md` (layer spec + trust ladder). Grow it via the gated
retrospective; curate it via `workflows/groom.md`.

## Navigation index

What this playbook knows, by theme. Maintained by grooming; scan it before reading
sections.

- **Payment flow** — Stripe / Mollie / demo issues — _none yet_
- **Anonymous (anonId) flow** — POS/QR ownership, localStorage — `anonId` must be a valid UUID v4 in tests (2026-03-17)
- **Webhook & polling** — webhook failures, polling races, reconciliation — _none yet_
- **Test failures & fixes** — mock/fixture gotchas — _none yet_
- **i18n & locale** — next-intl edge cases — _none yet_
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

<!-- Stripe/Mollie webhook failures, polling race conditions, reconciliation -->

## Test failures & fixes

<!-- Non-obvious mock setups, fixture issues, integration-test gotchas -->

## i18n & locale

<!-- next-intl edge cases, missing translations, locale detection -->

## SunbedGroup migration pattern

### 2026-06-14: POS direct-item page — group-first, pair fallback
**Problem:** `pos/[itemId]/page.tsx` built the reservation item list from `item.pair || item.pairedBy` (single pair). As `SunbedGroup` becomes source of truth for paired beds, the page needed to resolve siblings from the group first.
**Solution:** In the `sunbedGroup` include, switch from `items: { select: { id: true } }` to `items: { include: { reservations: true } }` so sibling items carry all scalar fields + reservations (same shape as the top-level `item`). Resolution: filter `sunbedGroup.items` to exclude `item.id`, use `[item, ...otherGroupMembers]`. Fall back to `pair || pairedBy` when no group is present (un-migrated beds).
**Prevention:** When expanding a `sunbedGroup.items` include to carry sub-relations, use `include: { ... }` not `select: { ... }` — Prisma can't combine both at the same nesting level. All scalar fields are returned automatically with `include`.

## Rejected approaches

<!-- Approaches tried and rejected — record so a future session doesn't re-try them -->
