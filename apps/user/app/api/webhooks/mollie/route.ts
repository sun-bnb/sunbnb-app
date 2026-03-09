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

import prisma from '@repo/data/PrismaCient'
import {
  processConfirmedReservation,
  processConfirmedOrder,
} from '@repo/data/payment'
import { isTestMode } from '@repo/data/env'
import { NextRequest } from 'next/server'
import { getMollieClientForPartner } from '@/app/api/_lib/mollie'

// ─── Helpers ────────────────────────────────────────────────────────────────

interface MollieMetadata {
  type: 'reservation' | 'order'
  entityId: string
  siteId: string
}

/**
 * Parse metadata from the Mollie payment.
 * We stored it as a JSON string during payment creation.
 */
function parseMetadata(metadata: unknown): MollieMetadata | null {
  try {
    if (typeof metadata === 'string') {
      return JSON.parse(metadata) as MollieMetadata
    }
    if (metadata && typeof metadata === 'object') {
      return metadata as MollieMetadata
    }
    return null
  } catch {
    return null
  }
}

/**
 * Find the partner's Mollie access token from a paymentRef.
 * The paymentRef is stored on either a reservation or an order,
 * and we trace back through the site to the partner account.
 */
async function findPartnerAccessToken(paymentId: string): Promise<string | null> {
  // Check reservations first
  const reservation = await prisma.reservation.findFirst({
    where: { paymentRef: paymentId },
    select: {
      site: {
        select: {
          user: {
            select: {
              partnerAccount: {
                select: { mollieAccessToken: true },
              },
            },
          },
        },
      },
    },
  })
  if (reservation?.site?.user?.partnerAccount?.mollieAccessToken) {
    return reservation.site.user.partnerAccount.mollieAccessToken
  }

  // Check orders
  const order = await prisma.order.findFirst({
    where: { paymentRef: paymentId },
    select: {
      site: {
        select: {
          user: {
            select: {
              partnerAccount: {
                select: { mollieAccessToken: true },
              },
            },
          },
        },
      },
    },
  })
  if (order?.site?.user?.partnerAccount?.mollieAccessToken) {
    return order.site.user.partnerAccount.mollieAccessToken
  }

  return null
}

async function handlePaymentPaid(meta: MollieMetadata): Promise<void> {
  if (meta.type === 'reservation') {
    await processConfirmedReservation(meta.entityId)
  } else if (meta.type === 'order') {
    await processConfirmedOrder(meta.entityId)
  } else {
    console.warn('[Mollie Webhook] Unknown payment type in metadata:', meta.type)
  }
}

async function handlePaymentFailed(meta: MollieMetadata): Promise<void> {
  // Use updateMany to silently succeed on 0 rows (avoids RecordNotFound
  // which would cause Mollie to retry the webhook indefinitely)
  if (meta.type === 'reservation') {
    await prisma.reservation.updateMany({
      where: { id: meta.entityId },
      data: { status: 'payment_failed' },
    })
  } else if (meta.type === 'order') {
    await prisma.order.updateMany({
      where: { id: meta.entityId },
      data: { status: 'payment_failed' },
    })
  }
}

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

  // Find the partner's access token so we can fetch the payment from their account
  const accessToken = await findPartnerAccessToken(paymentId)
  if (!accessToken) {
    console.error('[Mollie Webhook] Cannot find partner access token for payment:', paymentId)
    // Return 200 to prevent Mollie from retrying — we can't process this
    return Response.json({ received: true })
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
  const meta = parseMetadata(payment.metadata)
  if (!meta?.type || !meta?.entityId) {
    console.warn('[Mollie Webhook] Payment missing metadata:', paymentId)
    // Return 200 — nothing we can do without metadata
    return Response.json({ received: true })
  }

  // Handle based on payment status
  try {
    switch (payment.status) {
      case 'paid': {
        console.log('[Mollie Webhook] Payment paid:', paymentId, meta.type, meta.entityId)
        await handlePaymentPaid(meta)
        break
      }

      case 'failed':
      case 'canceled':
      case 'expired': {
        console.log(`[Mollie Webhook] Payment ${payment.status}:`, paymentId, meta.type, meta.entityId)
        await handlePaymentFailed(meta)
        break
      }

      default:
        // open, pending, authorized — not terminal, ignore for now
        console.log('[Mollie Webhook] Non-terminal status:', payment.status, paymentId)
    }
  } catch (error) {
    console.error(`[Mollie Webhook] Error handling status ${payment.status}:`, error)
    // Return 500 so Mollie retries
    return Response.json({ error: 'Webhook handler failed' }, { status: 500 })
  }

  // Acknowledge receipt — Mollie won't retry if we return 200
  return Response.json({ received: true })
}
