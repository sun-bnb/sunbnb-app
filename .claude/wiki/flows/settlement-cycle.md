---
type: flow
slug: settlement-cycle
status: stable
sources:
  - apps/admin/app/settlements/actions.ts
  - packages/data/src/settlement.ts
  - packages/data/prisma/schema.prisma#model-Settlement
  - apps/admin/CLAUDE.md
related:
  - entity:settlement
  - entity:invoice
  - entity:service-fee
  - subsystem:auth
last_verified: 2026-05-20
---

# Flow: Settlement Cycle

Admin-app monthly payout workflow per partner. `DRAFT → CLOSED → APPROVED → PAID`, with revert paths.

## Trigger

Admin (`User.sudo === true`) navigates to the settlements view in `apps/admin` for a given partner + month.

## Pre-conditions

- The acting user is sudo. Enforced via `requireSudo()` at the start of every settlement action.
- At least one billable `Invoice` exists for the partner in the period (otherwise the settlement is zero-value but can still be created).

## Sequence

### Phase 1 — Generate

1. **Preview** — compute the aggregate for partner P in month M without persisting (`previewSettlement` style action). Read-only, can be re-run any time.
2. **Generate** — create or refresh the `Settlement` row.
   - If a `DRAFT` already exists: refresh aggregates from current invoices.
   - If `CLOSED+` already exists: refuse (re-generate would corrupt the frozen snapshot).
   - Status: `DRAFT`.

### Phase 2 — Close

3. **Close** — `closeSettlement(id)`:
   - Asserts current status `DRAFT`.
   - Freezes the aggregate fields against the current invoice state.
   - Status: `CLOSED`.

After closure, newly arriving invoices for the period are *not* automatically rolled in. Policy options if late invoices appear:
- Roll into the next period's DRAFT (preferred), or
- Revert (`CLOSED → DRAFT`), regenerate, re-close (rare; loses audit cleanliness of when close happened).

### Phase 3 — Approve

4. **Approve** — `approveSettlement(id)`:
   - Asserts current status `CLOSED`.
   - Records approval (timestamp, approver).
   - Status: `APPROVED`.

This signals "ready to pay" — typically a second pair of eyes vs. whoever closed.

### Phase 4 — Mark Paid

5. **Mark Paid** — `markSettlementPaid(id)`:
   - Asserts current status `APPROVED`.
   - Records payout reference (external transaction id, date).
   - Status: `PAID`.

Payment execution itself is external (bank transfer, Mollie payout, etc.) — the system records the fact, doesn't perform the transfer.

### Revert paths

- `revertApproval(id)` — `APPROVED → CLOSED`. Use before payment if approval was wrong.
- `revertClose(id)` — `CLOSED → DRAFT`. Reopens for editing. Avoid unless necessary.
- **There is no revert from `PAID`.** Issue an adjustment in the next period instead.

## Aggregation rule

For partner P in month M, sum across `Invoice` rows where:
- `Invoice.accountId === P.partnerAccount.id` (partner side only; platform invoices excluded)
- `Invoice.invoicedAt` in month M
- `Invoice.status` ∈ billable set (canonical in `packages/data/src/settlement.ts`)

Aggregates: `totalCharge` (net), `totalTax`, `totalAmount` (gross). Service fee netting is implicit via the partner invoice's line composition (`[[entity:invoice]]`).

## Side effects

- DB writes: `Settlement` insert/update.
- No emails by default. If "notify partner on approval/payment" is added later, document here.

## Failure modes

| Failure | Detection | Recovery |
|---|---|---|
| Non-sudo caller | `requireSudo` throws | Sign in as sudo user |
| Invalid transition (e.g. `approve` from `DRAFT`) | Action asserts status | Close first |
| Re-generate over `CLOSED+` | Action refuses | Revert if truly necessary |
| Concurrent close of same period | Race — last write wins | Run close once; settlements are not high-frequency |
| Late invoice after close | Not automatic | Roll into next period |

## Inconsistencies / known issues

- Admin actions have inconsistent error shapes. `settlements/actions.ts` uses `{ errors: string[] }` (plural). Match that within this file.
- `requireSudo()` error message in `settlements/actions.ts` is `'Unauthorized — sudo required'`; in `users/actions.ts` it's `'sudo required'`. Don't unify reflexively — check tests first.

## Related

- `[[entity:settlement]]` — the entity being driven through this flow
- `[[entity:invoice]]` — the underlying data being aggregated
- `[[entity:service-fee]]` — affects what shows up on partner invoices
- `[[subsystem:auth]]` — `requireSudo()` guard

## Common pitfalls

- **Approving a settlement before close.** Action will reject; don't try.
- **Closing the same month twice for one partner.** Idempotent only at the action layer — the schema should but may not enforce uniqueness. Verify before relying.
- **Editing invoice rows after a settlement is CLOSED+.** Breaks the aggregate's truthfulness. The hash chain on invoices makes this immediately detectable in audit.
- **Bundling adjustments into a paid settlement.** `PAID` is terminal — adjustments go to the next period.
