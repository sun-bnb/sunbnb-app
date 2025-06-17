import prisma from '@repo/data/PrismaCient'
import CompletePage from './CompletePage'

interface SearchParams {
  searchParams: { [key: string]: string }
}

async function getReservation(paymentRef: string) {

  const reservation = await prisma.reservation.findFirst({ 
    where: { paymentRef },
    include: {
      items: true,
      site: true
    }
  })
  return reservation

}

export default async function Complete({ searchParams }: SearchParams) {

  const { payment_intent, payment_intent_client_secret } = searchParams

  if (!payment_intent || !payment_intent_client_secret) {
    console.error('payment_intent or payment_intent_client_secret is not set')
    return <div>Misconfiguration 2</div>
  }

  const reservation = await getReservation(payment_intent)

  if (!reservation) {
    console.error('Reservation not found')
    return <div>Reservation not found</div>
  }

  return (
    <CompletePage reservation={reservation} />
  )
}