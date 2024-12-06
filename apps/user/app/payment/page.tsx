import prisma from '@repo/data/PrismaCient'
import CompletePage from './complete/CompletePage'
import { getReservationByPaymentRef } from './actions'

interface SearchParams {
  searchParams: { [key: string]: string }
}

const { STRIPE_PUBLIC_KEY } = process.env

async function getReservation(paymentRef: string) {
  const reservation = await prisma.reservation.findFirst({ 
    where: { paymentRef }
  })

  return reservation

}

export default async function PaymentPage({ searchParams }: SearchParams) {

  if (!STRIPE_PUBLIC_KEY) {
    console.error('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set')
    return null
  }

  console.log('STRIPE PUBLISHABLE KEY', STRIPE_PUBLIC_KEY)
  console.log('searchParams', searchParams)

  const { payment_intent, payment_intent_client_secret } = searchParams


  if (!payment_intent || !payment_intent_client_secret) {
    console.error('payment_intent or payment_intent_client_secret is not set')
    return null
  }

  const reservation = await getReservation(payment_intent)

  if (!reservation) {
    console.error('Reservation not found')
    return null
  }

  return (
    <CompletePage stripePublicKey={STRIPE_PUBLIC_KEY} stripeClientSecret={payment_intent_client_secret} reservation={reservation} />
  )
}