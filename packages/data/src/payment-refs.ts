/**
 * Payment-ref prefix vocabulary (track 028, packet P1a).
 *
 * PURE and client-safe — no fetch, no env, no prisma — same discipline as
 * `viva/refs.ts`: minting and lookup share ONE definition. `Reservation.paymentRef`
 * (and the rental / order equivalents) is a single string discriminated by prefix:
 *
 *   tr_          Mollie payment id
 *   pi_demo_     demo mode (no real provider; a bare `pi_…` is NOT demo)
 *   viva_        Viva card-present (Cloud Terminal session)
 *   vso_         Viva online checkout (order code)
 *   stripe_cs_   Stripe Checkout session
 *   stripe_pi_   Stripe Terminal payment intent
 *
 * Every other module (refund, payment, promotion, floor-core) imports from here
 * instead of keeping private `startsWith(...)` copies.
 */

export { isVivaPaymentRef, vivaRefFromSession, sessionFromVivaRef } from './viva/refs'

export type PaymentProviderId = 'mollie' | 'demo' | 'viva' | 'viva-terminal' | 'stripe' | 'stripe-terminal'
export type SelectableProvider = 'mollie' | 'viva' | 'stripe'
export type PaymentState = 'paid' | 'failed' | 'refunded' | 'pending'

export const REF_PREFIX = {
  mollie: 'tr_',
  demo: 'pi_demo_',
  vivaTerminal: 'viva_',
  viva: 'vso_',
  stripeCheckout: 'stripe_cs_',
  stripeTerminal: 'stripe_pi_',
} as const

const PREFIX_TABLE: ReadonlyArray<readonly [string, PaymentProviderId]> = [
  [REF_PREFIX.mollie, 'mollie'],
  [REF_PREFIX.demo, 'demo'],
  [REF_PREFIX.vivaTerminal, 'viva-terminal'],
  [REF_PREFIX.viva, 'viva'],
  [REF_PREFIX.stripeCheckout, 'stripe'],
  [REF_PREFIX.stripeTerminal, 'stripe-terminal'],
]

const MOLLIE_REF_RE = /^tr_[A-Za-z0-9]{1,50}$/

function hasPrefix(ref: string | null | undefined, prefix: string): boolean {
  return typeof ref === 'string' && ref.startsWith(prefix) && ref.length > prefix.length
}

/** Which provider minted this ref? `null` for cash / off-platform / unknown / bare `pi_…`. */
export function providerFromRef(ref: string | null | undefined): PaymentProviderId | null {
  for (const [prefix, id] of PREFIX_TABLE) {
    if (hasPrefix(ref, prefix)) return id
  }
  return null
}

export function isDemoPayment(ref: string | null | undefined): boolean {
  return providerFromRef(ref) === 'demo'
}

/** Mollie payment id — same shape the webhook validates. */
export function isMolliePaymentRef(ref: string | null | undefined): ref is string {
  return typeof ref === 'string' && MOLLIE_REF_RE.test(ref)
}

export function isVivaCheckoutRef(ref: string | null | undefined): ref is string {
  return hasPrefix(ref, REF_PREFIX.viva)
}

export function isStripeCheckoutRef(ref: string | null | undefined): ref is string {
  return hasPrefix(ref, REF_PREFIX.stripeCheckout)
}

export function isStripeTerminalRef(ref: string | null | undefined): ref is string {
  return hasPrefix(ref, REF_PREFIX.stripeTerminal)
}

export function isStripeRef(ref: string | null | undefined): boolean {
  return isStripeCheckoutRef(ref) || isStripeTerminalRef(ref)
}

/** A real money-moving provider ref (not demo, cash, off-platform or unknown). */
export function isLiveProviderRef(ref: string | null | undefined): boolean {
  const p = providerFromRef(ref)
  return p !== null && p !== 'demo'
}

/**
 * May this ref be refunded through a provider? Same as `isLiveProviderRef` today;
 * a separate name on purpose so the UI rule can diverge from the clock rule.
 */
export function isRefundableOnlineRef(ref: string | null | undefined): boolean {
  return isLiveProviderRef(ref)
}

export function vivaCheckoutRefFromOrder(orderCode: string): string {
  if (!orderCode) throw new Error('vivaCheckoutRefFromOrder requires a non-empty orderCode')
  return `${REF_PREFIX.viva}${orderCode}`
}

export function orderCodeFromVivaCheckoutRef(ref: string): string {
  if (!isVivaCheckoutRef(ref)) throw new Error(`Not a Viva checkout ref: ${ref}`)
  return ref.slice(REF_PREFIX.viva.length)
}

export function stripeCheckoutRef(sessionId: string): string {
  if (!sessionId) throw new Error('stripeCheckoutRef requires a non-empty sessionId')
  return `${REF_PREFIX.stripeCheckout}${sessionId}`
}

export function stripeTerminalRef(paymentIntentId: string): string {
  if (!paymentIntentId) throw new Error('stripeTerminalRef requires a non-empty paymentIntentId')
  return `${REF_PREFIX.stripeTerminal}${paymentIntentId}`
}

/** Strip either `stripe_` wrapper, returning the raw Stripe id. Throws on a non-Stripe ref. */
export function stripeIdFromRef(ref: string): string {
  // hasPrefix directly: the type-predicate guards would narrow `ref` to never on the false branch.
  if (hasPrefix(ref, REF_PREFIX.stripeCheckout)) return ref.slice(REF_PREFIX.stripeCheckout.length)
  if (hasPrefix(ref, REF_PREFIX.stripeTerminal)) return ref.slice(REF_PREFIX.stripeTerminal.length)
  throw new Error(`Not a Stripe payment ref: ${ref}`)
}
