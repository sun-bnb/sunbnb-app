# Migration Rules

How Prisma migrations move through environments and stay consistent with code.
Schema lives only in `packages/data`; all commands run from there. These rules
keep the live databases (local → `sunbnb_test` → test → production) in lockstep
with the committed migrations and with the code that depends on them.

## Environment topology — three branches, two databases

```
main   → Vercel preview  ─┐
                          ├── TEST DB   (POSTGRES_URL_TEST — shared)
test   → test.sunbnb.app ─┘
production → sunbnb.app  ──── PROD DB   (POSTGRES_URL_PRODUCTION)
```

The Vercel **preview** environment (deployed from `main`) and **test.sunbnb.app**
(deployed from `test`) point at the **same TEST database**. `main` is always ahead of
`test`, so **two code versions share one DB at the same time**. The DB-URL selection is
pure Vercel per-environment config (`packages/data/index.ts` just reads `POSTGRES_URL`).

**Governing principle:** a database shared by multiple deployed branches must be
migrated to satisfy the **furthest-ahead** branch on it, and every migration applied
must stay backward-compatible with the **furthest-behind** branch still running on it.
For the test DB that means: migrate it to *main's* schema, and never break *test's*
older code. This makes expand/contract **mandatory**, and splits migration timing by
type (below).

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

## Sequence (laptop-run, single source `.env.local`)

`.env.local` in `packages/data` holds all three DB URLs (`POSTGRES_URL` = local,
`POSTGRES_URL_TEST`, `POSTGRES_URL_PRODUCTION`). Commands point Prisma at one of them
via an inline `POSTGRES_URL` override (`scripts/with-db-url.sh`) — `.env` is never
rewritten, so prod creds never linger in `.env`.

1. Edit `packages/data/prisma/schema.prisma`.
2. `npm run migrate:local` — `migrate dev` on the local DB **and** `migrate deploy` to
   `sunbnb_test` (integration DB stays in lockstep). Run in the foreground only — a
   backgrounded `migrate dev` holds the advisory lock (P1002).
3. Review the generated `migration.sql`. Warn on destructive ops; prefer additive.
4. `npm run test:integration` (data + apps) against the now-migrated `sunbnb_test`.
5. Update each app's `__mocks__/@repo/data/PrismaCient.ts` if models changed.
6. **Before pushing `main`** (for additive migrations): `npm run migrate:test` — the
   shared test DB must satisfy main's preview the moment the code lands. The `pre-push`
   hook blocks the `main` push if you forget. Then push/merge to `main`.
7. Promote: `./promote-to-test.sh` runs `migrate:check` + `migrate:status:test` +
   lint/tests, applies any **contract** migrations to the test DB, then pushes `test`
   (by now additive migrations are an idempotent no-op).
8. Release: `./deploy-to-production.sh` shows `migrate:status:production`, confirms,
   **migrates production, then pushes** (prod DB is isolated — standard
   migrate-before-deploy).

A schema or payment-core change is always an architecture pass (see `architecture.md`,
`data-access.md`, `payments.md`).

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
