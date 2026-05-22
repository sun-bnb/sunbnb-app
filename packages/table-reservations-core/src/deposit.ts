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
  /** Restaurant.noShowPolicy — "none" | "deposit". */
  noShowPolicy: string
  /** Restaurant.depositPerGuest. */
  depositPerGuest: number | null
  /** The matching shift's requiresDeposit (false when no shift / not gated). */
  shiftRequiresDeposit: boolean
  /** The matching shift's depositMinPartySize (null = applies to any size). */
  shiftDepositMinPartySize: number | null
  partySize: number
}

/**
 * Required deposit amount for a booking, or 0 when none is due. A deposit is due
 * only when the restaurant policy is "deposit", the covering shift opts in, a
 * positive per-guest amount is set, and the party meets the shift's minimum.
 */
export function computeDepositAmount(input: DepositPolicyInput): number {
  if (input.noShowPolicy !== NO_SHOW_POLICY.DEPOSIT) return 0
  if (!input.shiftRequiresDeposit) return 0
  if (!input.depositPerGuest || input.depositPerGuest <= 0) return 0
  const min = input.shiftDepositMinPartySize ?? 1
  if (input.partySize < min) return 0
  return roundMoney(input.depositPerGuest * input.partySize)
}
