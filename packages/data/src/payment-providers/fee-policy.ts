/**
 * Stripe application-fee policy (track 028, P3a). PURE.
 *
 * Connected accounts are created with `controller.fees.payer = 'application'`, so Stripe
 * bills the PLATFORM for card processing. Under 'commission-plus-processing' we recover
 * that cost by adding an estimate to the `application_fee_amount`, and the PLATFORM
 * invoice (payment.ts `platformPassThroughFor`) bills it to the partner as a VAT-exempt
 * `processingFee` line — the same treatment as Mollie/PSP fees (payments.md). The consumer
 * total is never touched.
 */
import { round } from '../payment-math'

export type ApplicationFeePolicy = 'commission-plus-processing' | 'commission-only'

/** Founder decision 2026-10-07 (track 028). */
export const STRIPE_APPLICATION_FEE_POLICY: ApplicationFeePolicy = 'commission-plus-processing'

/** EEA standard cards. Stripe bills the platform (controller fees.payer='application'). */
export const STRIPE_PROCESSING_ESTIMATE = { percentage: 1.5, fixedAmount: 0.25 } as const

export function stripeProcessingEstimate(amount: number): number {
  if (!(amount > 0)) return 0
  return round((amount * STRIPE_PROCESSING_ESTIMATE.percentage) / 100 + STRIPE_PROCESSING_ESTIMATE.fixedAmount)
}

export function stripePassThrough(
  amount: number,
  policy: ApplicationFeePolicy = STRIPE_APPLICATION_FEE_POLICY,
): number {
  return policy === 'commission-plus-processing' ? stripeProcessingEstimate(amount) : 0
}

/** Total `application_fee_amount` (EUR). Capped below the charge — Stripe rejects fee >= amount. */
export function stripeApplicationFee(
  commission: number,
  amount: number,
  policy: ApplicationFeePolicy = STRIPE_APPLICATION_FEE_POLICY,
): number {
  const fee = round(commission + stripePassThrough(amount, policy))
  return Math.max(0, Math.min(fee, round(amount - 0.01)))
}
