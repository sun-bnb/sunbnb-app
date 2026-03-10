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
import {
  RESERVATION_PROCESSING,
  ORDER_PROCESSING,
  RENTAL_PROCESSING,
} from '@repo/data/reservation-status'
import {
  processConfirmedReservation,
  processConfirmedOrder,
  processConfirmedRentalBooking,
} from '@repo/data/payment'

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

  const paymentRef = `pi_demo_${Date.now()}`

  await prisma.reservation.update({
    where: { id: reservationId },
    data: { paymentRef, status: RESERVATION_PROCESSING },
  })

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
 * Verifies ownership via session userId.
 */
export async function initiateDemoRentalPayment(rentalBookingIds: string[]) {
  if (!DEMO_MODE_ENABLED) {
    return { status: 'error', errors: ['Demo mode is not enabled'] }
  }

  if (!rentalBookingIds.length) {
    return { status: 'error', errors: ['No booking IDs provided'] }
  }

  const bookings = await prisma.rentalBooking.findMany({
    where: { id: { in: rentalBookingIds } },
  })

  if (bookings.length !== rentalBookingIds.length) {
    return { status: 'error', errors: ['Some bookings not found'] }
  }

  // Verify ownership
  const session = await auth()
  if (!session?.user?.id) {
    return { status: 'error', errors: ['Not authenticated'] }
  }

  if (bookings.some(b => b.userId !== session.user!.id)) {
    return { status: 'error', errors: ['Not authorized'] }
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

  return reservation
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

  return order
}