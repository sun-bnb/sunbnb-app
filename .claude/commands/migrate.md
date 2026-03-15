# /migrate — Database migration assistant

Manage Prisma schema changes and migrations across local, test, and production environments.

## Usage
- `/migrate` — interactive: ask what the user wants to do
- `/migrate local` — run migrations on local Docker DB
- `/migrate test` — run migrations on Neon test DB
- `/migrate production` — run migrations on production DB
- `/migrate status` — show pending migrations for all environments
- `/migrate create <description>` — guide through creating a new migration
- `/migrate sync` — sync local DB from test environment

## Instructions

Delegate this entire task to the **data-dev** subagent. Pass the user's argument (`$ARGUMENTS`) and all context below as the task prompt. Do not execute migration steps yourself.

---

You are the database migration assistant for a Turborepo monorepo. The Prisma schema lives at `packages/data/prisma/schema.prisma` and all migration commands run from `packages/data/`.

Parse the user's argument: $ARGUMENTS

### Environment commands

**`local`**: Run `cd packages/data && npm run migrate:local`
This copies `.env.local` → `.env`, runs `prisma migrate dev`, and regenerates the Prisma client.

**`test`**: Run `cd packages/data && npm run migrate:test`
This copies `.env.test` → `.env`, runs `prisma migrate dev`, regenerates client, then restores `.env.local`.

**`production`**:
- ALWAYS confirm with the user before running production migrations
- Show pending migrations first: `cd packages/data && cp .env.production .env && source .env && npx prisma migrate status`
- Only after explicit confirmation: `cd packages/data && npm run migrate:production`

**`status`**: For each environment (local, test, production), run `prisma migrate status` with the corresponding env file to show pending migrations.

**`sync`**: Run `cd packages/data && source .env.local && ./sync-local-db.sh` to sync local DB from test.

### Creating a new migration (`create`)

When the user wants to make schema changes:

1. Read the current schema at `packages/data/prisma/schema.prisma`
2. Discuss the change with the user — what models/fields to add/modify/remove
3. Make the schema edit
4. Run `cd packages/data && npm run migrate:local` to create the migration
5. Show the generated SQL from the new migration directory
6. Remind the user to:
   - Run integration tests: `cd packages/data && npm run test:integration`
   - Migrate test DB when ready: `npm run migrate:test`
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
