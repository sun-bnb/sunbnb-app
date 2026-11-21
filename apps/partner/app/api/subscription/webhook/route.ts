/**
 * POST /api/subscription/webhook
 *
 * Stripe webhook endpoint for subscription lifecycle events.
 * Handles:
 * - customer.subscription.created  → sync new subscription
 * - customer.subscription.updated  → sync plan changes, status changes
 * - customer.subscription.deleted  → downgrade to STARTER
 * - invoice.payment_failed         → mark subscription as PAST_DUE
 *
 * Setup:
 * 1. Add STRIPE_SUBSCRIPTION_WEBHOOK_SECRET to environment variables
 * 2. Register this URL in Stripe Dashboard → Webhooks
 *    URL: https://partner-domain.com/api/subscription/webhook
 *    Events: customer.subscription.created, customer.subscription.updated,
 *            customer.subscription.deleted, invoice.payment_failed
 */

import { NextRequest } from 'next/server'
import Stripe from 'stripe'
import { getStripeClient } from '@/app/api/_lib/stripe'
import { syncStripeSubscription, handleSubscriptionCanceled } from '@repo/data/subscription'

// ─── Helpers ────────────────────────────────────────────────────────────────

function mapStripeStatus(stripeStatus: string): 'ACTIVE' | 'PAST_DUE' | 'CANCELED' {
  switch (stripeStatus) {
    case 'active':
    case 'trialing':
      return 'ACTIVE'
    case 'past_due':
    case 'unpaid':
      return 'PAST_DUE'
    case 'canceled':
    case 'incomplete_expired':
      return 'CANCELED'
    default:
      return 'ACTIVE'
  }
}

async function handleSubscriptionEvent(subscription: Stripe.Subscription) {
  const partnerAccountId = subscription.metadata?.partnerAccountId
  if (!partnerAccountId) {
    console.warn('[SubWebhook] Subscription missing partnerAccountId metadata:', subscription.id)
    return
  }

  const item = subscription.items.data[0]
  if (!item) {
    console.warn('[SubWebhook] Subscription has no items:', subscription.id)
    return
  }

  const stripePriceId = item.price.id
  const status = mapStripeStatus(subscription.status)
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer.id

  const periodStart = (subscription as any).current_period_start
  const periodEnd = (subscription as any).current_period_end

  await syncStripeSubscription(
    subscription.id,
    customerId,
    stripePriceId,
    status,
    new Date(periodStart * 1000),
    new Date(periodEnd * 1000),
    partnerAccountId,
  )
}

// ─── Route Handler ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { STRIPE_SUBSCRIPTION_WEBHOOK_SECRET } = process.env

  if (!STRIPE_SUBSCRIPTION_WEBHOOK_SECRET) {
    console.error('[SubWebhook] STRIPE_SUBSCRIPTION_WEBHOOK_SECRET is not configured')
    return Response.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const payload = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return Response.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  const stripe = getStripeClient()
  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(payload, signature, STRIPE_SUBSCRIPTION_WEBHOOK_SECRET)
  } catch (error) {
    console.error('[SubWebhook] Signature verification failed:', error)
    return Response.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        console.log(`[SubWebhook] ${event.type}:`, subscription.id)
        await handleSubscriptionEvent(subscription)
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const partnerAccountId = subscription.metadata?.partnerAccountId
        console.log('[SubWebhook] Subscription deleted:', subscription.id)
        if (partnerAccountId) {
          await handleSubscriptionCanceled(partnerAccountId)
        }
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const subId = (invoice as any).subscription
        console.log('[SubWebhook] Payment failed for subscription:', subId)
        // The subscription.updated event will also fire with past_due status,
        // which handles the DB update via handleSubscriptionEvent
        break
      }

      default:
        console.log('[SubWebhook] Unhandled event type:', event.type)
    }
  } catch (error) {
    console.error(`[SubWebhook] Error handling ${event.type}:`, error)
    return Response.json({ error: 'Webhook handler failed' }, { status: 500 })
  }

  return Response.json({ received: true })
}
