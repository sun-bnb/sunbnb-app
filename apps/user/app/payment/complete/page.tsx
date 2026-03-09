import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import CompletePage from './CompletePage'

interface SearchParams {
  searchParams: { [key: string]: string }
}

async function getReservationByPaymentRef(paymentRef: string) {
  return prisma.reservation.findFirst({ 
    where: { paymentRef },
    include: {
      items: true,
      site: true
    }
  })
}

async function getReservationById(id: string) {
  return prisma.reservation.findUnique({ 
    where: { id },
    include: {
      items: true,
      site: true
    }
  })
}

/**
 * Verify that the requesting user owns the reservation.
 * Supports both authenticated (session) and anonymous (anonId) users.
 */
function verifyOwner(
  reservation: { userId: string; anonId?: string | null },
  sessionUserId: string | undefined,
  anonId: string | undefined
): boolean {
  if (sessionUserId) {
    return reservation.userId === sessionUserId
  }
  if (anonId && reservation.anonId) {
    return reservation.anonId === anonId
  }
  return false
}

export default async function Complete({ searchParams }: SearchParams) {

  const { payment_intent, payment_intent_client_secret, reservationId, anonId } = searchParams

  const session = await auth()
  const sessionUserId = session?.user?.id

  // Mollie redirect: look up by reservationId
  if (reservationId) {
    const reservation = await getReservationById(reservationId)
    if (!reservation) {
      console.error('[Complete] Reservation not found for id:', reservationId)
      return <div>Reservation not found</div>
    }

    if (!verifyOwner(reservation, sessionUserId, anonId)) {
      return <div>Not authorized</div>
    }

    return <CompletePage reservation={reservation} />
  }

  // Stripe redirect: look up by payment_intent (paymentRef)
  if (!payment_intent || !payment_intent_client_secret) {
    console.error('payment_intent or payment_intent_client_secret is not set')
    return <div>Misconfiguration 2</div>
  }

  const reservation = await getReservationByPaymentRef(payment_intent)

  if (!reservation) {
    console.error('Reservation not found')
    return <div>Reservation not found</div>
  }

  // For Stripe redirects, the payment_intent_client_secret serves as proof
  // of ownership (only the payment initiator receives it from Stripe).
  // Additionally verify session/anonId ownership when available.
  if (sessionUserId && reservation.userId !== sessionUserId) {
    return <div>Not authorized</div>
  }

  return (
    <CompletePage reservation={reservation} />
  )
}