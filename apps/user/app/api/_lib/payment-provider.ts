/**
 * Unified Payment Provider Abstraction
 *
 * Routes payment operations by paymentRef format:
 *   - "tr_*"      → Mollie Payment
 *   - "pi_demo_*" → Demo (no real provider)
 *
 * Consumer Stripe was removed (see .claude/tracks/003-stripe-connect-compliance.md).
 * Subscriptions still use Stripe in the partner app, independently of this
 * consumer abstraction.
 */

import { isDemoPayment } from './payment-ids'
import { getMolliePaymentStatus, isMolliePayment } from './mollie'

export type PaymentProvider = 'mollie'

/**
 * Detect which payment provider a paymentRef belongs to.
 * Returns 'demo' for demo refs, null for unrecognized formats.
 */
export function detectProvider(paymentRef: string | null): PaymentProvider | 'demo' | null {
  if (!paymentRef) return null
  if (isDemoPayment(paymentRef)) return 'demo'
  if (isMolliePayment(paymentRef)) return 'mollie'
  return null
}

/**
 * Get the payment status from the correct provider.
 *
 * Mollie statuses: open, canceled, pending, authorized, expired, failed, paid
 */
export async function getPaymentStatus(paymentRef: string): Promise<string> {
  const provider = detectProvider(paymentRef)
  switch (provider) {
    case 'mollie':
      return getMolliePaymentStatus(paymentRef)
    case 'demo':
      return 'succeeded'
    default:
      throw new Error(`Unknown payment provider for ref: ${paymentRef}`)
  }
}

/** Whether a payment has been confirmed/succeeded based on provider status. */
export function isPaymentSucceeded(providerStatus: string): boolean {
  // Mollie: "paid"; demo: "succeeded"
  return providerStatus === 'paid' || providerStatus === 'succeeded'
}

/** Whether a payment has definitively failed (not just pending). */
export function isPaymentFailed(providerStatus: string): boolean {
  return ['canceled', 'expired', 'failed'].includes(providerStatus)
}

/** Issue a refund through the correct provider. */
export async function issueRefund(paymentRef: string): Promise<void> {
  const provider = detectProvider(paymentRef)
  switch (provider) {
    case 'mollie': {
      const { getMolliePaymentForRefund } = await import('./mollie')
      const { client, payment } = await getMolliePaymentForRefund(paymentRef)
      await client.paymentRefunds.create({
        paymentId: paymentRef,
        amount: payment.amount,
      })
      break
    }
    case 'demo':
      // No-op for demo payments
      break
    default:
      throw new Error(`Unknown payment provider for ref: ${paymentRef}`)
  }
}
