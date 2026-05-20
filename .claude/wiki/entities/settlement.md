---
type: entity
slug: settlement
status: stable
sources:
  - packages/data/prisma/schema.prisma#model-Settlement
  - packages/data/src/settlement.ts
  - apps/admin/app/settlements/actions.ts
  - apps/admin/CLAUDE.md
related:
  - entity:invoice
  - entity:service-fee
  - entity:reservation
  - entity:order
  - flow:settlement-cycle
last_verified: 2026-05-20
---

# Settlement

Monthly aggregation of partner-side invoices into a single payout record. Owned by the admin app. The unit of partner payout reconciliation.

## Schema essentials

`Settlement` (`packages/data/prisma/schema.prisma`):
- `accountId` (FK → PartnerAccount) — the partner being paid
- Period: month + year (one settlement per partner per month)
- Aggregates: total revenue, total fees, total tax, payout amount
- `status` — see lifecycle below

See `packages/data/src/settlement.ts` for the canonical aggregation logic and the exact fields.

## Status lifecycle

```
DRAFT → CLOSED → APPROVED → PAID
   ↑       ↑
   └ revert: APPROVED → CLOSED, CLOSED → DRAFT
```

- **DRAFT** — created (auto or manual), still mutable, can include in-progress data
- **CLOSED** — month is sealed, aggregates frozen, no new invoices roll in
- **APPROVED** — admin has reviewed and approved for payout
- **PAID** — payout has been executed (external — bank transfer, Mollie payout, etc.)

Revert paths:
- `APPROVED → CLOSED` — withdraw approval before payment
- `CLOSED → DRAFT` — reopen for editing (rare — typically only if late invoices need inclusion)

`PAID` is terminal. Do not revert from PAID; issue a correcting adjustment instead.

## Aggregation rule

A Settlement for partner P in month M aggregates all `Invoice` rows where:
- `Invoice.accountId === P.partnerAccount.id` (partner invoices only — the platform invoices are aggregated separately)
- `Invoice.invoicedAt` falls in month M
- `Invoice.status` is consistent with "billable" (canonical in `packages/data/src/settlement.ts`)

The aggregation sums `totalAmount`, `totalCharge`, `totalTax` across matched invoices. Service fees (which appear as lines on partner invoices) are netted out per the line composition documented in `[[entity:invoice]]`.

## Invariants

1. **One settlement per partner per month.** Uniqueness should be enforced at the action layer.
2. **`DRAFT` can be regenerated.** `CLOSED+` should not — closing freezes the snapshot.
3. **Only sudo users** can transition states. See `apps/admin/app/settlements/actions.ts` — every action begins with `requireSudo()`.
4. **`PAID` is terminal.** Corrections happen via a new adjustment record (or a manual journal entry, depending on policy).
5. **Invoices generated AFTER closure** for that period are an exception condition. Policy: include them in the next period's settlement, or reopen via revert (rare).

## Owned entirely by `apps/admin`

The settlement lifecycle is admin-only. Partner-app views (if/when added) are read-only. Server actions live in `apps/admin/app/settlements/actions.ts`.

## Related entities

- `[[entity:invoice]]` — settlements aggregate partner-side invoices.
- `[[entity:service-fee]]` — fees appear as lines on partner invoices and are netted into the partner payout total.
- `[[entity:reservation]]`, `[[entity:order]]` — original revenue sources (via invoices).

## Related flows

- `[[flow:settlement-cycle]]` — full admin workflow: generate → close → approve → mark paid.

## Common pitfalls

- **Modifying a CLOSED+ settlement.** The aggregate is frozen on purpose. Reverting back to DRAFT loses the audit trail of when closure happened.
- **Bypassing `requireSudo()`.** Settlement state changes touch real money. No "self-serve" partner mutations.
- **Confusing partner invoices and platform invoices.** Each payment creates both. Settlement aggregates the partner side only.
- **Generating a settlement before the period is over.** DRAFT is the right state for an in-month preview; never CLOSE a month early.
- **Inconsistent error shapes** between admin actions. Known: `users/actions.ts` and `sites/actions.ts` return `{ error: string }` (singular), while `settlements/actions.ts`, `fees/actions.ts`, `platform/actions.ts` return `{ errors: string[] }` (plural). Stay consistent within each file.
