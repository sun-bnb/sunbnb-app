# Migration Rules

How Prisma migrations move through environments and stay consistent with code. Schema lives only
in `packages/data`; all commands run from there.

**Topology:** `main` (preview) and `test` deploy from different branches onto the **same TEST
database**; `production` has its own. Two code versions share one DB — which makes expand/contract
mandatory and splits migration timing by type. Diagram + laptop-run sequence:
`.claude/wiki/subsystems/migrations.md`.

## The two invariants that break in practice

- **An applied migration file is immutable.** Prisma stores each `migration.sql`'s SHA-256 in
  `_prisma_migrations.checksum`; editing an applied file forces a local `migrate reset` (data loss)
  and makes `migrate deploy` *fail mid-deploy* on test/production. **Fix forward with a new
  migration.** (If a dev DB already drifted, patch the recorded checksum rather than reset.)
- **Committed migrations must fully describe `schema.prisma`**, or code ships expecting columns no
  migration creates. `npm run migrate:check` is the guard; the promote/deploy scripts run it.

## Expand / contract (parallel-change) — mandatory, and it sets migration timing

Every migration must be backward-compatible with every code version deployed against the DB:

- **Additive only per release:** new columns nullable or defaulted; new tables/indexes are safe.
- **Never drop or tighten in the release that stops using the thing.** Drop / `NOT NULL` / rename is
  a *later* release, once no running code references it. Rename = add + backfill + drop across
  releases (or `@map` to rename in Prisma without touching the column).
- **"Unique among active rows"** = a nullable `@unique` column NULLed on close, never a partial
  index (Prisma can't express one, so `migrate:check` stays red) — e.g. `TableTab.openTableId`.

Timing on the shared test DB:

- **Expand → apply to the test DB BEFORE pushing `main`** (`npm run migrate:test`); main's preview
  needs it, test.sunbnb.app's older code ignores it.
- **Contract → apply at promote-to-test**, once `test` has caught up past the code that used the
  dropped object.

## Guardrails

- `npm run migrate:check` — fails if `schema.prisma` has changes no migration captures.
- `npm run migrate:status:{local,test,production}` — pending / failed / checksum drift per env.
- `.githooks/pre-push` — blocks a `main` push that adds migrations while the test DB has pending
  ones (skipped without `POSTGRES_URL_TEST`). Enabled by `scripts/bootstrap.sh`; bypass
  deliberately with `git push --no-verify`.
- **Never background `migrate dev`** — it holds the advisory lock at its name prompt and the next
  run fails `P1002`. If Prisma refuses the non-interactive shell on a warning: `npx prisma migrate
  diff --from-config-datasource --to-schema ./prisma/schema.prisma --script` into
  `prisma/migrations/<UTC-timestamp>_<name>/migration.sql`, read it, then `migrate deploy` →
  `generate` → `migrate:integration` → `migrate:check`.

## Seed data in migrations

Reference-data seeds in a `migration.sql` (e.g. the `no-show-deposit` `ServiceCode`) **must be
idempotent** — `ON CONFLICT DO NOTHING` / `WHERE NOT EXISTS` — a fresh DB replays every migration.

## Assistant views pin columns

`assistant.*` views (track 030) read base-table columns; dropping, renaming or retyping one fails
with "cannot drop column ... because other objects depend on it". In that contract migration `DROP
VIEW` the affected view first and recreate it (with its column `GRANT`) in the same migration.
