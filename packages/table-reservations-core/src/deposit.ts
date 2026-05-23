// No-show deposit computation — pure, no DB. The *collection* of the deposit
// (Stripe/Mollie capture/refund) and invoice generation are Sunbnb-app concerns
// that live in the apps; this module only computes the required amount and owns
// the policy rule, so the rule is shared + testable.

import { NO_SHOW_POLICY } from './status'

/** 2-decimal financial rounding (kept local so core stays decoupled). */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export interface DepositPolicyInput {
  /** Restaurant.noShowPolicy — "none" | "deposit" (master switch). */
  noShowPolicy: string
  /** Restaurant.depositPerGuest (the default per-guest amount). */
  depositPerGuest: number | null
  /** The matching shift's requiresDeposit (false when no shift / not gated). */
  shiftRequiresDeposit: boolean
  /** The matching shift's depositMinPartySize (null = applies to any size). */
  shiftDepositMinPartySize: number | null
  partySize: number
  /**
   * Per-table override (chunk 1e). `null`/`undefined` = inherit the shift gate;
   * `true` = always require (ignores shift + min party); `false` = exempt.
   */
  tableRequiresDeposit?: boolean | null
  /** Per-table per-guest amount; overrides `depositPerGuest` when set. */
  tableDepositPerGuest?: number | null
}

/**
 * Required deposit amount for a booking, or 0 when none is due. Gated by the
 * restaurant master switch (`noShowPolicy === "deposit"`), then by the table
 * override if present, else the covering shift. The per-guest amount is the
 * table override when set, else the restaurant default. Forcing a deposit via a
 * table override ignores the shift's minimum party size.
 */
export function computeDepositAmount(input: DepositPolicyInput): number {
  if (input.noShowPolicy !== NO_SHOW_POLICY.DEPOSIT) return 0
  if (input.tableRequiresDeposit === false) return 0 // table exempt
  const requires =
    input.tableRequiresDeposit === true ? true : input.shiftRequiresDeposit
  if (!requires) return 0
  const perGuest = input.tableDepositPerGuest ?? input.depositPerGuest
  if (!perGuest || perGuest <= 0) return 0
  // The shift minimum applies only when inheriting the shift gate.
  const min = input.tableRequiresDeposit === true ? 1 : (input.shiftDepositMinPartySize ?? 1)
  if (input.partySize < min) return 0
  return roundMoney(perGuest * input.partySize)
}
