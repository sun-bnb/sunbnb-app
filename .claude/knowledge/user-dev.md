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

## Webhook & polling

<!-- Stripe/Mollie webhook failures, polling race conditions, reconciliation -->

## Test failures & fixes

<!-- Non-obvious mock setups, fixture issues, integration-test gotchas -->

## i18n & locale

<!-- next-intl edge cases, missing translations, locale detection -->

## Rejected approaches

<!-- Approaches tried and rejected — record so a future session doesn't re-try them -->
