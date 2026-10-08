/**
 * Online-checkout adapter registry (track 028). Stripe is wired (P3a); Viva wired in P4a.
 */
import type { OnlineCheckoutAdapter } from './types'
import { stripeAdapter } from './stripe-adapter'
import { vivaAdapter } from './viva-adapter'

export * from './types'

const ADAPTERS: Record<'stripe' | 'viva', OnlineCheckoutAdapter> = {
  stripe: stripeAdapter,
  viva: vivaAdapter,
}

export function getOnlineAdapter(provider: 'stripe' | 'viva'): OnlineCheckoutAdapter {
  return ADAPTERS[provider]
}
