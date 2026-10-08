/**
 * GET /api/payment/viva/return
 *
 * Viva Smart Checkout success/fail redirect (track 028, P4b). The URL is configured per payment
 * SOURCE in the Viva dashboard (not per order) and arrives as
 * `?t=<transactionId>&s=<orderCode>&lang=&eventId=&eci=`. Everything here is attacker-controllable,
 * so the query only SELECTS the entity; state changes require a re-fetched, order-matching paid
 * transaction (best effort — the poll/webhook is the safety net). Then 302 to the kind's existing
 * return page (the same URLs each create path passes as its redirectUrl).
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@repo/data/PrismaCient'
import { vivaCheckoutRefFromOrder } from '@repo/data/payment-refs'
import { getVivaCheckoutClient } from '@repo/data/viva'
import { findPaymentEntity, onPaymentState, type PaymentMeta } from '@/app/api/_lib/payment-events'

const ORDER_CODE = /^\d{10,20}$/
const TRANSACTION_ID = /^[A-Za-z0-9_-]{1,64}$/

function redirectTo(request: NextRequest, path: string) {
  const base = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || request.url
  return NextResponse.redirect(new URL(path, base), 302)
}

function withQuery(path: string, params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v)
  const qs = q.toString()
  return qs ? `${path}?${qs}` : path
}

async function returnPath(meta: PaymentMeta): Promise<string> {
  switch (meta.type) {
    case 'reservation': {
      const r = await prisma.reservation.findUnique({ where: { id: meta.entityId }, select: { anonId: true } })
      return withQuery('/payment/complete', { reservationId: meta.entityId, anonId: r?.anonId })
    }
    case 'rental-booking': {
      const b = await prisma.rentalBooking.findUnique({ where: { id: meta.entityId }, select: { anonId: true } })
      return withQuery('/payment/complete/rental', { rentalBookingId: meta.entityId, anonId: b?.anonId })
    }
    case 'order': {
      // OrderPayment: `${completeUrl || '/payment/complete'}` + `orderId=`; Menu.tsx passes /reservations/<id>[?anonId].
      const o = await prisma.order.findUnique({ where: { id: meta.entityId }, select: { reservationId: true, anonId: true } })
      if (o?.reservationId) {
        return withQuery(`/reservations/${o.reservationId}`, { anonId: o.anonId, orderId: meta.entityId })
      }
      return withQuery('/payment/complete', { orderId: meta.entityId })
    }
    case 'tab': {
      const t = await prisma.tableTab.findUnique({ where: { id: meta.entityId }, select: { tableId: true } })
      return t ? withQuery(`/tables/${t.tableId}`, { tabReturn: meta.entityId }) : '/'
    }
    case 'table-deposit':
      return `/table-reservations/${meta.entityId}`
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const s = params.get('s')
  const t = params.get('t')
  if (!s || !ORDER_CODE.test(s) || (t !== null && !TRANSACTION_ID.test(t))) {
    return redirectTo(request, '/?payment=unknown')
  }

  const ref = vivaCheckoutRefFromOrder(s)
  const meta = await findPaymentEntity(ref)
  if (!meta) return redirectTo(request, '/?payment=unknown')

  if (t) {
    try {
      const tx = await getVivaCheckoutClient().getTransaction(t)
      if (tx.orderCode === s && tx.state === 'paid') {
        await onPaymentState(meta, ref, 'paid')
      }
    } catch (err) {
      // Best effort: the status poll / webhook will catch up.
      console.error('[Viva Return] confirm failed', err instanceof Error ? err.message : 'unknown')
    }
  }

  return redirectTo(request, await returnPath(meta))
}
