---
type: subsystem
slug: migrations
status: stable
sources:
  - .claude/rules/migrations.md
  - packages/data/package.json
  - packages/data/scripts/with-db-url.sh
  - .githooks/pre-push
  - promote-to-test.sh
  - deploy-to-production.sh
related:
  - subsystem:payments
last_verified: 2026-10-13
---

# Migrations — environment topology and the laptop-run sequence

The **declarative rules** (immutable applied migrations, expand/contract, migrate-before-deploy,
the guardrail commands) stay canonical in `.claude/rules/migrations.md` and are auto-loaded.
This page holds the topology narrative and the step-by-step sequence — needed when you are
actually running a migration, not on every task.

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


## Sequence (laptop-run, single source `.env.local`)

`.env.local` in `packages/data` holds all three DB URLs (`POSTGRES_URL` = local,
`POSTGRES_URL_TEST`, `POSTGRES_URL_PRODUCTION`). Commands point Prisma at one of them
via an inline `POSTGRES_URL` override (`scripts/with-db-url.sh`), so `.env`'s `POSTGRES_URL`
always stays local (`migrate:local` refreshes `.env` from `.env.local`; nothing writes a remote URL
into it).

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


## Prisma in an agent shell

The rule (`.claude/rules/migrations.md` § Guardrails) is the short form; this is why.

- **Never background `migrate dev`.** It takes the Postgres advisory lock, then waits on its
  migration-name prompt; a backgrounded run never answers it, and every later Prisma command fails
  `P1002`. Recover with `pkill -f "prisma migrate dev"`, then run in the foreground with
  `echo "<name>" | npx prisma migrate dev`.
- **When Prisma would warn, it refuses a non-interactive shell** (data loss, `@unique` on a
  populated column) even with `--name` or piped stdin. Generate the SQL with
  `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` into
  a timestamped `prisma/migrations/<ts>_<name>/migration.sql`, check it is additive, then
  `migrate deploy` locally → `generate` → `npm run migrate:integration` → `npm run migrate:check`
  (must say "No difference detected").
- **"Unique among active rows"** cannot be a partial index: Prisma Schema can't express one, so a
  hand-written index leaves `migrate:check` permanently red. Use a nullable `@unique` column that
  every closing path sets to NULL — `TableTab.openTableId` (`packages/data/prisma/schema.prisma`).
