# user-dev Knowledge Base

Accumulated learnings from past tasks. Entries are appended automatically after solving novel problems.

## Payment Flow Issues & Fixes

<!-- Format: ### YYYY-MM-DD: <issue title>
**Problem:** what went wrong
**Solution:** how it was fixed
**Prevention:** how to avoid it next time -->

## Anonymous (anonId) Flow Gotchas

<!-- Edge cases in POS/QR anonymous flows, ownership verification, localStorage -->

### 2026-03-17: anonId UUID validation broke existing tests using 'anon-123'
**Problem:** Adding UUID format validation to `getRequestIdentity` in `app/api/_lib/auth.ts` caused two existing tests to fail — they passed `'anon-123'` as `anonId`, which is not a valid UUID. The route then returned 401 because identity was null.
**Solution:** Updated the test values in `route.test.ts` files for `/api/reservations/[id]` and `/api/payment/stripe/payment-intent` to use a valid UUID (`550e8400-e29b-41d4-a716-446655440000`).
**Prevention:** Any test that exercises anonymous auth must use a valid UUID v4 string for `anonId`. The format is `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`.

## Webhook & Polling Issues

<!-- Stripe/Mollie webhook failures, polling race conditions, reconciliation -->

## Test Failures & Fixes

<!-- Non-obvious mock setups, fixture issues, integration test gotchas -->

## i18n & Locale Quirks

<!-- next-intl edge cases, missing translations, locale detection -->
