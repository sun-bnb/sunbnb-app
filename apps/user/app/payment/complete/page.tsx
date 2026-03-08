import prisma from '@repo/data/PrismaCient'
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

export default async function Complete({ searchParams }: SearchParams) {

  const { payment_intent, payment_intent_client_secret, reservationId } = searchParams

  // Mollie redirect: look up by reservationId
  if (reservationId) {
    const reservation = await getReservationById(reservationId)
    if (!reservation) {
      console.error('[Complete] Reservation not found for id:', reservationId)
      return <div>Reservation not found</div>
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

  return (
    <CompletePage reservation={reservation} />
  )
}