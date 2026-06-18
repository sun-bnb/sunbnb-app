import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import CompletePage from './CompletePage'
import ErrorCard from '@/components/ErrorCard'

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
      return <ErrorCard title="Reservation not found" message="We couldn't locate your reservation. If you completed a payment, please check your reservations page." showHomeLink />
    }

    if (!verifyOwner(reservation, sessionUserId, anonId)) {
      return <ErrorCard title="Not authorized" message="You don't have permission to view this reservation." showHomeLink />
    }

    return <CompletePage reservation={reservation} anonId={anonId} />
  }

  // Demo redirect: completes via the payment_intent (paymentRef) query shape —
  // the demo checkout mirrors the legacy Stripe redirect contract. (Consumer
  // Stripe was removed; see .claude/tracks/003-stripe-connect-compliance.md.)
  if (!payment_intent || !payment_intent_client_secret) {
    console.error('payment_intent or payment_intent_client_secret is not set')
    return <ErrorCard title="Something went wrong" message="Payment details are missing. Please return to your reservation and try again." showHomeLink />
  }

  const reservation = await getReservationByPaymentRef(payment_intent)

  if (!reservation) {
    console.error('Reservation not found')
    return <ErrorCard title="Reservation not found" message="We couldn't locate your reservation. If you completed a payment, please check your reservations page." showHomeLink />
  }

  // Verify session ownership when signed in. (Anonymous demo completions are
  // matched by the paymentRef carried in the redirect URL — no extra check here.)
  if (sessionUserId && reservation.userId !== sessionUserId) {
    return <ErrorCard title="Not authorized" message="You don't have permission to view this reservation." showHomeLink />
  }

  return (
    <CompletePage reservation={reservation} />
  )
}