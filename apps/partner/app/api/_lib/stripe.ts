/**
 * Shared Stripe Utilities for Partner App API Routes
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
