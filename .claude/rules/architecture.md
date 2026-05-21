# Architecture Rules

When a change is more than a local edit, run an architecture pass *before* writing code. These rules say when that pass is required and what it checks. They don't restate the domain rules in `payments.md` / `data-access.md` / `auth.md` — they make sure those rules, and cross-app impact, are actually weighed.

## When an architecture pass is required

Run the checklist below before coding when the change:

- crosses an app boundary (touches more than one of `apps/user`, `apps/partner`, `apps/admin`), or
- touches `packages/data` — the Prisma schema, a migration, or the payment/invoice/settlement core, or
- changes a shared contract (`@repo/data` exports, status constants, the server-action `{ status, errors }` shape, an API route another surface consumes), or
- has non-obvious blast radius, or more than one reasonable design.

Trivial single-surface edits (copy, styling, a local bugfix with no contract change) skip it — don't manufacture ceremony.

## The checklist

- **Blast radius.** Name every app/package the change touches before editing a shared export. All three apps depend on `@repo/data`; a change there ripples to user, partner, and admin — and to each app's `__mocks__/@repo/data/PrismaCient.ts`.
- **Schema & migrations.** Schema lives only in `packages/data`. Prefer additive (nullable/defaulted) columns over destructive ones. Follow the sequence: `migrate:local` → integration tests → `migrate:test` → notify apps. A schema or payment-core change is *always* an architecture pass (see `data-access.md`, `payments.md`).
- **Idempotency & race windows.** Invoice/reservation/order/rental creation must stay idempotent — re-running is a no-op. Keep availability-check + create in one operation; don't widen a race window (see `data-access.md`, `payments.md`).
- **Fee cascade & VAT.** Reuse the three-tier cascade and reverse-VAT helpers in `@repo/data`; never recompute money inline. Reservations deduct the fee from partner revenue; orders add it to the customer total — don't mix them (see `payments.md`).
- **Auth & ownership.** Every user-scoped read/mutation verifies ownership before acting; preserve anon `anonId` parity in the user app; `sudo` is admin-only. Never trust a client-supplied id (see `auth.md`).
- **Performance & scale.** Watch PostGIS query cost and GiST index use, polling / RTK-Query load, N+1 reads, and serverless cold-start assumptions (the in-memory rate limiter resets on every cold start).
- **Maintainability & duplication.** Reuse `@repo/data` / `@repo/ui` instead of re-implementing. Respect the quirks that must NOT be "fixed": the `"./PrismaCient"` export typo (every app depends on the path) and the `@repo/data`↔`@repo/ui` component duplication.

## Escalate, don't guess

- When blast radius is unclear or the change spans apps, surface it to the orchestrator/user *before* proceeding — name the affected surfaces and the options you see.
- Use the `Plan` agent for context-isolated design exploration of a large change; use `/review` and `code-review` as the pre-push gate.
- Architecture is an orchestrator-owned concern — there is **no dedicated architect agent**. A domain-dev agent that hits cross-app scope hands the design decision up rather than improvising across surfaces it doesn't own.
