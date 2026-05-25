# /migrate — Database migration assistant

Manage Prisma schema changes and migrations across local, test, and production environments.

## Usage
- `/migrate` — interactive: ask what the user wants to do
- `/migrate local` — run migrations on local Docker DB
- `/migrate test` — run migrations on Neon test DB
- `/migrate production` — run migrations on production DB
- `/migrate status` — show pending migrations for all environments
- `/migrate check` — verify `schema.prisma` is fully captured by committed migrations
- `/migrate create <description>` — guide through creating a new migration
- `/migrate sync` — sync local DB from test environment

## Instructions

Delegate this entire task to the **data-dev** subagent. Pass the user's argument (`$ARGUMENTS`) and all context below as the task prompt. Do not execute migration steps yourself.

---

You are the database migration assistant for a Turborepo monorepo. The Prisma schema lives at `packages/data/prisma/schema.prisma` and all migration commands run from `packages/data/`.

Parse the user's argument: $ARGUMENTS

### Environment commands

**`local`**: Run `cd packages/data && npm run migrate:local`
This copies `.env.local` → `.env`, runs `prisma migrate dev`, regenerates the Prisma client, and also `migrate deploy`s to the `sunbnb_test` integration DB (lockstep). Run in the foreground only — a backgrounded `migrate dev` holds the advisory lock (P1002).

**`test`**: Run `cd packages/data && npm run migrate:test`
This derives `POSTGRES_URL` from the `POSTGRES_URL_TEST` key in `.env.local` via `scripts/with-db-url.sh` (an inline override — `.env` is **not** rewritten, so prod/test creds never linger in `.env`), runs `prisma migrate deploy`, and regenerates the client. There is no separate `.env.test` — `.env.local` is the single source for all DB URLs.

**`production`**:
- ALWAYS confirm with the user before running production migrations
- Show pending migrations first: `cd packages/data && npm run migrate:status:production`
- Only after explicit confirmation: `cd packages/data && npm run migrate:production` (derives `POSTGRES_URL` from `POSTGRES_URL_PRODUCTION` via `scripts/with-db-url.sh`, runs `prisma migrate deploy`)
- Or just run `./deploy-to-production.sh` from the repo root — it shows prod status, confirms, migrates production, then pushes (migrate-before-deploy).

**`status`**: `cd packages/data && npm run migrate:status:{local,test,production}` — one per environment. Each derives the right `POSTGRES_URL` from `.env.local` via `scripts/with-db-url.sh` (no `.env` rewrite) and runs `prisma migrate status` (pending / failed / checksum drift).

**`check`**: `cd packages/data && npm run migrate:check` — fails (exit 2) if `schema.prisma` has changes no committed migration captures. Run after editing the schema to confirm a migration was generated and committed.

**`sync`**: Run `cd packages/data && source .env.local && ./sync-local-db.sh` to sync local DB from test.

### Creating a new migration (`create`)

When the user wants to make schema changes:

1. Read the current schema at `packages/data/prisma/schema.prisma`
2. Discuss the change with the user — what models/fields to add/modify/remove
3. Make the schema edit
4. Run `cd packages/data && npm run migrate:local` to create the migration (also locksteps the `sunbnb_test` DB)
5. Show the generated SQL from the new migration directory. Apply the expand/contract rule from `.claude/rules/migrations.md`: additive (nullable/defaulted) only per release; never edit this file once applied
6. Run `npm run migrate:check` — confirms `schema.prisma` is fully captured by the migration (exit 0)
7. Remind the user to:
   - Run integration tests: `cd packages/data && npm run test:integration`
   - Commit the migration directory (an applied migration is immutable — fix forward, never edit)
   - For an **additive** migration, run `npm run migrate:test` **before pushing `main`** — `main`'s preview shares the test DB, and the `.githooks/pre-push` hook blocks the push otherwise. **Destructive** migrations wait for `./promote-to-test.sh`. See `.claude/rules/migrations.md`
   - Update `packages/data/CLAUDE.md` if models changed significantly

### Safety checks

Before ANY migration:
- Read the schema diff (`git diff packages/data/prisma/schema.prisma`) to understand what changed
- Warn about destructive operations:
  - Dropping columns/tables: "This will DELETE data permanently"
  - Removing required fields: "Existing rows will fail the constraint"
  - Renaming models: "This creates a new table and drops the old one — use @map instead"
- For production: always show `migrate status` first and require explicit user confirmation
- After local migration: suggest running `npm run test:integration` in the data package to verify

### PostGIS awareness
- The schema uses PostGIS. The `geometry` column on `Site` has a GiST index
- If adding spatial columns, remind the user about the PostGIS extension
- Local Docker must use `postgis/postgis:latest` image

### Integration test DB
- `sunbnb_test` is a separate local database used by integration tests across all apps
- After schema changes, run: `cd packages/data && npm run test:integration:setup` to deploy migrations to the test DB
- Then run integration tests: `npm run test:integration` in each app
