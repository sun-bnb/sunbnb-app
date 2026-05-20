---
type: workflow
slug: implementation
status: stable
sources:
  - .claude/wiki/README.md
related:
  - workflow:feature-design
  - workflow:ingest
last_verified: 2026-05-20
---

# Workflow: Implementation

The procedure for translating a designed feature (`[[workflow:feature-design]]`) into shipped code. Optimized for correctness on the first pass.

## Procedure

### 1. Reconfirm the plan

If a plan was produced via `[[workflow:feature-design]]`, re-read it. Check:
- Has the user since redirected? Adjust before coding.
- Are the cited wiki pages and source files still current? Spot-check `last_verified` and a sample file.

If there is no plan, **stop** and produce one. Don't code blind on non-trivial work.

### 2. Establish the order of operations

The dependency direction in this monorepo is rigid:

```
packages/data  ←  apps/{user,partner,admin}
       ↑                ↑
   schema first     consume schema + payment service
```

Within a feature touching multiple layers:

1. **Schema** — edit `packages/data/prisma/schema.prisma`, run `npm run migrate:local`, review the generated SQL.
2. **Shared logic** — update `packages/data/src/*.ts` (payment, reservation-status, email templates, etc.). Add unit tests.
3. **Integration tests** for `packages/data` — verify DB-touching logic against `sunbnb_test`.
4. **App server actions / API routes** — consume the new shared logic. Add tests with mocked Prisma.
5. **App components & UI** — consume server actions / API routes. Add tests where they make sense.
6. **i18n** — add keys to `messages/{en,es,fi}.json` for any user-facing string.

Skip levels only if the feature genuinely doesn't touch them.

### 3. Apply project conventions

Non-negotiables (these are in `.claude/rules/` and `CLAUDE.md` — always check them):

**Data access** (`.claude/rules/data-access.md`):
- `@repo/data` owns Prisma. Never import `@prisma/client` directly in apps.
- Status fields are String columns. Use constants from `@repo/data/reservation-status`.
- Server actions return `{ status: 'ok' | 'error', errors?: string[] }`.
- PostGIS spatial queries via `prisma.$queryRawUnsafe`.

**Auth** (`.claude/rules/auth.md`):
- Partner app: `requireSiteOwner()` / `authorizeSite()` on every mutation.
- User app: `verifyOwnership(identity, entity)` after `getRequestIdentity()`.
- Admin app: `requireSudo()` on every action.
- Password tokens are SHA-256 hashed before storage.

**Payments** (`.claude/rules/payments.md`):
- Never trust client-submitted prices. Fetch from DB.
- Invoice creation is idempotent — check before creating, double-check in the transaction.
- Service fees use the three-tier cascade (`[[entity:service-fee]]`). No hardcoded amounts.
- Reservations: fee **deducted from partner revenue**. Orders: fee **added to customer total**. Do not mix.
- All prices VAT-inclusive. Use `round()` from `@repo/data` for all money math.
- Demo payments: `pi_demo_{timestamp}` prefix. Check `isDemoPayment()` before any provider call.
- Stripe webhook: verify signature. Mollie webhook: validate payment ID regex.
- `/api/reconcile` must require `RECONCILIATION_SECRET`.

### 4. Write the tests first when feasible

Per the project's testing philosophy (see `MEMORY.md`): tests are **requirements-driven and bug-revealing**, not validations of existing code. Aim for:

- Tests that would fail today if the feature were broken in the way users care about
- Edge cases: unauthenticated, anonymous, double submission, race, ownership mismatch, zero/negative input, expired/missing config
- Idempotency assertions for any creation that must not duplicate

Use the existing mock pattern (`apps/<app>/__mocks__/@repo/data/`) for unit tests. Use the integration test setup (`sunbnb_test` DB) for anything DB-touching.

### 5. Implement

Write the code. Stay inside the plan. If you discover the plan was wrong, **pause** and revise the plan in conversation rather than improvising past it.

Guardrails:
- Don't add error handling, fallbacks, or validation for cases that can't happen
- Don't introduce abstractions for hypothetical future requirements
- Don't add backwards-compat shims when you can change the code
- No comments unless the *why* is non-obvious

### 6. Verify

Run, in order:

```bash
# Unit tests for everything you changed
cd packages/data && npm run test                # if data package touched
cd apps/<app>    && npm run test                # per app touched

# Integration tests if DB logic changed
cd packages/data && npm run test:integration
cd apps/user     && npm run test:integration    # if user-app DB logic changed

# Build (catches type errors)
npm run build

# Lint
npm run lint
```

For UI changes: start the relevant dev server, exercise the feature in a browser, check the golden path AND at least one failure path. If you can't test the UI in a browser, **say so explicitly** — type checking does not verify feature correctness.

### 7. Ingest

Once the feature is verified and the user has accepted it, run `[[workflow:ingest]]` to update the wiki. This is part of "done", not optional.

### 8. Commit

Only commit when the user asks. Follow the project's commit conventions (see root `CLAUDE.md`). Never `--no-verify`. Never `--amend` if pre-commit hooks failed — create a new commit after fixing.

## Anti-patterns

- **Implementing across all layers in parallel.** Schema/data changes feed everything downstream. Land them first.
- **Skipping integration tests for DB logic.** Mocks lie. Per `feedback_testing` memory: prior incidents have come from mocked tests passing while production broke.
- **Writing "happy path only" tests.** They catch nothing useful.
- **Using `as any` to silence the type checker.** The type checker is usually right.
- **Adding a feature flag for a single feature.** Don't.
- **"Cleaning up" surrounding code while fixing a bug.** Out of scope. Open a separate task.
