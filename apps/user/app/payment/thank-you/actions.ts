'use server'

import prisma from '@repo/data/PrismaCient'
import { rateLimit } from '@repo/data/rate-limit'
import { sendReceiptEmail } from '@repo/data/reservation-emails'
import { RESERVATION_COMPLETE } from '@repo/data/reservation-status'
import { isValidEntityId } from '@/app/api/_lib/payment-ids'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Self-serve receipt request from the post-payment thank-you page.
 *
 * Public + unauthenticated by design (the beachgoer paid via QR and has no
 * account), so it is deliberately narrow: it only acts on a reservation that is
 * already `complete` (paid), only sends to the address just entered, and is
 * rate-limited per reservation. It stores the address on `guestEmail` for the
 * record, then sends the PARTNER-invoice receipt.
 */
export async function requestReceipt(
  reservationId: string,
  email: string,
): Promise<{ status: 'ok' | 'error'; errors?: string[] }> {
  if (!isValidEntityId(reservationId)) {
    return { status: 'error', errors: ['Invalid reservation'] }
  }
  const trimmed = (email ?? '').trim()
  if (!EMAIL_RE.test(trimmed) || trimmed.length > 200) {
    return { status: 'error', errors: ['Enter a valid email address'] }
  }

  const rl = rateLimit(`receipt:${reservationId}`, { maxAttempts: 5, windowMs: 15 * 60 * 1000 })
  if (!rl.allowed) {
    return { status: 'error', errors: ['Too many requests — please try again later'] }
  }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { status: true },
  })
  // Default-deny: only a paid (complete) reservation has a receipt to send.
  if (!reservation || reservation.status !== RESERVATION_COMPLETE) {
    return { status: 'error', errors: ['No receipt is available for this payment yet'] }
  }

  await prisma.reservation.update({
    where: { id: reservationId },
    data: { guestEmail: trimmed },
  })

  const res = await sendReceiptEmail(reservationId, trimmed)
  if (!res.ok) {
    return { status: 'error', errors: [res.error ?? 'Could not send the receipt'] }
  }
  return { status: 'ok' }
}
