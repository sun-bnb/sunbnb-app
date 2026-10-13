---
type: workflow
slug: implementation
status: stable
sources:
  - .claude/wiki/README.md
  - .claude/rules/architecture.md
  - .claude/rules/migrations.md
  - .claude/rules/commits.md
  - .claude/commands/test.md
related:
  - workflow:feature-design
  - subsystem:migrations
last_verified: 2026-10-13
---

# Workflow: Implementation

The procedure for translating a designed feature (`[[workflow:feature-design]]`) into shipped code. Optimized for correctness on the first pass.

## Procedure

### 1. Reconfirm the plan

If a plan was produced via `[[workflow:feature-design]]`, re-read it:
- Has the user since redirected? Adjust before coding.
- Are the cited wiki pages and source files still current? Spot-check `last_verified` and a sample file.
- Is the work part of a track? Read its **Resume here** in `.claude/tracks/` first.

No plan on non-trivial work → **stop** and produce one. If the change crosses an app boundary, touches `packages/data`, or changes a shared contract, the architecture pass in `.claude/rules/architecture.md` is mandatory before code.

### 2. Establish the order of operations

Dependencies run one way: `packages/data` (schema, payment/invoice core, status constants) ← shared packages (`@repo/floor-core`, `@repo/agent`, `@repo/ui`, …) ← `apps/{user,partner,admin,mobile}`. Within a feature:

1. **Schema** — edit `packages/data/prisma/schema.prisma`, `npm run migrate:local`, review the SQL. Additive only (expand/contract) and `migrate:test` before pushing `main` — `.claude/rules/migrations.md`, `[[subsystem:migrations]]`.
2. **Shared logic** — `packages/data/src/*.ts` (or the owning shared package) + unit tests. A `@repo/data` submodule imported by client components must not pull in Prisma.
3. **Integration tests** for DB-touching logic against `sunbnb_test`.
4. **App server actions / API routes** — consume the shared logic; tests with the app's `__mocks__/@repo/data/` mocks (add a mock file when you add a mocked submodule).
5. **App components & UI** — prime with `/ui <surface>` first; mirror the reference implementation.
6. **i18n** — keys in `messages/{en,es,fi}.json` for every user-facing string.

Skip a level only if the feature genuinely doesn't touch it. Per-surface work goes to the surface agent (`data-dev`, `partner-dev`, `user-dev`, `admin-dev`, `sunbed-inventory`), schema/data first.

### 3. Apply project conventions

The rules are canonical in `.claude/rules/` (always loaded) — don't re-derive them, check the change against them:

- **`data-access.md`** — `@repo/data` owns Prisma; status constants from `@repo/data/reservation-status`; `{ status, errors }` action shape; availability check + create in one operation.
- **`auth.md`** — ownership verified before every read/mutation (partner `requireSiteOwner()` / `authorizeSite()`, user `getRequestIdentity()` + `verifyOwnership()`, admin sudo).
- **`payments.md`** — DB prices only; idempotent invoices; fee cascade; consumer pays the listed price only (commission deducted from partner revenue); `round()` for money; provider identified by `paymentRef` prefix via `@repo/data/payment-refs` (`isDemoPayment()` before any provider call); webhooks re-fetch from the provider.
- **`ui.md`** — Tailwind-first, one `accent` token, component classes, status colours.

Surface-specific patterns live in the surface's `CLAUDE.md` and its pulled siblings (`PATTERNS.md`, `TESTING.md`, `UI.md`, `EXPORTS.md`, …) — read the one for the code you touch.

### 4. Write the tests first when feasible

Tests are **requirements-driven and bug-revealing**, not validations of existing code. Aim for:

- tests that would fail today if the feature broke in the way users care about;
- edge cases: unauthenticated, anonymous (`anonId`), double submission, race, ownership mismatch, zero/negative input, expired/missing config;
- idempotency assertions for every creation that must not duplicate.

### 5. Implement

Stay inside the plan. If the plan turns out wrong, **pause** and revise it in conversation rather than improvising past it.

- No error handling, fallbacks or validation for cases that can't happen.
- No abstractions for hypothetical future requirements; no back-compat shims when you can change the code.
- Comments only when the *why* is non-obvious.

### 6. Verify

`/test` maps the change scope to the right suites. The ladder it draws from:

```bash
cd packages/data && npm run test && npm run test:integration   # data package touched
cd apps/<app>    && npm run test                               # per app touched
cd apps/<app>    && npm run test:integration                   # user/partner DB logic touched
cd <workspace>   && npx tsc --noEmit && npm run lint           # per touched workspace
npm run build                                                  # client/server boundary leaks only show here
```

For UI changes, run the app and drive the golden path plus at least one failure path (`verifier-sunbnb` skill). If you can't test in a browser, **say so** — type checking does not verify feature correctness.

### 7. Ingest

Once verified and accepted, run `/context-loop:wiki ingest` — part of "done", not optional. Agents emit `kb:` markers for surface lessons (`.claude/agent-protocol.md`); the wiki gets only what passes its gate. On a track, run `/context-loop:track handoff` before stopping.

### 8. Commit

Only when the user asks, per `.claude/rules/commits.md` (`/commit`); push / promote / deploy only on the matching verb (`.claude/rules/deploys.md`). Never `--no-verify`; never `--amend` after a failed hook — fix and make a new commit.

## Anti-patterns

- **Implementing across all layers in parallel.** Schema/data changes feed everything downstream — land them first.
- **Skipping integration tests for DB logic.** Mocks lie; mocked tests have passed while the real query broke.
- **Happy-path-only tests.** They catch nothing useful.
- **`as any` to silence the type checker.** It's usually right.
- **A destructive migration in the same release that stops using the column.** Expand now, contract later.
- **"Cleaning up" surrounding code while fixing a bug.** Out of scope — separate task.
