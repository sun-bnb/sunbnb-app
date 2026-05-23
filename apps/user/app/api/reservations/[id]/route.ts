/**
 * GET /api/reservations/[id]
 *
 * Fetches a reservation and — if it's still processing — verifies the
 * payment status and triggers idempotent invoice creation.
 *
 * Security:
 * - Authenticates via session or anonId query param
 * - Verifies the requesting user owns the reservation
 *
 * Used by:
 * - RTK Query polling on the payment-complete page
 * - Webhook (Mollie) as primary confirmation, this as fallback
 * - Direct lookup for reservation details
 */

import prisma from '@repo/data/PrismaCient'
import { processConfirmedReservation } from '@repo/data/payment'
import { NextRequest } from 'next/server'
import { getRequestIdentity, verifyOwnership } from '@/app/api/_lib/auth'
import { isDemoPayment, isValidEntityId } from '@/app/api/_lib/payment-ids'
import { getPaymentStatus, isPaymentSucceeded, isPaymentFailed } from '@/app/api/_lib/payment-provider'
import { RESERVATION_PROCESSING, RESERVATION_PAYMENT_FAILED } from '@repo/data/reservation-status'

// ─── Route Handler ──────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params
  if (!isValidEntityId(id)) {
    return Response.json({ error: 'Invalid ID format' }, { status: 400 })
  }

  // Authenticate: session user or anonymous user (anonId in query param)
  const identity = await getRequestIdentity(request)
  if (!identity) {
    return Response.json(
      { status: 'error', errors: ['Authentication required'] },
      { status: 401 }
    )
  }

  let reservation = await prisma.reservation.findUnique({
    where: { id },
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

  // ── Handle 'processing' state: verify with the provider and process ──────────────

  if (reservation.status === RESERVATION_PROCESSING && reservation.paymentRef) {
    try {
      if (isDemoPayment(reservation.paymentRef)) {
        // Demo mode: process immediately without provider verification
        await processConfirmedReservation(reservation.id)
      } else {
        // Real payment: verify with the payment provider (Mollie)
        const paymentStatus = await getPaymentStatus(reservation.paymentRef)

        if (isPaymentSucceeded(paymentStatus)) {
          await processConfirmedReservation(reservation.id)
        } else if (isPaymentFailed(paymentStatus)) {
          // Payment failed, canceled, or expired
          await prisma.reservation.update({
            where: { id: reservation.id },
            data: { status: RESERVATION_PAYMENT_FAILED },
          })
        }
        // else: still processing (Mollie 'open'/'pending') — wait
      }

      // Re-fetch to return current state
      reservation = await prisma.reservation.findUnique({
        where: { id },
        include: { items: true, site: true },
      })
    } catch (error) {
      console.error('[Reservation] Payment verification error:', error)
      // Return current state — webhook or next poll will retry
    }
  }

  return Response.json(reservation)
}