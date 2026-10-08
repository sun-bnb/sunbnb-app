/**
 * Stripe Checkout as DIRECT charges on the partner's connected account (track 028, P3a).
 * SERVER-ONLY.
 *
 * Every call passes `{ stripeAccount }`, so the charge, refund and session live on the
 * connected account — never on the platform (track 003: the platform must not be the
 * merchant of record for consumer payments). The platform's cut rides as
 * `application_fee_amount` (commission + processing pass-through, see
 * `payment-providers/fee-policy.ts`).
 */
import type Stripe from 'stripe'
import { getStripeConnectClient } from './client'
import { toCents } from '../payment-math'
import type { PaymentState } from '../payment-refs'
import type { CheckoutIntent, PaymentMeta } from '../payment-providers/types'

const SESSION_TTL_SECONDS = 30 * 60

/** Stripe metadata is string -> string; ids are comma-joined, `collect` is '1'. */
export function flattenMeta(meta: PaymentMeta): Record<string, string> {
  const out: Record<string, string> = { type: meta.type, entityId: meta.entityId }
  if (meta.siteId !== undefined) out.siteId = meta.siteId
  if (meta.restaurantId !== undefined) out.restaurantId = meta.restaurantId
  if (meta.bookingIds !== undefined) out.bookingIds = meta.bookingIds.join(',')
  if (meta.collect) out.collect = '1'
  return out
}

export function unflattenMeta(m: Record<string, string> | null | undefined): PaymentMeta | null {
  if (!m || !m.type || !m.entityId) return null
  return {
    type: m.type as PaymentMeta['type'],
    entityId: m.entityId,
    ...(m.siteId ? { siteId: m.siteId } : {}),
    ...(m.restaurantId ? { restaurantId: m.restaurantId } : {}),
    ...(m.bookingIds ? { bookingIds: m.bookingIds.split(',').filter(Boolean) } : {}),
    ...(m.collect === '1' ? { collect: true } : {}),
  }
}

/** Append a query param without URL-encoding the value (Stripe's `{CHECKOUT_SESSION_ID}` template). */
function appendQuery(url: string, key: string, rawValue: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${key}=${rawValue}`
}

export async function createCheckoutSession(
  intent: CheckoutIntent,
  urls: { redirectUrl: string },
  stripeAccount: string,
  applicationFee: number,
): Promise<{ checkoutUrl: string; sessionId: string }> {
  const feeCents = toCents(applicationFee)
  const metadata = flattenMeta(intent.meta)
  const session = await getStripeConnectClient().checkout.sessions.create(
    {
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: toCents(intent.amount),
            product_data: { name: intent.description },
          },
        },
      ],
      payment_intent_data: {
        ...(feeCents > 0 ? { application_fee_amount: feeCents } : {}),
        metadata,
      },
      metadata,
      success_url: appendQuery(urls.redirectUrl, 'stripeSession', '{CHECKOUT_SESSION_ID}'),
      cancel_url: urls.redirectUrl,
      expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    },
    { stripeAccount },
  )
  if (!session.url) throw new Error('Stripe did not return a checkout URL')
  return { checkoutUrl: session.url, sessionId: session.id }
}

type ExpandedPI = Stripe.PaymentIntent & { latest_charge: Stripe.Charge | string | null }

function chargeOf(pi: ExpandedPI | null): Stripe.Charge | null {
  const c = pi?.latest_charge
  return c && typeof c !== 'string' ? c : null
}

function chargeIdOf(pi: ExpandedPI | null): string | null {
  const c = pi?.latest_charge
  if (!c) return null
  return typeof c === 'string' ? c : c.id
}

export async function fetchCheckoutState(
  sessionId: string,
  stripeAccount: string,
): Promise<{ state: PaymentState; paymentIntentId: string | null; chargeId: string | null; meta: PaymentMeta | null }> {
  const session = await getStripeConnectClient().checkout.sessions.retrieve(
    sessionId,
    { expand: ['payment_intent.latest_charge'] },
    { stripeAccount },
  )
  const pi =
    session.payment_intent && typeof session.payment_intent !== 'string'
      ? (session.payment_intent as ExpandedPI)
      : null
  const paymentIntentId =
    typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null)
  const charge = chargeOf(pi)

  let state: PaymentState
  if (session.status === 'complete' && session.payment_status === 'paid') {
    state = charge?.refunded ? 'refunded' : 'paid'
  } else if (session.status === 'expired') {
    state = 'failed'
  } else if (pi?.status === 'canceled') {
    state = 'failed'
  } else {
    state = 'pending'
  }
  return {
    state,
    paymentIntentId,
    chargeId: chargeIdOf(pi),
    meta: unflattenMeta(session.metadata),
  }
}

export async function fetchPaymentIntentState(
  paymentIntentId: string,
  stripeAccount: string,
): Promise<{ state: PaymentState; chargeId: string | null; meta: PaymentMeta | null }> {
  const pi = (await getStripeConnectClient().paymentIntents.retrieve(
    paymentIntentId,
    { expand: ['latest_charge'] },
    { stripeAccount },
  )) as ExpandedPI

  let state: PaymentState
  if (pi.status === 'succeeded') state = chargeOf(pi)?.refunded ? 'refunded' : 'paid'
  else if (pi.status === 'canceled') state = 'failed'
  else if (pi.status === 'requires_payment_method' && pi.last_payment_error) state = 'failed'
  else state = 'pending'
  return { state, chargeId: chargeIdOf(pi), meta: unflattenMeta(pi.metadata) }
}

/** Full refund when `amountCents` is omitted. The platform's application fee is returned too. */
export async function refundPaymentIntent(
  paymentIntentId: string,
  stripeAccount: string,
  amountCents?: number,
): Promise<void> {
  await getStripeConnectClient().refunds.create(
    {
      payment_intent: paymentIntentId,
      ...(amountCents !== undefined ? { amount: amountCents } : {}),
      refund_application_fee: true,
    },
    { stripeAccount },
  )
}

export async function expireCheckoutSession(
  sessionId: string,
  stripeAccount: string,
): Promise<'canceled' | 'paid' | 'error'> {
  const stripe = getStripeConnectClient()
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, undefined, { stripeAccount })
    if (session.status === 'complete' && session.payment_status === 'paid') return 'paid'
    if (session.status === 'expired') return 'canceled'
    await stripe.checkout.sessions.expire(sessionId, undefined, { stripeAccount })
    return 'canceled'
  } catch (err) {
    console.error('[stripe] expire checkout session failed:', err)
    return 'error'
  }
}
