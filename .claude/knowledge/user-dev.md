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
- **Test failures & fixes** — mock/fixture gotchas — `rentalBooking.findUnique` missing from mock (2026-06-19)
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

## Rejected approaches

<!-- Approaches tried and rejected — record so a future session doesn't re-try them -->
