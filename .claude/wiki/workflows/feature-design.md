---
type: workflow
slug: feature-design
status: stable
sources:
  - .claude/wiki/README.md
  - .claude/rules/architecture.md
  - packages/data/src/payment-refs.ts
  - packages/data/src/payment-providers/index.ts
  - apps/user/app/api/_lib/payment-provider.ts
related:
  - workflow:implementation
  - subsystem:payments
  - subsystem:reservation-state-machine
last_verified: 2026-10-13
---

# Workflow: Feature Design

The procedure for going from "we want to add X" to a concrete, file-level implementation plan. Use it *before* writing code on any change larger than a single function. When the change crosses an app boundary, touches `packages/data`, or changes a shared contract, this design *is* the architecture pass of `.claude/rules/architecture.md` — run its checklist here.

## Procedure

### 1. Frame the feature

One paragraph of user-visible behaviour:
- Who is the actor (consumer, anonymous consumer, partner, floor staff on mobile, admin)?
- What is the entry point (route, action, event, device)?
- What are the success and failure outcomes?

Check `.claude/tracks/index.md` — if a track already owns this goal, design inside it.

### 2. Map to existing concepts

For each concept in the framing, find the wiki page (`/context-loop:wiki query`: index + `/context-loop:recall`):

- "Affects bookings" → `[[entity:reservation]]` + `[[subsystem:reservation-state-machine]]`
- "Involves payment" → `[[flow:reservation-payment]]` + `[[subsystem:payments]]`
- "Touches partner authorization" → `[[subsystem:auth]]`
- "Generates revenue line" → `[[entity:invoice]]` + `[[entity:service-fee]]`

List the pages read. Concepts with no page are ingest candidates after the feature ships.

### 3. Identify constraints and invariants

From those pages and `.claude/rules/`, write down every invariant the feature must respect — they become non-negotiable acceptance criteria. Cite, don't restate, e.g.:
- fee cascade site → partnerAccount → settings (`[[entity:service-fee]]`);
- idempotent invoice creation, provider identified by `paymentRef` prefix (`.claude/rules/payments.md`);
- ownership before every site mutation (`.claude/rules/auth.md`);
- status values are constants and transitions go through the state machine (`[[subsystem:reservation-state-machine]]`).

### 4. Identify the data model impact

- **New model or fields?** `packages/data/prisma/schema.prisma` + `npm run migrate:local` from `packages/data`; additive only (nullable/defaulted) per `.claude/rules/migrations.md`. A column read by an `assistant.*` view pins its type.
- **New status value?** `packages/data/src/reservation-status.ts` and the transition table in `packages/data/src/reservation-machine.ts`.
- **New fee tier or product code?** Fee resolution + invoice lines in `packages/data/src/payment.ts` (`processConfirmed*`).

If yes, the data package changes first — every app depends on it, and each app's `__mocks__/@repo/data/` may need the matching mock.

### 5. Identify the app surface

Which app(s) — `apps/user`, `apps/partner`, `apps/admin`, `apps/mobile`, `apps/marketing`? For each, list:
- new pages, API routes, server actions (`'use server'`), components;
- auth implications (existing guard enough? new helper?);
- state (RTK Query endpoint / polling in the user app);
- UI — prime with `/ui <surface>`; i18n keys in `messages/{en,es,fi}.json`.

Read the surface's `CLAUDE.md` and its pulled siblings (`PATTERNS.md`, `TESTING.md`, `UI.md`, …) for the conventions you'll follow.

### 6. Identify side effects

- **Emails?** Extend the templates in `packages/data/src/reservation-emails.ts` (sent via `packages/data/src/email.ts`).
- **Consumer payment?** Consumer rails are Mollie, Stripe Connect direct charges, Viva Smart Checkout and demo, one provider per partner account. The rail is identified by `paymentRef` prefix (`@repo/data/payment-refs`); provider adapters, availability, selection and the fee policy live in `packages/data/src/payment-providers/`; the user app routes by prefix in `apps/user/app/api/_lib/payment-provider.ts`. Design against these abstractions — never a provider-specific branch in feature code.
- **Webhook?** New route re-fetches state from the provider before acting; extend reconciliation (`/api/reconcile`) if the flow can get stuck.
- **Cron?** Add it to `crons` in the app's `vercel.json`.

### 7. Decide testability

- Pure logic → unit test next to the module (`*.test.ts`).
- DB-touching logic → `*.integration.test.ts` against `sunbnb_test`.
- API route / server action → test with mocked `@repo/data` + auth.

Name the **bug-revealing edge cases**: unauthenticated, anonymous, ownership mismatch, double submission, concurrent action, zero quantity, negative price, expired token, missing env var / provider not connected.

### 8. Produce a written plan

In the conversation (not a wiki page), a numbered plan with:
- files to create (path) and files to edit (concept of the change, not the diff);
- migrations, and whether each is expand or contract;
- tests to add;
- risks, each mitigated by an invariant from step 3;
- blast radius: every app/package touched.

For non-trivial changes, present the plan and wait for approval before writing code. Large or multi-option designs go to the `Plan` agent.

### 9. After the feature ships

Run `/context-loop:wiki ingest` to fold new concepts and flows into the wiki.

## Anti-patterns

- **Skipping the wiki scan.** You will miss an invariant; it becomes a production bug.
- **Designing the schema last.** Schema drives the apps here — decide it first.
- **A new status value outside the constants module and state machine.** Apps type-check and break at runtime.
- **Money math outside `packages/data`.** Payment, fee and invoice logic lives there; apps consume.
- **A provider-specific branch in feature code.** Go through `payment-refs` / `payment-providers`.
- **Inventing fee amounts.** Fees come from the `ServiceFee` / settings cascade — never hardcoded.
