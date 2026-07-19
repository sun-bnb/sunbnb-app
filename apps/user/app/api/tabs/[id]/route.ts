/**
 * GET /api/tabs/[id]
 *
 * Poll-fallback route for dine-in tab payment status. If the Mollie webhook
 * was missed, the UI can poll this route to detect a payment landing.
 *
 * Security model: NO ownership check by design. This follows the
 * QR-URL-as-credential model — possessing the tab CUID is the credential,
 * exactly as getTabState and placeTabOrder. See actions.ts for full rationale.
 *
 * Returns a minimal DTO: { id, status, closedAt }
 * The dine page uses getTabState (server action) for the full open-tab view;
 * this route only answers "did my payment land".
 *
 * Used by:
 * - Poll loop on the dine-in tab payment-complete screen
 * - Webhook (Mollie) as primary confirmation, this as fallback
 */

import prisma from '@repo/data/PrismaCient'
import { processConfirmedTabPayment } from '@repo/data/payment'
import { NextRequest } from 'next/server'
import { isValidEntityId } from '@/app/api/_lib/payment-ids'
import { getPaymentStatus, isPaymentSucceeded, isPaymentFailed } from '@/app/api/_lib/payment-provider'
import { TAB_PENDING_PAYMENT } from '@repo/data/reservation-status'

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id } = params

  if (!isValidEntityId(id)) {
    return Response.json({ error: 'Invalid ID format' }, { status: 400 })
  }

  let tab = await prisma.tableTab.findUnique({
    where: { id },
    select: { id: true, status: true, paymentRef: true, closedAt: true },
  })

  if (!tab) {
    return Response.json({ error: 'Tab not found' }, { status: 404 })
  }

  // ── Payment poll-fallback: re-verify if still pending ────────────────────
  if (tab.status === TAB_PENDING_PAYMENT && tab.paymentRef) {
    try {
      const paymentStatus = await getPaymentStatus(tab.paymentRef)

      if (isPaymentSucceeded(paymentStatus)) {
        // Payment landed but webhook was missed — process now (idempotent)
        await processConfirmedTabPayment(tab.id)
      } else if (isPaymentFailed(paymentStatus)) {
        // Payment failed/canceled/expired — revert the claim so the party can retry.
        // Guard on TAB_PENDING_PAYMENT so a stale failure event can never reopen
        // a tab already transitioned to TAB_PAID by a concurrent webhook delivery.
        await prisma.tableTab.updateMany({
          where: { id: tab.id, status: TAB_PENDING_PAYMENT },
          data: { status: 'open', paymentRef: null },
        })
      }
      // else: still in-flight (Mollie 'open'/'pending') — wait, return current state

      // Re-read to return current state
      tab = await prisma.tableTab.findUnique({
        where: { id },
        select: { id: true, status: true, paymentRef: true, closedAt: true },
      })
    } catch (error) {
      // Transient provider error — return current state rather than 500.
      // The UI will retry on the next poll interval.
      console.error('[TabPoll] Payment verification error:', error)
    }
  }

  if (!tab) {
    return Response.json({ error: 'Tab not found' }, { status: 404 })
  }

  // Return minimal DTO — avoid dumping orders/attribution (getTabState has that)
  return Response.json({
    id: tab.id,
    status: tab.status,
    closedAt: tab.closedAt,
  })
}
