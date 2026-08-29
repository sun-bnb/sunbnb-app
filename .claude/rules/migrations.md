# Migration Rules

How Prisma migrations move through environments and stay consistent with code.

**Topology in one line:** `main` (preview) and `test` deploy from different branches onto the
**same TEST database**, while `production` has its own. Two code versions therefore share one DB,
which is what makes expand/contract mandatory and splits migration timing by type (below).
Full topology diagram + the laptop-run sequence: `.claude/wiki/subsystems/migrations.md`.
Schema lives only in `packages/data`; all commands run from there. These rules
keep the live databases (local → `sunbnb_test` → test → production) in lockstep
with the committed migrations and with the code that depends on them.

## The two invariants that break in practice

- **An applied migration file is immutable.** Once `prisma migrate dev` (or `deploy`)
  has run a `migration.sql`, never edit it — Prisma stores its SHA-256 in
  `_prisma_migrations.checksum`, and editing it desyncs the checksum. Locally that
  forces a `migrate reset` (data loss); on test/production `migrate deploy` *fails
  mid-deploy*. **Fix forward with a new migration**, never by editing history. (If a
  dev DB already drifted from an intermediate edit, patch the recorded checksum
  rather than reset — but the file should never have changed.)
- **Committed migrations must fully describe `schema.prisma`.** Editing the schema
  without generating a migration ships code expecting columns the migration set
  never creates. `npm run migrate:check` (local DB vs `schema.prisma`,
  `migrate diff --exit-code`) is the guard; the promote/deploy scripts run it.

## Expand / contract (parallel-change) — mandatory, and it sets migration timing

Every migration must be **backward-compatible with every code version currently
deployed against the DB** — code and schema never flip atomically, and (for the test
DB) two branches share it:

- **Additive only per release:** new columns nullable or defaulted; new tables/indexes
  are safe. Old code keeps working against the new schema.
- **Never drop or tighten in the same release that stops using the thing.** Removing a
  column / making it `NOT NULL` / renaming is a *separate, later* release, shipped only
  after no running code references it. Rename = add new + backfill + drop old across
  releases — never a destructive in-place rename (use `@map` to rename in Prisma without
  touching the column).

Because the test DB is shared, expand/contract also dictates **when** each type is
applied to it:

- **Expand (additive) → apply to the test DB BEFORE pushing `main`.** main's preview
  needs the column immediately; test.sunbnb.app's older code ignores it. The `pre-push`
  hook (`.githooks/pre-push`) blocks a `main` push while the test DB has pending
  migrations — run `npm run migrate:test` first.
- **Contract (destructive) → apply to the test DB at promote-to-test**, once the `test`
  branch has caught up past the code that used the dropped object. Applying a drop while
  test.sunbnb.app still references it would break it.

Follow this and a migrate/deploy race can't break any environment: new code tolerates the
old schema, old code tolerates the new schema.

## Guardrail commands

- `npm run migrate:check` — fails if `schema.prisma` has changes no migration captures.
- `npm run migrate:status:{local,test,production}` — pending / failed / drifted (catches
  edited-after-apply checksum drift) per environment.
- `.githooks/pre-push` — blocks a `main` push whose range adds migrations while the test
  DB has pending migrations (it skips the check for pushes with no migration changes, and
  for machines without `POSTGRES_URL_TEST`). Enabled via `git config core.hooksPath
  .githooks` (run by `scripts/bootstrap.sh`). Bypass deliberately with `git push
  --no-verify`.

## Seed data in migrations

Reference-data seeds embedded in a `migration.sql` (e.g. the `no-show-deposit`
`ServiceCode`) **must be idempotent** — `ON CONFLICT DO NOTHING` / `WHERE NOT EXISTS`.
A migration runs exactly once per DB and is replayed from scratch on a fresh one;
non-idempotent seeds break both.
