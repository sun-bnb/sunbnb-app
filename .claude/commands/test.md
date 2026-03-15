# /test — Smart test runner

Run tests intelligently based on what's specified or what changed.

## Usage
- `/test` — detect changed files, run relevant tests
- `/test partner` — run all partner app unit tests
- `/test user integration` — run user app integration tests
- `/test data` — run data package unit tests
- `/test all` — run everything across the monorepo
- `/test <filepath or pattern>` — run specific test file(s)

## Instructions

You are the test runner for a Turborepo monorepo. Your job is to run the right tests with the right config.

### Step 1: Determine scope

Parse the user's argument: $ARGUMENTS

If no argument or empty, run `git diff --name-only HEAD` and `git diff --name-only --cached` to detect changed files. Map changed files to the affected app/package:
- `apps/partner/**` → partner
- `apps/user/**` → user
- `apps/admin/**` → admin
- `packages/data/**` → data (AND re-run partner + user + admin since they depend on it)

If the argument is a specific file path or glob pattern, run just that.

### Step 2: Run the correct command

Each app/package has different test configurations. Use these exact commands:

**Partner app** (from `apps/partner/`):
- Unit: `npm run test`
- Integration: `POSTGRES_URL=postgres://postgres:sunbnb@localhost:5432/sunbnb_test npx vitest run --config vitest.integration.config.ts`
- Specific file: `npx vitest run <pattern>` (unit) or with `--config vitest.integration.config.ts` (for `*.integration.test.ts`)

**User app** (from `apps/user/`):
- Unit: `npm run test`
- Integration: `npm run test:integration`
- Specific file: same pattern as partner

**Admin app** (from `apps/admin/`):
- Unit: `npm run test`
- No integration tests exist

**Data package** (from `packages/data/`):
- Unit: `npm run test`
- Integration: `npm run test:integration`

**All** (from repo root):
- `npm run test` (turbo runs all unit tests in parallel)
- Then integration tests per-app sequentially

### Step 3: Report results

After running, provide a concise summary:
- Total tests passed/failed per app
- If any failures: show the failing test name + the assertion error (not the full stack trace)
- If all pass: one-line confirmation with test counts

### Important
- Never skip integration tests when explicitly requested — they require a local Docker PostgreSQL running
- If integration tests fail with connection errors, tell the user to check Docker: `docker ps | grep sunbnb-postgres`
- For `*.integration.test.ts` files, always use the integration config
- Run unit and integration tests separately (different vitest configs)
