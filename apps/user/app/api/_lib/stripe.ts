/**
 * Shared Stripe Utilities for API Routes
 *
 * Centralizes Stripe client creation, payment status retrieval,
 * and common helper functions used across payment-related routes.
 */

import Stripe from 'stripe'

/**
 * Create a Stripe client instance. Throws if STRIPE_SECRET_KEY is not set.
 */
export function getStripeClient(): Stripe {
  const { STRIPE_SECRET_KEY } = process.env
  if (!STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not set')
  }
  return new Stripe(STRIPE_SECRET_KEY)
}

/**
 * Retrieve the status of a Stripe PaymentIntent by its ID.
 */
export async function getStripePaymentStatus(paymentRef: string): Promise<string> {
  const stripe = getStripeClient()
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentRef)
  return paymentIntent.status
}

/**
 * Check if a paymentRef is a demo/fake payment (not a real Stripe PI).
 */
export function isDemoPayment(paymentRef: string | null): boolean {
  return paymentRef?.startsWith('pi_demo_') ?? false
}

/**
 * Validate an entity ID format. Accepts both CUID (Prisma default) and UUID v4.
 */
export function isValidEntityId(value: string): boolean {
  // CUID: starts with 'c', 25 chars, lowercase alphanumeric
  const cuid = /^c[a-z0-9]{24,}$/
  // UUID v4: 8-4-4-4-12 hex
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return cuid.test(value) || uuid.test(value)
}
