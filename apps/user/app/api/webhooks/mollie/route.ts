/**
 * POST /api/webhooks/mollie
 *
 * Mollie webhook endpoint. Handles payment status changes.
 *
 * Unlike Stripe (which sends full event payloads), Mollie sends only
 * the payment ID in the body: `id=tr_...` (form-encoded).
 * We must fetch the payment from Mollie to get the actual status.
 *
 * Because the payment was created on the partner's Mollie account
 * (Mollie for Platforms), we need the partner's access token to
 * retrieve the payment. We look this up via the paymentRef stored
 * on the reservation/order.
 *
 * Handled statuses:
 * - paid       → creates invoice via shared payment service
 * - failed     → marks reservation/order as payment_failed
 * - canceled   → marks reservation/order as payment_failed
 * - expired    → marks reservation/order as payment_failed
 *
 * This is the PRIMARY confirmation path. The polling routes in
 * GET /api/reservations/[id] and GET /api/orders/[id] serve as FALLBACK.
 */

import { isTestMode } from '@repo/data/env'
import { NextRequest } from 'next/server'
import {
  getMollieClientForPartner,
  findPartnerAccountForPayment,
  getValidMollieToken,
  MollieReconnectRequiredError,
} from '@/app/api/_lib/mollie'
import { parsePaymentMeta, onPaymentState } from '@/app/api/_lib/payment-events'

// ─── Route Handler ──────────────────────────────────────────────────────────

/** Mollie payment IDs: tr_ prefix followed by alphanumeric chars. */
const MOLLIE_PAYMENT_ID_PATTERN = /^tr_[A-Za-z0-9]{1,50}$/

export async function POST(request: NextRequest) {
  // Mollie sends a form-encoded body with `id=tr_...`
  const formData = await request.formData()
  const paymentId = formData.get('id') as string | null

  if (!paymentId) {
    console.warn('[Mollie Webhook] Missing payment id in body')
    return Response.json({ error: 'Missing payment id' }, { status: 400 })
  }

  if (!MOLLIE_PAYMENT_ID_PATTERN.test(paymentId)) {
    console.warn('[Mollie Webhook] Invalid payment id format:', paymentId)
    return Response.json({ error: 'Invalid payment id format' }, { status: 400 })
  }

  console.log('[Mollie Webhook] Received webhook for payment:', paymentId)

  // Resolve the partner this payment belongs to, then get a VALID token via the
  // centralized manager (refreshes + backfills expiry) rather than reading the
  // raw stored token — otherwise an expired token would 401 here.
  const partnerAccountId = await findPartnerAccountForPayment(paymentId)
  if (!partnerAccountId) {
    console.error('[Mollie Webhook] Cannot find partner account for payment:', paymentId)
    // Return 200 to prevent Mollie from retrying — we can't process this
    return Response.json({ received: true })
  }

  let accessToken: string
  try {
    accessToken = await getValidMollieToken(partnerAccountId)
  } catch (err) {
    if (err instanceof MollieReconnectRequiredError) {
      console.error('[Mollie Webhook] Partner must reconnect Mollie — cannot verify payment:', paymentId)
      // Unrecoverable without a reconnect — 200 so Mollie stops retrying.
      return Response.json({ received: true })
    }
    console.error('[Mollie Webhook] Token refresh failed (transient):', paymentId, err)
    // Transient — 500 so Mollie retries later.
    return Response.json({ error: 'Token refresh failed' }, { status: 500 })
  }

  // Fetch the full payment object from Mollie (partner's account)
  // In non-production, test payments require testmode: true with OAuth tokens
  const mollie = getMollieClientForPartner(accessToken)
  let payment
  try {
    payment = await mollie.payments.get(paymentId, { testmode: isTestMode() } as any)
  } catch (error) {
    console.error('[Mollie Webhook] Failed to fetch payment:', paymentId, error)
    // Return 500 so Mollie retries
    return Response.json({ error: 'Failed to fetch payment' }, { status: 500 })
  }

  // Parse metadata to identify the entity
  const meta = parsePaymentMeta(payment.metadata)
  if (!meta?.type || !meta?.entityId) {
    console.warn('[Mollie Webhook] Payment missing metadata:', paymentId)
    // Return 200 — nothing we can do without metadata
    return Response.json({ received: true })
  }

  // Handle based on payment status
  const status = payment.status as string
  try {
    switch (status) {
      case 'paid': {
        console.log('[Mollie Webhook] Payment paid:', paymentId, meta.type, meta.entityId)
        await onPaymentState(meta, paymentId, 'paid')
        break
      }

      case 'failed':
      case 'canceled':
      case 'expired': {
        console.log(`[Mollie Webhook] Payment ${status}:`, paymentId, meta.type, meta.entityId)
        await onPaymentState(meta, paymentId, 'failed')
        break
      }

      case 'refunded': {
        console.log('[Mollie Webhook] Payment refunded:', paymentId, meta.type, meta.entityId)
        await onPaymentState(meta, paymentId, 'refunded')
        break
      }

      default:
        // open, pending, authorized — not terminal, ignore for now
        console.log('[Mollie Webhook] Non-terminal status:', status, paymentId)
    }
  } catch (error) {
    console.error(`[Mollie Webhook] Error handling status ${status}:`, error)
    // Return 500 so Mollie retries
    return Response.json({ error: 'Webhook handler failed' }, { status: 500 })
  }

  // Acknowledge receipt — Mollie won't retry if we return 200
  return Response.json({ received: true })
}
