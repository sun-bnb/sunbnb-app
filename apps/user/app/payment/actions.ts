/**
 * Payment Server Actions
 *
 * Server-side actions for the payment flow. Security measures:
 * - Demo mode actions require DEMO_MODE_ENABLED env var
 * - Demo mode actions verify ownership (session userId or anonId)
 * - Query actions verify authentication and ownership
 * - paymentRef is stored server-side (not here — in PI creation routes)
 * - Status transitions are controlled — clients cannot set arbitrary status
 */

'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { applyTransition } from '@repo/data/reservation-machine-apply'
import {
  RESERVATION_PROCESSING,
  ORDER_PROCESSING,
  RENTAL_PROCESSING,
  TAB_OPEN,
  TAB_PENDING_PAYMENT,
  TAB_TERMINAL_STATUSES,
} from '@repo/data/reservation-status'
import {
  processConfirmedReservation,
  processConfirmedOrder,
  processConfirmedRentalBooking,
  processConfirmedTabPayment,
  calculateTabTotal,
} from '@repo/data/payment'
import { isValidEntityId } from '@/app/api/_lib/payment-ids'

const DEMO_MODE_ENABLED = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'

// ─── Demo Mode Actions ──────────────────────────────────────────────────────

/**
 * Process a demo payment for a reservation.
 * Only available when NEXT_PUBLIC_DEMO_MODE is enabled.
 * Verifies ownership via session userId or anonId.
 */
export async function initiateDemoReservationPayment(reservationId: string, anonId?: string) {
  if (!DEMO_MODE_ENABLED) {
    return { status: 'error', errors: ['Demo mode is not enabled'] }
  }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
  })

  if (!reservation) {
    return { status: 'error', errors: ['Reservation not found'] }
  }

  // Verify ownership: session user or matching anonId
  const session = await auth()

  if (session?.user?.id) {
    if (session.user.id !== reservation.userId) {
      return { status: 'error', errors: ['Not authorized'] }
    }
  } else if (reservation.anonId) {
    if (!anonId || anonId !== reservation.anonId) {
      return { status: 'error', errors: ['Not authorized'] }
    }
  } else {
    return { status: 'error', errors: ['Not authorized'] }
  }

  if (reservation.paymentRef) {
    return { status: 'ok', paymentRef: reservation.paymentRef }
  }

  // Machine pay.initiate (demo variant): pending → processing with a pi_demo
  // ref stamped by the interpreter (track 018). Non-pending states are reject
  // cells — a payment can only be initiated once.
  const init = await applyTransition(reservationId, 'pay.initiate', { collect: { demo: true } })
  if (init.outcome !== 'applied') {
    return { status: 'error', errors: ['Payment cannot be initiated for this reservation'] }
  }
  const paymentRef = init.data?.paymentRef as string

  try {
    await processConfirmedReservation(reservationId)
  } catch (error) {
    console.error('[Demo] Failed to process reservation:', error)
    // The reservation is still saved with paymentRef — a page reload will retry via polling
  }

  return { status: 'ok', paymentRef }
}

/**
 * Process a demo payment for an order.
 * Only available when NEXT_PUBLIC_DEMO_MODE is enabled.
 * Verifies ownership via session userId or anonId.
 */
export async function initiateDemoOrderPayment(orderId: string, anonId?: string) {
  if (!DEMO_MODE_ENABLED) {
    return { status: 'error', errors: ['Demo mode is not enabled'] }
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
  })

  if (!order) {
    return { status: 'error', errors: ['Order not found'] }
  }

  // Verify ownership: session user or matching anonId
  const session = await auth()

  if (session?.user?.id) {
    if (session.user.id !== order.userId) {
      return { status: 'error', errors: ['Not authorized'] }
    }
  } else if (order.anonId) {
    if (!anonId || anonId !== order.anonId) {
      return { status: 'error', errors: ['Not authorized'] }
    }
  } else {
    return { status: 'error', errors: ['Not authorized'] }
  }

  if (order.paymentRef) {
    return { status: 'ok', paymentRef: order.paymentRef }
  }

  const paymentRef = `pi_demo_${Date.now()}`

  await prisma.order.update({
    where: { id: orderId },
    data: { paymentRef, status: ORDER_PROCESSING },
  })

  try {
    await processConfirmedOrder(orderId)
  } catch (error) {
    console.error('[Demo] Failed to process order:', error)
    // The order is still saved with paymentRef — a page reload will retry via polling
  }

  return { status: 'ok', paymentRef }
}

/**
 * Process a demo payment for rental bookings.
 * Only available when NEXT_PUBLIC_DEMO_MODE is enabled.
 * Verifies ownership via session userId or anonId (mirrors initiateDemoReservationPayment).
 */
export async function initiateDemoRentalPayment(rentalBookingIds: string[], anonId?: string) {
  if (!DEMO_MODE_ENABLED) {
    return { status: 'error', errors: ['Demo mode is not enabled'] }
  }

  if (!rentalBookingIds.length) {
    return { status: 'error', errors: ['No booking IDs provided'] }
  }

  // Validate anonId format if supplied (UUID v4, max 36 chars)
  if (anonId !== undefined) {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (anonId.length > 36 || !UUID_REGEX.test(anonId)) {
      return { status: 'error', errors: ['Invalid anonId format'] }
    }
  }

  const bookings = await prisma.rentalBooking.findMany({
    where: { id: { in: rentalBookingIds } },
  })

  if (bookings.length !== rentalBookingIds.length) {
    return { status: 'error', errors: ['Some bookings not found'] }
  }

  // Verify ownership: session user or matching anonId (mirror initiateDemoReservationPayment)
  const session = await auth()

  if (session?.user?.id) {
    if (bookings.some(b => b.userId !== session.user!.id)) {
      return { status: 'error', errors: ['Not authorized'] }
    }
  } else {
    // Anonymous path: every booking must have an anonId that matches the caller's
    const allHaveAnonId = bookings.every(b => b.anonId)
    if (!allHaveAnonId || !anonId) {
      return { status: 'error', errors: ['Not authenticated'] }
    }
    if (bookings.some(b => b.anonId !== anonId)) {
      return { status: 'error', errors: ['Not authorized'] }
    }
  }

  // Skip if already has paymentRef
  if (bookings.some(b => b.paymentRef)) {
    return { status: 'ok', paymentRef: bookings.find(b => b.paymentRef)!.paymentRef }
  }

  const paymentRef = `pi_demo_${Date.now()}`

  await prisma.rentalBooking.updateMany({
    where: { id: { in: rentalBookingIds } },
    data: { paymentRef, status: RENTAL_PROCESSING },
  })

  try {
    await processConfirmedRentalBooking(paymentRef)
  } catch (error) {
    console.error('[Demo] Failed to process rental booking:', error)
  }

  return { status: 'ok', paymentRef }
}

/**
 * Process a demo payment for a dine-in tab.
 * Only available when NEXT_PUBLIC_DEMO_MODE is enabled.
 *
 * Security model: NO ownership check by design. This follows the
 * QR-URL-as-credential model — possessing the open tab's CUID (from the QR
 * URL) is the credential. Any holder of the QR-URL (i.e. anyone at the table)
 * may initiate payment.
 *
 * Mirrors the Mollie route's claim logic exactly so demo and real flows are
 * consistent: TAB_OPEN → TAB_PENDING_PAYMENT → paymentRef set → process.
 */
export async function initiateDemoTabPayment(tabId: string) {
  if (!DEMO_MODE_ENABLED) {
    return { status: 'error', errors: ['Demo mode is not enabled'] }
  }

  if (!isValidEntityId(tabId)) {
    return { status: 'error', errors: ['Invalid tab ID'] }
  }

  // ── Load tab ─────────────────────────────────────────────────────────────

  const tab = await prisma.tableTab.findUnique({
    where: { id: tabId },
    select: { id: true, status: true, paymentRef: true },
  })

  if (!tab) {
    return { status: 'error', errors: ['Tab not found'] }
  }

  // Idempotent re-tap: if we already claimed + set a paymentRef, return it.
  if (tab.paymentRef && (tab.status === TAB_PENDING_PAYMENT || (TAB_TERMINAL_STATUSES as readonly string[]).includes(tab.status))) {
    return { status: 'ok', paymentRef: tab.paymentRef }
  }

  // ── Claim the tab atomically (TAB_OPEN → TAB_PENDING_PAYMENT) ───────────

  const claimResult = await prisma.tableTab.updateMany({
    where: { id: tabId, status: TAB_OPEN },
    data: { status: TAB_PENDING_PAYMENT },
  })

  if (claimResult.count === 0) {
    // Re-read to understand why
    const current = await prisma.tableTab.findUnique({
      where: { id: tabId },
      select: { status: true },
    })

    if (!current) {
      return { status: 'error', errors: ['Tab not found'] }
    }

    if (current.status === TAB_PENDING_PAYMENT) {
      return { status: 'error', errors: ['Payment already in progress'] }
    }

    if ((TAB_TERMINAL_STATUSES as readonly string[]).includes(current.status)) {
      return { status: 'error', errors: ['Tab is already closed'] }
    }

    return { status: 'error', errors: ['Tab cannot be paid in its current state'] }
  }

  // ── Verify the tab has something to pay (never trust client totals) ──────

  const totals = await calculateTabTotal(tabId)

  if (totals.payableTotal <= 0) {
    // Revert the claim — nothing to pay
    await prisma.tableTab.updateMany({
      where: { id: tabId, status: TAB_PENDING_PAYMENT },
      data: { status: TAB_OPEN, paymentRef: null },
    })
    return { status: 'error', errors: ['Tab has no payable amount'] }
  }

  // ── Set paymentRef and process ───────────────────────────────────────────

  const paymentRef = `pi_demo_${Date.now()}`

  await prisma.tableTab.update({
    where: { id: tabId },
    data: { paymentRef },
  })

  try {
    await processConfirmedTabPayment(tabId)
  } catch (error) {
    // paymentRef is set — the poll route will retry processConfirmedTabPayment.
    // Do NOT revert the claim here: the payment is considered made in demo mode.
    console.error('[Demo] Failed to process tab payment:', error)
  }

  return { status: 'ok', paymentRef }
}

// ─── Query Actions ──────────────────────────────────────────────────────────

export async function getReservationById({ id }: { id: string }) {
  const session = await auth()
  if (!session?.user) {
    return { status: 'error', errors: ['Not authenticated'] }
  }

  const reservation = await prisma.reservation.findFirst({
    where: { id },
  })

  // Verify ownership
  if (reservation && reservation.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  return { reservation }
}

export async function getReservationByPaymentRef({
  paymentRef,
}: {
  paymentRef: string
}) {
  const session = await auth()
  if (!session?.user) {
    return { status: 'error', errors: ['Not authenticated'] }
  }

  const reservation = await prisma.reservation.findFirst({
    where: { paymentRef },
  })

  // Verify ownership
  if (reservation && reservation.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  return { reservation }
}

export async function getOrderByPaymentRef({
  paymentRef,
}: {
  paymentRef: string
}) {
  const session = await auth()
  if (!session?.user) {
    return { status: 'error', errors: ['Not authenticated'] }
  }

  const order = await prisma.order.findFirst({
    where: { paymentRef },
  })

  // Verify ownership
  if (order && order.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  return { order }
}