---
title: Migrations
type: subsystem
status: current
sources:
  - .claude/rules/migrations.md
  - packages/data/prisma/
  - promote-to-test.sh
  - deploy-to-production.sh
related:
  - subsystems/payments.md
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

