'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { isDemoPayment, isValidEntityId } from '@/app/api/_lib/payment-ids'
import { issueRefund } from '@/app/api/_lib/payment-provider'
import {
  RENTAL_COMPLETE,
  RENTAL_CANCELED,
  RENTAL_REFUNDED,
  OP_PICKED_UP,
  OP_RETURNED,
} from '@repo/data/reservation-status'

// ─── Cancel Rental Booking ───────────────────────────────────────────────────
//
// Mirrors cancelReservation in app/reservations/[id]/actions.ts.
//
// Ownership: session userId OR anonId (for anonymous renters) — both paths
// verified with explicit checks (verifyOwnership is an API-route helper that
// reads session; here we use the server-action pattern of direct comparison).
//
// Refund: rentals are grouped by paymentRef — one payment may cover multiple
// RentalBooking rows. We cancel all rows sharing the same paymentRef and issue
// exactly one refund (not one per row). Only refund when status === RENTAL_COMPLETE
// and paymentRef is a real (non-demo) payment.
//
// Terminal / already-past-pickup guard: do NOT cancel if:
//   - status is already RENTAL_CANCELED or RENTAL_REFUNDED (already terminal)
//   - operationalStatus is OP_PICKED_UP or OP_RETURNED (past pickup — can't un-serve)

export async function cancelRentalBooking(bookingId: string, anonId?: string) {
  if (!isValidEntityId(bookingId)) {
    return { status: 'error', errors: ['Invalid booking ID'] }
  }

  const session = await auth()

  // Require at least one identity
  if (!session?.user && !anonId) {
    return { status: 'error', errors: ['Authentication required'] }
  }

  // Validate anonId format if provided (must be UUID v4)
  if (!session?.user && anonId) {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!UUID_RE.test(anonId)) {
      return { status: 'error', errors: ['Invalid anonId format'] }
    }
  }

  // Fetch the booking — include operationalStatus for the terminal guard
  const booking = await prisma.rentalBooking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      userId: true,
      anonId: true,
      status: true,
      operationalStatus: true,
      paymentRef: true,
    },
  })

  if (!booking) {
    return { status: 'error', errors: ['Booking not found'] }
  }

  // ── Ownership check ──────────────────────────────────────────────────────
  // Session user: must match booking.userId
  // Anonymous user: anonId must match booking.anonId (never allow missing/mismatched)
  if (session?.user?.id) {
    if (booking.userId !== session.user.id) {
      return { status: 'error', errors: ['Not authorized'] }
    }
  } else {
    // Anonymous path — anonId was already validated as UUID above
    if (!booking.anonId || booking.anonId !== anonId) {
      return { status: 'error', errors: ['Not authorized'] }
    }
  }

  // ── Already-terminal guard ────────────────────────────────────────────────
  if (booking.status === RENTAL_CANCELED || booking.status === RENTAL_REFUNDED) {
    // Already in a terminal canceled/refunded state — idempotent ok
    return { status: 'ok' }
  }

  // ── Past-pickup guard ─────────────────────────────────────────────────────
  // Cannot cancel a booking that has been picked up or returned — the service
  // has already been delivered.
  if (
    booking.operationalStatus === OP_PICKED_UP ||
    booking.operationalStatus === OP_RETURNED
  ) {
    return { status: 'error', errors: ['Cannot cancel a booking that has already been picked up'] }
  }

  // ── Refund if paid ────────────────────────────────────────────────────────
  // Rentals share a paymentRef across multiple bookings (processConfirmedRentalBooking
  // groups by paymentRef). Issue exactly one refund for the whole group.
  const isPaid = booking.status === RENTAL_COMPLETE
  const hasRealPayment = booking.paymentRef && !isDemoPayment(booking.paymentRef)

  if (isPaid && hasRealPayment) {
    try {
      await issueRefund(booking.paymentRef!)
    } catch (error) {
      console.error(`[cancelRentalBooking] Refund failed for ${bookingId}:`, error)
      return { status: 'error', errors: ['Refund failed — please contact support'] }
    }
  }

  // ── Cancel all bookings sharing the same paymentRef ───────────────────────
  // A single payment can cover multiple RentalBooking rows. Cancel them all so
  // the rental inventory is released and each row reflects the cancellation.
  if (booking.paymentRef) {
    await prisma.rentalBooking.updateMany({
      where: { paymentRef: booking.paymentRef },
      data: { status: RENTAL_CANCELED },
    })
  } else {
    // No paymentRef — unpaid or pending booking, cancel just this row
    await prisma.rentalBooking.updateMany({
      where: { id: bookingId },
      data: { status: RENTAL_CANCELED },
    })
  }

  // ── Send cancellation email (fire-and-forget) ─────────────────────────────
  try {
    const { sendRentalCancellationEmail } = await import('@repo/data/rental-emails')
    sendRentalCancellationEmail(bookingId).catch(() => {})
  } catch {}

  revalidatePath('/reservations')
  revalidatePath(`/reservations/rental/${bookingId}`)

  return { status: 'ok' }
}
