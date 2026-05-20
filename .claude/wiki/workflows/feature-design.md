---
type: workflow
slug: feature-design
status: stable
sources:
  - .claude/wiki/README.md
related:
  - workflow:query
  - workflow:implementation
last_verified: 2026-05-20
---

# Workflow: Feature Design

The procedure for going from "we want to add X" to a concrete, file-level implementation plan. Use this *before* writing code on any change larger than a single function.

## Procedure

### 1. Frame the feature

Capture, in one paragraph, the user-visible behaviour:
- Who is the actor (consumer, partner, admin, anonymous user)?
- What is the entry point (route, action, event)?
- What is the success outcome?
- What is the failure outcome?

### 2. Map to existing concepts

For each concept in the framing, look up the wiki:

- "Affects bookings" → `[[entity:reservation]]`
- "Involves payment" → `[[flow:reservation-payment]]` + `[[subsystem:payments]]`
- "Touches partner authorization" → `[[subsystem:auth]]`
- "Generates revenue line" → `[[entity:invoice]]` + `[[entity:service-fee]]`

Make a list of pages read. If you find concepts the wiki has no page for, note them — they may need ingest after this feature ships.

### 3. Identify constraints and invariants

From the wiki pages and `.claude/rules/`, extract every invariant the feature must respect. Examples:
- "Service fees use a three-tier cascade — site → partnerAccount → settings" (`[[entity:service-fee]]`)
- "Invoice creation must be idempotent" (`.claude/rules/payments.md`)
- "All site mutations require `requireSiteOwner()`" (`[[subsystem:auth]]`)
- "Status fields are plain String columns; use constants from `@repo/data/reservation-status`" (`.claude/rules/data-access.md`)

Write these down. They will become non-negotiable acceptance criteria.

### 4. Identify the data model impact

Will the feature need:
- A new model? Edit `packages/data/prisma/schema.prisma`, add migration via `npm run migrate:local` from `packages/data`.
- New fields on an existing model? Same.
- A new status value? Add to `packages/data/src/reservation-status.ts` AND update the mock at `apps/*/__mocks__/@repo/data/reservation-status.ts` if it diverges.
- New service-fee tier or product code? Update fee resolution + invoice-line creation in `packages/data/src/payment.ts`.

If yes, the data package is the first place to change — apps depend on it.

### 5. Identify the app surface

Which app(s) does the feature touch? For each, list:
- New routes (`apps/<app>/app/<route>/page.tsx`)
- New API routes (`apps/<app>/app/api/<route>/route.ts`)
- New server actions (file with `'use server'` at top)
- New components
- Auth model implications (existing guard sufficient? need new helper?)
- State management impact (new Redux slice? new RTK Query endpoint?)
- i18n impact (`messages/{en,es,fi}.json`)

### 6. Identify side effects

- Will it send emails? Edit/extend `packages/data/src/reservation-emails.ts`.
- Will it call Stripe/Mollie? Use the abstractions in `apps/user/app/api/_lib/payment-provider.ts` (or pull them up if a new app needs them).
- Will it trigger a webhook? Define new webhook route, update reconciliation if applicable.
- Will it need a cron job? Edit `vercel.json` in the relevant app.

### 7. Decide testability

For each component:
- Pure logic → unit test in the closest `*.test.ts`
- DB-touching logic → integration test (`*.integration.test.ts`) in `packages/data/src/` or `apps/*/app/...`
- API route → route test with mocked Prisma + auth
- Server action → action test with mocked Prisma + auth

Identify the **bug-revealing edge cases** (per `feedback_testing_philosophy`): unauthenticated user, anonymous user, ownership mismatch, double submission, race condition with concurrent action, zero-quantity input, negative price, expired token, missing env var.

### 8. Produce a written plan

Output (in the conversation, not as a wiki page) a numbered plan with:
- Files to create (with intended path)
- Files to edit (with the concept of the change, not the diff)
- Migrations to run
- Tests to add
- Risks and how each is mitigated by an invariant from step 3

For non-trivial changes, use the `ExitPlanMode` tool to present this plan and wait for approval before writing code.

### 9. After the feature ships

Run `[[workflow:ingest]]` to fold the new concepts/flows into the wiki.

## Anti-patterns

- **Skipping the wiki scan.** You will miss an invariant. The invariant will become a bug in production.
- **Designing the schema last.** Schema drives the apps in this project. Decide it first.
- **Adding a new status value without updating the constants module.** Apps will type-check fine and break at runtime.
- **Designing payment logic outside `packages/data/src/payment.ts`.** All money math goes there; apps consume.
- **Inventing fee logic.** Fees are configured in `Settings` / `ServiceFee` records. Never hardcode.
