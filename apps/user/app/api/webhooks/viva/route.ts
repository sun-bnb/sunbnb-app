/**
 * /api/webhooks/viva (track 028, P4b) — Viva Smart Checkout event webhook.
 *
 * GET  -> URL-verification handshake: `{ Key: VIVA_WEBHOOK_VERIFICATION_KEY }` (503 when unset).
 * POST -> UNSIGNED. The body is never trusted: it only names a transaction. We ALWAYS re-fetch the
 *         transaction from Viva, require its orderCode to match the event's, and act on the
 *         RE-FETCHED state. Never log the body.
 */
import { NextRequest, NextResponse } from 'next/server'
import { vivaCheckoutRefFromOrder } from '@repo/data/payment-refs'
import { getVivaCheckoutClient } from '@repo/data/viva'
import { findPaymentEntity, onPaymentState } from '@/app/api/_lib/payment-events'

const TRANSACTION_ID = /^[A-Za-z0-9_-]{1,64}$/
const ORDER_CODE = /^\d{10,20}$/

/** 1796 Transaction Payment Created, 1798 Transaction Failed, 1797 Transaction Reversal Created. */
const HANDLED_EVENTS = new Set([1796, 1797, 1798])

export async function GET() {
  const key = process.env.VIVA_WEBHOOK_VERIFICATION_KEY
  if (!key) return NextResponse.json({ error: 'Viva webhook not configured' }, { status: 503 })
  return NextResponse.json({ Key: key })
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const b = body as { EventTypeId?: unknown; EventData?: { TransactionId?: unknown; OrderCode?: unknown } } | null
  const eventType = b?.EventTypeId
  if (typeof eventType !== 'number') return NextResponse.json({ error: 'Malformed event' }, { status: 400 })
  if (!HANDLED_EVENTS.has(eventType)) return NextResponse.json({ received: true })

  const transactionId = b?.EventData?.TransactionId
  const rawOrderCode = b?.EventData?.OrderCode
  if (typeof transactionId !== 'string' || !TRANSACTION_ID.test(transactionId)) {
    return NextResponse.json({ error: 'Malformed event' }, { status: 400 })
  }
  if (
    (typeof rawOrderCode !== 'number' && typeof rawOrderCode !== 'string') ||
    !ORDER_CODE.test(String(rawOrderCode))
  ) {
    return NextResponse.json({ error: 'Malformed event' }, { status: 400 })
  }
  const orderCode = String(rawOrderCode)

  try {
    const tx = await getVivaCheckoutClient().getTransaction(transactionId)
    if (tx.orderCode !== orderCode) return NextResponse.json({ received: true })
    if (tx.state !== 'paid' && tx.state !== 'failed' && tx.state !== 'refunded') {
      return NextResponse.json({ received: true })
    }

    const ref = vivaCheckoutRefFromOrder(orderCode)
    const meta = await findPaymentEntity(ref)
    if (!meta) return NextResponse.json({ received: true })

    await onPaymentState(meta, ref, tx.state)
    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[Viva Webhook] handler error', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Handler error' }, { status: 500 })
  }
}
