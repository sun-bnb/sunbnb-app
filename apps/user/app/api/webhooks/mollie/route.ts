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
  processConfirmedRentalBooking,
  processConfirmedTabPayment,
} from '@repo/data/payment'
import { isTestMode } from '@repo/data/env'
import { NextRequest } from 'next/server'
import {
  getMollieClientForPartner,
  findPartnerAccountForPayment,
  getValidMollieToken,
  MollieReconnectRequiredError,
} from '@/app/api/_lib/mollie'
import {
  RESERVATION_PAYMENT_FAILED,
  RESERVATION_PAID_IN_CASH,
  RESERVATION_REFUNDED,
  ORDER_PAYMENT_FAILED,
  ORDER_REFUNDED,
  RENTAL_PAYMENT_FAILED,
  RENTAL_REFUNDED,
  TAB_PENDING_PAYMENT,
} from '@repo/data/reservation-status'
import {
  markDepositHeld,
  DEPOSIT_STATUS,
  confirmationEmailHtml,
} from '@repo/table-reservations-core'
import { sendEmail } from '@repo/data/email'

// ─── Helpers ────────────────────────────────────────────────────────────────

interface MollieMetadata {
  type: 'reservation' | 'order' | 'rental-booking' | 'table-deposit' | 'tab'
  entityId: string
  siteId?: string
  restaurantId?: string
  bookingIds?: string[]
  /**
   * Set by the partner QR walk-in collection flow. A failed/expired collection
   * must NOT mark the entity payment_failed — it reverts to paid-in-cash so the
   * guest keeps the bed (reservation) or the already-handed-over rental is not
   * stranded (rental-booking). Applies to both reservation and rental-booking
   * types.
   */
  collect?: boolean
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

async function handlePaymentPaid(meta: MollieMetadata, paymentId: string): Promise<void> {
  if (meta.type === 'reservation') {
    await processConfirmedReservation(meta.entityId)
  } else if (meta.type === 'order') {
    await processConfirmedOrder(meta.entityId)
  } else if (meta.type === 'rental-booking') {
    // Use the paymentRef (Mollie payment ID) to find all bookings in this group
    await processConfirmedRentalBooking(paymentId)
  } else if (meta.type === 'table-deposit') {
    // Confirm only on the PENDING → HELD transition so Mollie retries don't
    // re-send the confirmation email. The booking only becomes real now, so
    // the confirmation is sent here (mirrors the demo path in
    // apps/user/app/sites/[id]/table/actions.ts).
    const tr = await prisma.tableReservation.findUnique({
      where: { id: meta.entityId },
      select: {
        id: true,
        guestEmail: true,
        guestName: true,
        from: true,
        to: true,
        partySize: true,
        specialRequests: true,
        depositStatus: true,
        restaurant: { select: { name: true, slug: true, tagline: true } },
      },
    })
    if (tr && tr.depositStatus === DEPOSIT_STATUS.PENDING) {
      await markDepositHeld(meta.entityId, paymentId)
      if (tr.restaurant && tr.guestEmail) {
        try {
          await sendEmail({
            to: tr.guestEmail,
            subject: `Reservation confirmed at ${tr.restaurant.name}`,
            html: confirmationEmailHtml(tr, tr.restaurant, null),
          })
        } catch (err) {
          console.error('[Mollie Webhook] table-deposit confirmation email failed', err)
        }
      }
    }
  } else if (meta.type === 'tab') {
    // processConfirmedTabPayment is idempotent: creates invoices, stamps paymentRef
    // on orders, sets tab TAB_PAID + closedAt + nulls openTableId.
    await processConfirmedTabPayment(meta.entityId)
  } else {
    console.warn('[Mollie Webhook] Unknown payment type in metadata:', meta.type)
  }
}

async function handlePaymentFailed(meta: MollieMetadata): Promise<void> {
  if (meta.type === 'reservation') {
    // A QR walk-in collection that fails reverts to paid-in-cash (keep the
    // occupied bed); only a genuine online reservation goes payment_failed.
    if (meta.collect) {
      await prisma.reservation.updateMany({
        where: { id: meta.entityId },
        data: { status: RESERVATION_PAID_IN_CASH, paymentRef: null },
      })
    } else {
      await prisma.reservation.updateMany({
        where: { id: meta.entityId },
        data: { status: RESERVATION_PAYMENT_FAILED },
      })
    }
  } else if (meta.type === 'order') {
    await prisma.order.updateMany({
      where: { id: meta.entityId },
      data: { status: ORDER_PAYMENT_FAILED },
    })
  } else if (meta.type === 'rental-booking') {
    // Update all bookings that share this payment group
    const bookingIds = meta.bookingIds ?? [meta.entityId]
    if (meta.collect) {
      // A QR walk-in rental collection that fails reverts to paid-in-cash so an
      // already-handed-over rental is never stranded as payment_failed.
      await prisma.rentalBooking.updateMany({
        where: { id: { in: bookingIds } },
        data: { status: RESERVATION_PAID_IN_CASH, paymentRef: null },
      })
    } else {
      await prisma.rentalBooking.updateMany({
        where: { id: { in: bookingIds } },
        data: { status: RENTAL_PAYMENT_FAILED },
      })
    }
  } else if (meta.type === 'tab') {
    // Revert the tab so the party can retry payment. Guard on TAB_PENDING_PAYMENT
    // so a late failure event never reopens a tab that was already TAB_PAID.
    await prisma.tableTab.updateMany({
      where: { id: meta.entityId, status: TAB_PENDING_PAYMENT },
      data: { status: 'open', paymentRef: null },
    })
  }
}

async function handlePaymentRefunded(meta: MollieMetadata): Promise<void> {
  if (meta.type === 'reservation') {
    await prisma.reservation.updateMany({
      where: { id: meta.entityId },
      data: { status: RESERVATION_REFUNDED },
    })
  } else if (meta.type === 'order') {
    await prisma.order.updateMany({
      where: { id: meta.entityId },
      data: { status: ORDER_REFUNDED },
    })
  } else if (meta.type === 'rental-booking') {
    const bookingIds = meta.bookingIds ?? [meta.entityId]
    await prisma.rentalBooking.updateMany({
      where: { id: { in: bookingIds } },
      data: { status: RENTAL_REFUNDED },
    })
  } else if (meta.type === 'tab') {
    // Tab refunds are out of v1 scope — handled by staff-side flows in phase 5.
    // Log and no-op; do NOT attempt to mutate the tab status.
    console.warn('[Mollie Webhook] Tab refund received — not handled in v1:', meta.entityId)
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
  const meta = parseMetadata(payment.metadata)
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
        await handlePaymentPaid(meta, paymentId)
        break
      }

      case 'failed':
      case 'canceled':
      case 'expired': {
        console.log(`[Mollie Webhook] Payment ${status}:`, paymentId, meta.type, meta.entityId)
        await handlePaymentFailed(meta)
        break
      }

      case 'refunded': {
        console.log('[Mollie Webhook] Payment refunded:', paymentId, meta.type, meta.entityId)
        await handlePaymentRefunded(meta)
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
