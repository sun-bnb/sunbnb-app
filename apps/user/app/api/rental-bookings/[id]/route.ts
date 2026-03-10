/**
 * GET /api/rental-bookings/[id]
 *
 * Fetches a rental booking and — if it's still processing — verifies the
 * payment status and triggers idempotent confirmation processing.
 *
 * Used by RTK Query polling on the payment-complete page (rental bookings).
 */

import prisma from '@repo/data/PrismaCient'
import { processConfirmedRentalBooking } from '@repo/data/payment'
import { NextRequest } from 'next/server'
import { getRequestIdentity } from '@/app/api/_lib/auth'
import { isDemoPayment } from '@/app/api/_lib/stripe'
import { getPaymentStatus, isPaymentSucceeded, isPaymentFailed } from '@/app/api/_lib/payment-provider'
import { RENTAL_PROCESSING, RENTAL_PAYMENT_FAILED } from '@repo/data/reservation-status'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const identity = await getRequestIdentity(request)
  if (!identity) {
    return Response.json(
      { status: 'error', errors: ['Authentication required'] },
      { status: 401 }
    )
  }

  let booking = await prisma.rentalBooking.findUnique({
    where: { id: params.id },
    include: { rentalItem: true, site: true },
  })

  if (!booking) {
    return Response.json(
      { status: 'error', errors: ['Booking not found'] },
      { status: 404 }
    )
  }

  // Verify ownership
  if (identity.userId && booking.userId !== identity.userId) {
    return Response.json(
      { status: 'error', errors: ['Not authorized'] },
      { status: 403 }
    )
  }

  // ── Handle 'processing' state: verify payment and process ─────────────

  if (booking.status === RENTAL_PROCESSING && booking.paymentRef) {
    try {
      if (isDemoPayment(booking.paymentRef)) {
        await processConfirmedRentalBooking(booking.paymentRef)
      } else {
        const paymentStatus = await getPaymentStatus(booking.paymentRef)

        if (isPaymentSucceeded(paymentStatus)) {
          await processConfirmedRentalBooking(booking.paymentRef)
        } else if (isPaymentFailed(paymentStatus)) {
          await prisma.rentalBooking.updateMany({
            where: { paymentRef: booking.paymentRef },
            data: { status: RENTAL_PAYMENT_FAILED },
          })
        }
      }

      // Re-fetch
      booking = await prisma.rentalBooking.findUnique({
        where: { id: params.id },
        include: { rentalItem: true, site: true },
      })
    } catch (error) {
      console.error('[RentalBooking] Payment verification error:', error)
    }
  }

  return Response.json(booking)
}
