/**
 * Unified Payment Provider Abstraction
 *
 * Routes payment operations by paymentRef prefix (vocabulary owned by
 * `@repo/data/payment-refs`):
 *   - "tr_*"      → Mollie Payment
 *   - "pi_demo_*" → Demo (no real provider)

 *   - "vso_*"     → Viva Smart Checkout (online); merchant resolved from the owning entity's partner
 *   - "viva_*"    → Viva card-present (confirmed by the partner floor flow)
 *   - "stripe_cs_*" / "stripe_pi_*" → Stripe Checkout / Tap-to-Pay on the partner's
 *     connected account (direct charges; account resolved from the owning entity)
 *
 * Subscriptions still use Stripe in the partner app, independently of this
 * consumer abstraction.
 */

import { providerFromRef, type PaymentProviderId } from '@repo/data/payment-refs'
import { isStripeCheckoutRef, stripeIdFromRef } from '@repo/data/payment-refs'
import prisma from '@repo/data/PrismaCient'
import { getMolliePaymentStatus } from './mollie'
import { findPaymentEntity } from './payment-events'

export type PaymentProvider = PaymentProviderId

/**
 * Detect which payment provider a paymentRef belongs to.
 * Returns null for unrecognized formats / cash / empty.
 */
export function detectProvider(paymentRef: string | null): PaymentProvider | null {
  return providerFromRef(paymentRef)
}

/**
 * Resolve the connected Stripe account that owns a Stripe ref, via the entity that
 * stores the ref (site -> partner, or restaurant -> partner for standalone restaurants).
 * Throws when the entity or the partner's Stripe account is missing.
 */
async function resolveStripeAccount(ref: string): Promise<string> {
  const { stripeAccountForSite, stripeAccountForPartner } = await import(
    '@repo/data/payment-providers/stripe-account'
  )
  const entity = await findPaymentEntity(ref)
  if (!entity) throw new Error(`No payment entity found for Stripe ref ${ref}`)
  let account: string | null = null
  if (entity.siteId) {
    account = await stripeAccountForSite(entity.siteId)
  } else if (entity.restaurantId) {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: entity.restaurantId },
      select: { siteId: true, partnerAccountId: true },
    })
    if (restaurant?.siteId) account = await stripeAccountForSite(restaurant.siteId)
    else if (restaurant) account = await stripeAccountForPartner(restaurant.partnerAccountId)
  }
  if (!account) throw new Error(`No connected Stripe account for ref ${ref}`)
  return account
}

async function getStripePaymentStatus(ref: string): Promise<string> {
  const account = await resolveStripeAccount(ref)
  const stripe = await import('@repo/data/stripe')
  const id = stripeIdFromRef(ref)
  const { state } = isStripeCheckoutRef(ref)
    ? await stripe.fetchCheckoutState(id, account)
    : await stripe.fetchPaymentIntentState(id, account)
  // 'refunded' means the money was collected first; the poll treats it as paid.
  return state === 'refunded' ? 'paid' : state
}

async function refundStripe(ref: string): Promise<void> {
  const account = await resolveStripeAccount(ref)
  const stripe = await import('@repo/data/stripe')
  const id = stripeIdFromRef(ref)
  let paymentIntentId: string | null = id
  if (isStripeCheckoutRef(ref)) {
    paymentIntentId = (await stripe.fetchCheckoutState(id, account)).paymentIntentId
  }
  if (!paymentIntentId) throw new Error(`No payment intent to refund for ref ${ref}`)
  await stripe.refundPaymentIntent(paymentIntentId, account)
}

/**
 * Resolve the partner's Viva merchant (ProviderAccount) for a vso_ ref via the owning entity
 * (site -> partner, or restaurant -> partner). Throws when the entity/merchant is missing.
 */
async function resolveVivaAccount(ref: string): Promise<{ partnerAccountId: string; vivaMerchantId: string }> {
  const entity = await findPaymentEntity(ref)
  if (!entity) throw new Error(`No payment entity found for Viva ref ${ref}`)
  let partnerAccountId: string | null = null
  if (entity.siteId) {
    const site = await prisma.site.findUnique({ where: { id: entity.siteId }, select: { userId: true } })
    partnerAccountId = site?.userId ?? null
  } else if (entity.restaurantId) {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: entity.restaurantId },
      select: { partnerAccountId: true },
    })
    partnerAccountId = restaurant?.partnerAccountId ?? null
  }
  if (!partnerAccountId) throw new Error(`No partner for Viva ref ${ref}`)
  const pa = await prisma.partnerAccount.findUnique({
    where: { userId: partnerAccountId },
    select: { vivaMerchantId: true },
  })
  if (!pa?.vivaMerchantId) throw new Error(`No connected Viva merchant for ref ${ref}`)
  return { partnerAccountId, vivaMerchantId: pa.vivaMerchantId }
}

async function getVivaPaymentStatus(ref: string): Promise<string> {
  const { getOnlineAdapter } = await import('@repo/data/payment-providers')
  const state = await getOnlineAdapter('viva').fetchState(ref, { partnerAccountId: '' })
  // 'refunded' means the money was collected first; the poll treats it as paid (like Stripe).
  return state === 'refunded' ? 'paid' : state
}

async function refundViva(ref: string): Promise<void> {
  const account = await resolveVivaAccount(ref)
  const { getOnlineAdapter } = await import('@repo/data/payment-providers')
  await getOnlineAdapter('viva').refund(ref, account)
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
    case 'viva-terminal':
      // Card-present is confirmed by the partner floor flow, never by the consumer poll.
      throw new Error('Payment provider viva-terminal is not polled here')
    case 'stripe':
    case 'stripe-terminal':
      return getStripePaymentStatus(paymentRef)
    case 'viva':
      return getVivaPaymentStatus(paymentRef)
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

/**
 * Issue a refund through the correct provider. `ctx.reservationId` is required
 * for card-present (viva_) refunds, which are resolved per reservation.
 */
export async function issueRefund(
  paymentRef: string,
  ctx?: { reservationId?: string },
): Promise<void> {
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
    case 'viva-terminal': {
      if (!ctx?.reservationId) {
        throw new Error('A reservationId is required to refund a viva-terminal payment')
      }
      const { refundReservationVivaPayment } = await import('@repo/data/reservation-payment')
      const outcome = await refundReservationVivaPayment(ctx.reservationId)
      if (outcome.status === 'error') {
        throw new Error(`Viva refund failed: ${outcome.error}`)
      }
      break
    }
    case 'stripe':
    case 'stripe-terminal':
      await refundStripe(paymentRef)
      break
    case 'viva':
      await refundViva(paymentRef)
      break
    default:
      throw new Error(`Unknown payment provider for ref: ${paymentRef}`)
  }
}
