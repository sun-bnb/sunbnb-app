/**
 * Unified Payment Provider Abstraction
 *
 * Routes payment operations to the correct provider (Stripe or Mollie)
 * based on the paymentRef format:
 *   - "pi_*"      → Stripe PaymentIntent
 *   - "tr_*"      → Mollie Payment
 *   - "pi_demo_*" → Demo (no real provider)
 */

import { getStripePaymentStatus, isDemoPayment } from './stripe'
import { getMolliePaymentStatus, isMolliePayment } from './mollie'

export type PaymentProvider = 'stripe' | 'mollie'

/**
 * Detect which payment provider a paymentRef belongs to.
 * Returns null for demo payments or unrecognized formats.
 */
export function detectProvider(paymentRef: string | null): PaymentProvider | 'demo' | null {
  if (!paymentRef) return null
  if (isDemoPayment(paymentRef)) return 'demo'
  if (isMolliePayment(paymentRef)) return 'mollie'
  if (paymentRef.startsWith('pi_')) return 'stripe'
  return null
}

/**
 * Get the payment status from the correct provider.
 * Returns the provider-specific status string.
 *
 * Stripe statuses: requires_payment_method, requires_confirmation,
 *   requires_action, processing, requires_capture, canceled, succeeded
 *
 * Mollie statuses: open, canceled, pending, authorized, expired, failed, paid
 */
export async function getPaymentStatus(paymentRef: string): Promise<string> {
  const provider = detectProvider(paymentRef)
  switch (provider) {
    case 'stripe':
      return getStripePaymentStatus(paymentRef)
    case 'mollie':
      return getMolliePaymentStatus(paymentRef)
    case 'demo':
      return 'succeeded'
    default:
      throw new Error(`Unknown payment provider for ref: ${paymentRef}`)
  }
}

/**
 * Check whether a payment has been confirmed/succeeded based on provider status.
 * Normalizes across both providers.
 */
export function isPaymentSucceeded(providerStatus: string): boolean {
  // Stripe: "succeeded", Mollie: "paid"
  return providerStatus === 'succeeded' || providerStatus === 'paid'
}

/**
 * Check whether a payment has definitively failed (not just pending).
 */
export function isPaymentFailed(providerStatus: string): boolean {
  // Stripe: "canceled", Mollie: "canceled", "expired", "failed"
  return ['canceled', 'expired', 'failed'].includes(providerStatus)
}

/**
 * Issue a refund through the correct provider.
 */
export async function issueRefund(paymentRef: string): Promise<void> {
  const provider = detectProvider(paymentRef)
  switch (provider) {
    case 'stripe': {
      const { getStripeClient } = await import('./stripe')
      const stripe = getStripeClient()
      await stripe.refunds.create({ payment_intent: paymentRef })
      break
    }
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
