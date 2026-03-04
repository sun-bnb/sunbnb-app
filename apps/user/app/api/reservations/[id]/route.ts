/**
 * GET /api/reservations/[id]
 *
 * Fetches a reservation and — if it's still processing — verifies the
 * Stripe PaymentIntent status and triggers idempotent invoice creation.
 *
 * Security:
 * - Authenticates via session or anonId query param
 * - Verifies the requesting user owns the reservation
 *
 * Used by:
 * - RTK Query polling on the payment-complete page
 * - Stripe webhook as a secondary confirmation path
 * - Direct lookup for reservation details
 */

import prisma from '@repo/data/PrismaCient'
import { processConfirmedReservation } from '@repo/data/payment'
import { NextRequest } from 'next/server'
import { getRequestIdentity, verifyOwnership } from '@/app/api/_lib/auth'
import { getStripePaymentStatus, isDemoPayment } from '@/app/api/_lib/stripe'

// ─── Route Handler ──────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Authenticate: session user or anonymous user (anonId in query param)
  const identity = await getRequestIdentity(request)
  if (!identity) {
    return Response.json(
      { status: 'error', errors: ['Authentication required'] },
      { status: 401 }
    )
  }

  let reservation = await prisma.reservation.findUnique({
    where: { id: params.id },
    include: { items: true, site: true },
  })

  if (!reservation) {
    return Response.json(
      { status: 'error', errors: ['Reservation not found'] },
      { status: 404 }
    )
  }

  // Verify ownership
  if (!verifyOwnership(identity, reservation)) {
    return Response.json(
      { status: 'error', errors: ['Not authorized'] },
      { status: 403 }
    )
  }

  // ── Handle 'processing' state: verify Stripe and process ──────────────

  if (reservation.status === 'processing' && reservation.paymentRef) {
    try {
      if (isDemoPayment(reservation.paymentRef)) {
        // Demo mode: process immediately without Stripe verification
        await processConfirmedReservation(reservation.id)
      } else {
        // Real payment: verify with Stripe
        const paymentStatus = await getStripePaymentStatus(reservation.paymentRef)

        if (paymentStatus === 'succeeded') {
          await processConfirmedReservation(reservation.id)
        } else if (paymentStatus !== 'processing') {
          // Payment failed or was canceled
          await prisma.reservation.update({
            where: { id: reservation.id },
            data: { status: 'payment_failed' },
          })
        }
      }

      // Re-fetch to return current state
      reservation = await prisma.reservation.findUnique({
        where: { id: params.id },
        include: { items: true, site: true },
      })
    } catch (error) {
      console.error('[Reservation] Payment verification error:', error)
      // Return current state — webhook or next poll will retry
    }
  }

  // ── Handle 'paid' state without invoice (recovery from partial processing)

  if (
    reservation &&
    reservation.status === 'paid' &&
    !reservation.invoiceId
  ) {
    try {
      await processConfirmedReservation(reservation.id)
      reservation = await prisma.reservation.findUnique({
        where: { id: params.id },
        include: { items: true, site: true },
      })
    } catch (error) {
      console.error('[Reservation] Invoice creation recovery error:', error)
    }
  }

  return Response.json(reservation)
}