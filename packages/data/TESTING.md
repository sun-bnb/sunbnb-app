# Testing — Data Package (`packages/data`)

Pulled on demand; **not** auto-loaded. The always-loaded summary lives in
`packages/data/CLAUDE.md` § Testing.

---

## Testing

```bash
npm run test                  # unit tests — pure logic, no DB, no mocking
npm run test:integration      # integration tests — requires local sunbnb_test DB
npm run test:integration:setup  # run prisma migrate deploy against sunbnb_test
```

### Scale benchmark harness (track 020)

```bash
docker exec sunbnb-postgres psql -U postgres -c "CREATE DATABASE sunbnb_scale;"
npm run scale:setup    # migrate deploy → sunbnb_scale
npm run scale:seed     # deterministic fixture (flags: --parcels --seats --control-sites
                       #   --control-seats --history-months --history-per-month)
npm run scale:bench    # EXPLAIN ANALYZE the app's real query shapes (--json, --plans)
npm run scale:reset    # drop fixture data, keep the schema
```

A **separate `sunbnb_scale` DB** — never `sunbnb_test`, which the integration suites TRUNCATE
between files. `seed-scale-fixture.ts` truncates before seeding, so its target guard
(`scripts/scale-fixture-guard.ts`, unit-tested) refuses any non-local host and any database
off the allowlist **even with `--force`**. Measured baselines and the rejected-index record
live in `.claude/tracks/020-scale-baseline.md`.

Volume is not optional: Postgres prefers a sequential scan on a small table regardless of
indexes, so an index change is unobservable on a near-empty DB.

- **Unit tests** (`src/*.test.ts`): `payment.test.ts` (round, VAT, fee cascade, fee
  calculation), `rate-limit.test.ts`, `reservation-status.test.ts`,
  `reservation-machine.test.ts` (37 — deriveState kind/pay/occ mapping, allowed +
  must-reject cells, table properties incl. deletes-confined-to-zero-money, partition
  math), `reservation-machine-guard.test.ts` (single-writer ratchet), `device-code.test.ts` (14 — HW code alphabet/generation/normalisation, incl. the mint↔lookup round trip and unbiased byte mapping), `preferences.test.ts` (30 — registry/env/DB/default resolution, and the property that matters: an out-of-range or unparseable value NEVER reaches a consumer, it falls through to the shipped default; plus cache TTL + write invalidation), `scripts/scale-fixture-guard.test.ts` (17 — destructive-write target guard for the track-020 scale harness: refuses `sunbnb_test`, the dev DB, and every remote host, each asserted to survive `--force`), `unit-address.test.ts` (40 — unit address derivation + `parseUnitAddress` round trip/rejection: placed-seats-only (a pool extra must not relocate the unit), absent status = placed, declines rather than guesses when a unit's seats disagree about parcel or row, and one ordinal can never be claimed twice in a row. Both defects were injected back into the source to confirm the tests catch them — 2 failures each, no collateral)
- **Integration tests** (`src/*.integration.test.ts`): `payment.integration.test.ts` (18 tests — processConfirmedReservation/Order, invoice creation, idempotency, hash chain, VAT, fees), `tab-payment.integration.test.ts` (29 tests — openTableId guard, calculateTabTotal, group invoicing, idempotency both directions, cash settle PARTNER-only receipt, kitchen-state preservation, void exclusion, standalone-restaurant block: null-siteId tabs, account/settings-tier fees, partner-anchored invoicing), `analytics.integration.test.ts` (incl. 5 tab-order paid-ness tests), `till.integration.test.ts` (79 tests — two-bucket window math, day-boundary inclusivity, closeEmployeeTill sweep + carry-over snapshot, void handling), `fee-context.integration.test.ts` (19 tests — loadFeeContext three-tier cascade + loadRestaurantFeeContext: empty site tier, account-tier override, bootstrap), `password-reset.integration.test.ts` (15 tests — token lifecycle, rate limiting, expiry, password strength), `reservation-machine-apply.integration.test.ts` (20 — settle/unreserve/split/undo-depart/GC/collect executors: till partition, money-rows-kept, I2 end-to-end, I4 defense, paid-race abandon), `credit-note.integration.test.ts` (6 — negative twin, chain link, capped partials, series independence), `unit-address.integration.test.ts` (11 — `recomputeSeatLabels` as address writer, checked against a RAW-SQL oracle that derives the address the pre-column way: idempotency, no seq ever moves, pool-only unit stays unaddressed, address follows a genuine row change, is surrendered when the unit stops standing anywhere, is held rather than clobbered mid-rearrange, and the unique constraint refusing a second unit on one spot while allowing the same address at another site), `device-guard.integration.test.ts` (8 — `devicesBlockingSeatRemoval`: refuses to delete a unit's last placed seat while a device is assigned to it, allows it while a sibling survives, still refuses when only a `pool` spare would be left, and ignores devices at the same address on another site or in a different ROW of the same parcel. Two defects — dropping the row from the device match, and counting spares as survivors — were injected to confirm the tests catch them)
- **Config**: `vitest.config.ts` (unit, excludes `*.integration.test.ts`), `vitest.integration.config.ts` (integration, `fileParallelism: false` for shared DB)
- **Test helpers**: `src/test/setup.ts` (DB connection, `cleanDatabase()` via TRUNCATE CASCADE), `src/test/fixtures.ts` (factory functions for all models)

