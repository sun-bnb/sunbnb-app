/**
 * Shared Stripe SDK client (track 028, P3a). SERVER-ONLY — reads `STRIPE_SECRET_KEY`
 * and pulls the `stripe` SDK; never import from a client component.
 *
 * Two clients: `getStripeClient()` (partner subscriptions, `STRIPE_SECRET_KEY`) and
 * `getStripeConnectClient()` (Stripe Connect, `STRIPE_CONNECT_SECRET_KEY`). They are
 * different Stripe accounts in practice; direct charges use the `stripeAccount` request
 * option — see `checkout.ts`. The API version is left to the SDK default.
 */
import Stripe from 'stripe'

let cached: { key: string; client: Stripe } | null = null

/** Platform Stripe client. Throws if `STRIPE_SECRET_KEY` is unset; cached per key. */
export function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  if (!cached || cached.key !== key) cached = { key, client: new Stripe(key) }
  return cached.client
}

const connectCache = new Map<string, Stripe>()

/**
 * Stripe Connect platform client. Uses `STRIPE_CONNECT_SECRET_KEY`, falling back to
 * `STRIPE_SECRET_KEY` so single-account setups (one Stripe account for both
 * subscriptions and Connect) keep working. Cached per key.
 */
export function getStripeConnectClient(): Stripe {
  const key = process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_CONNECT_SECRET_KEY (or STRIPE_SECRET_KEY) is not configured')
  let c = connectCache.get(key)
  if (!c) {
    c = new Stripe(key)
    connectCache.set(key, c)
  }
  return c
}
