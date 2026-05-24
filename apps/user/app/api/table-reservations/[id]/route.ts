/**
 * GET /api/table-reservations/[id]
 *
 * Poll-fallback route for the table-reservation deposit flow. The detail page
 * polls this after Mollie returns (or after demo payment) to confirm the
 * booking has moved from PENDING_PAYMENT → CONFIRMED.
 *
 * Mirror of GET /api/reservations/[id] — same ownership + payment-provider
 * pattern, but for table reservations (deposit flow).
 *
 * Security:
 * - Authenticates via session or anonId query param
 * - Verifies the requesting user owns the reservation
 *
 * Used by:
 * - TableReservationView polling while status === PENDING_PAYMENT
 * - Mollie webhook is the primary confirm path; this is the safety net
 */

import prisma from '@repo/data/PrismaCient'
import { NextRequest } from 'next/server'
import { getRequestIdentity } from '@/app/api/_lib/auth'
import { isDemoPayment, isValidEntityId } from '@/app/api/_lib/payment-ids'
import {
  getPaymentStatus,
  isPaymentSucceeded,
  isPaymentFailed,
} from '@/app/api/_lib/payment-provider'
import {
  markDepositHeld,
  TABLE_RESERVATION_STATUS,
  DEPOSIT_STATUS,
} from '@repo/table-reservations-core'
import { isFlagEnabled } from '@/app/flags'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await isFlagEnabled('restaurants'))) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const { id } = params
  if (!isValidEntityId(id)) {
    return Response.json({ error: 'Invalid ID format' }, { status: 400 })
  }

  // Authenticate: session user or anonymous user (anonId in query param)
  const identity = await getRequestIdentity(request)
  if (!identity) {
    return Response.json(
      { status: 'error', errors: ['Authentication required'] },
      { status: 401 },
    )
  }

  let tr = await prisma.tableReservation.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      anonId: true,
      status: true,
      depositStatus: true,
      paymentRef: true,
      from: true,
      to: true,
      partySize: true,
      specialRequests: true,
      depositAmount: true,
      restaurantId: true,
    },
  })

  if (!tr) {
    return Response.json(
      { status: 'error', errors: ['Reservation not found'] },
      { status: 404 },
    )
  }

  // Verify ownership — session userId or matching anonId
  const isOwner =
    (identity.userId && tr.userId && identity.userId === tr.userId) ||
    (identity.anonId && tr.anonId && identity.anonId === tr.anonId)

  if (!isOwner) {
    return Response.json(
      { status: 'error', errors: ['Not authorized'] },
      { status: 403 },
    )
  }

  // ── Handle PENDING_PAYMENT state: verify and process if paid ──────────────
  if (
    tr.status === TABLE_RESERVATION_STATUS.PENDING_PAYMENT &&
    tr.depositStatus === DEPOSIT_STATUS.PENDING &&
    tr.paymentRef
  ) {
    try {
      if (isDemoPayment(tr.paymentRef)) {
        // Demo refs always succeed — mark held immediately
        await markDepositHeld(tr.id, tr.paymentRef)
      } else {
        // Real payment: verify with the provider (Mollie)
        const paymentStatus = await getPaymentStatus(tr.paymentRef)

        if (isPaymentSucceeded(paymentStatus)) {
          await markDepositHeld(tr.id, tr.paymentRef)
        } else if (isPaymentFailed(paymentStatus)) {
          // Payment failed — leave in PENDING_PAYMENT; no transition here
          // (a failed deposit leaves the booking as an unconfirmed hold to be
          // cleaned up). Return current state so the UI can show an error.
        }
        // else: still in-flight (Mollie 'open'/'pending') — return current state
      }

      // Re-fetch to return the latest state
      tr = await prisma.tableReservation.findUnique({
        where: { id },
        select: {
          id: true,
          userId: true,
          anonId: true,
          status: true,
          depositStatus: true,
          paymentRef: true,
          from: true,
          to: true,
          partySize: true,
          specialRequests: true,
          depositAmount: true,
          restaurantId: true,
        },
      })
    } catch (error) {
      console.error('[TableReservation] Payment verification error:', error)
      // Return current state — webhook or next poll will retry
    }
  }

  return Response.json(tr)
}
