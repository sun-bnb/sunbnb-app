/**
 * Provider-neutral payment-state handlers (track 028, P1c).
 *
 * Moved verbatim out of the Mollie webhook so the webhook, the reconcile sweep
 * and (later) other providers' webhooks apply the SAME domain effects for
 * "this payment is paid / failed / refunded". Log prefixes keep the
 * `[Mollie Webhook]` tag on purpose (zero behaviour diff; tests pin them).
 */

import prisma from '@repo/data/PrismaCient'
import { applyTransition } from '@repo/data/reservation-machine-apply'
import {
  processConfirmedReservation,
  processConfirmedOrder,
  processConfirmedRentalBooking,
  processConfirmedTabPayment,
} from '@repo/data/payment'
import {
  RESERVATION_PAID_IN_CASH,
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

export interface PaymentMeta {
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
export function parsePaymentMeta(metadata: unknown): PaymentMeta | null {
  let parsed: PaymentMeta | null = null
  try {
    if (typeof metadata === 'string') {
      parsed = JSON.parse(metadata) as PaymentMeta
    } else if (metadata && typeof metadata === 'object') {
      parsed = metadata as PaymentMeta
    }
  } catch {
    return null
  }
  // An unidentifiable payment cannot be routed to an entity.
  if (!parsed?.type || !parsed?.entityId) return null
  return parsed
}

async function handlePaymentPaid(meta: PaymentMeta, paymentId: string): Promise<void> {
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

async function handlePaymentFailed(meta: PaymentMeta): Promise<void> {
  if (meta.type === 'reservation') {
    // Machine pay.fail — STATE decides the revert (track 018): a QR collection
    // (walkin·collecting) reverts to unsettled cash with the ref cleared (the
    // occupied bed survives); a genuine online reservation (online·processing)
    // goes payment_failed. The metadata.collect flag is no longer load-bearing.
    await applyTransition(meta.entityId, 'pay.fail')
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

async function handlePaymentRefunded(meta: PaymentMeta): Promise<void> {
  if (meta.type === 'reservation') {
    // Machine pay.refund.webhook (online·complete OR QR-collected walkin → refunded).
    await applyTransition(meta.entityId, 'pay.refund.webhook')
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

export async function onPaymentState(
  meta: PaymentMeta,
  paymentRef: string,
  state: 'paid' | 'failed' | 'refunded',
): Promise<void> {
  switch (state) {
    case 'paid':
      return handlePaymentPaid(meta, paymentRef)
    case 'failed':
      return handlePaymentFailed(meta)
    case 'refunded':
      return handlePaymentRefunded(meta)
  }
}

/**
 * Resolve which entity owns a paymentRef, in the same scan order as
 * `findPartnerAccountForPayment` (tab, reservation, order, rental, deposit).
 * Rentals return every booking sharing the ref (one payment per group).
 */
export async function findPaymentEntity(paymentRef: string): Promise<PaymentMeta | null> {
  const tab = await prisma.tableTab.findFirst({
    where: { paymentRef },
    select: { id: true, siteId: true, restaurantId: true },
  })
  if (tab) {
    return { type: 'tab', entityId: tab.id, siteId: tab.siteId ?? undefined, restaurantId: tab.restaurantId }
  }

  const reservation = await prisma.reservation.findFirst({
    where: { paymentRef },
    select: { id: true, siteId: true },
  })
  if (reservation) {
    return { type: 'reservation', entityId: reservation.id, siteId: reservation.siteId ?? undefined }
  }

  const order = await prisma.order.findFirst({
    where: { paymentRef },
    select: { id: true, siteId: true },
  })
  if (order) {
    return { type: 'order', entityId: order.id, siteId: order.siteId ?? undefined }
  }

  const bookings = await prisma.rentalBooking.findMany({
    where: { paymentRef },
    select: { id: true, siteId: true },
  })
  const first = bookings?.[0]
  if (first) {
    return {
      type: 'rental-booking',
      entityId: first.id,
      siteId: first.siteId ?? undefined,
      bookingIds: bookings.map((b) => b.id),
    }
  }

  const tableReservation = await prisma.tableReservation.findFirst({
    where: { paymentRef },
    select: { id: true, restaurantId: true },
  })
  if (tableReservation) {
    return { type: 'table-deposit', entityId: tableReservation.id, restaurantId: tableReservation.restaurantId }
  }

  return null
}
