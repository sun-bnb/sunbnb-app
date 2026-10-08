/**
 * POST /api/webhooks/stripe-connect (track 028, P3c)
 *
 * Stripe Connect webhook: events from partners' connected accounts (direct charges).
 * The payload is only a trigger — every handled event is RE-FETCHED from Stripe with
 * `event.account` as the `stripeAccount`, and we act on the re-fetched state alone
 * (never the platform account, never the event body).
 *
 * Contract: 503 secret unset · 400 bad signature · 200 ignored/handled · 500 handler
 * error (Stripe retries; the payment-state handlers are idempotent).
 */
import { NextRequest } from 'next/server'
import type Stripe from 'stripe'
import {
  getStripeConnectClient,
  fetchCheckoutState,
  fetchPaymentIntentState,
  unflattenMeta,
} from '@repo/data/stripe'
import { stripeCheckoutRef, stripeTerminalRef, type PaymentState } from '@repo/data/payment-refs'
import { findPaymentEntity, onPaymentState } from '@/app/api/_lib/payment-events'

type Meta = NonNullable<ReturnType<typeof unflattenMeta>>

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  if (!secret) {
    console.error('[Stripe Connect Webhook] STRIPE_CONNECT_WEBHOOK_SECRET is not set')
    return Response.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  const payload = await request.text()
  const stripe = getStripeConnectClient()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(payload, request.headers.get('stripe-signature') ?? '', secret)
  } catch {
    console.warn('[Stripe Connect Webhook] Signature verification failed')
    return Response.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const account = event.account
  if (!account) return Response.json({ received: true, ignored: 'not a connect event' })

  try {
    let ref: string
    let state: PaymentState
    let meta: Meta | null

    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed': {
        const session = event.data.object as Stripe.Checkout.Session
        ref = stripeCheckoutRef(session.id)
        const fresh = await fetchCheckoutState(session.id, account)
        state = fresh.state
        meta = fresh.meta ?? unflattenMeta(session.metadata)
        break
      }

      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled': {
        const pi = event.data.object as Stripe.PaymentIntent
        ref = stripeTerminalRef(pi.id)
        const entity = await findPaymentEntity(ref)
        // Checkout-created PIs are handled through the session events.
        if (!entity) return Response.json({ received: true, ignored: 'not a terminal payment' })
        const fresh = await fetchPaymentIntentState(pi.id, account)
        state = fresh.state
        meta = fresh.meta ?? entity
        break
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge
        const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
        if (!piId) return Response.json({ received: true, ignored: 'charge without payment intent' })
        ref = stripeTerminalRef(piId)
        if (!(await findPaymentEntity(ref))) {
          const sessions = await stripe.checkout.sessions.list(
            { payment_intent: piId },
            { stripeAccount: account },
          )
          const sessionId = sessions.data[0]?.id
          if (!sessionId) return Response.json({ received: true, ignored: 'unknown payment' })
          ref = stripeCheckoutRef(sessionId)
        }
        state = 'refunded'
        meta = null
        break
      }

      default:
        return Response.json({ received: true })
    }

    // Expired / failed events are only failures while the re-fetched state says so.
    if (state === 'pending') return Response.json({ received: true })

    const resolved = meta ?? (await findPaymentEntity(ref))
    if (!resolved) return Response.json({ received: true, ignored: 'unknown payment' })

    await onPaymentState(resolved, ref, state)
  } catch (error) {
    console.error(`[Stripe Connect Webhook] Error handling ${event.type}:`, error)
    return Response.json({ error: 'Webhook handler failed' }, { status: 500 })
  }

  return Response.json({ received: true })
}
