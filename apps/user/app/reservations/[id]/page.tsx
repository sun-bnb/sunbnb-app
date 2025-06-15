import logger from '@/utils/logger'

import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import ReservationView from './view'
import { Order } from '@/app/types/types'

const { STRIPE_PUBLIC_KEY } = process.env

async function getReservation(id: string) {
  return await prisma.reservation.findUnique({ 
    where: { id: id },
    include: {
      items: true,
      site: true,
      orders: {
        include: {
          orderItems: true,
          invoice: {
            include: {
              invoiceLines: true
            }
          }
        }
      }
    }
  })
}

async function getOrder(paymentRef: string) {
  return await prisma.order.findFirst({ 
    where: { paymentRef: paymentRef },
    include: {
      orderItems: true
    }
  })
}

async function getServiceFee(siteId: string, userId: string): Promise<{
  chargeType: string
  feeAmount?: number | null
  percentage?: number | null
} | undefined> {

  let [site, partnerAccount, settings] = await Promise.all([
    prisma.site.findUnique({
      where: { id: siteId },
      include: { serviceFees: true },
    }),
    prisma.partnerAccount.findUnique({
      where: { userId: userId },
      include: { serviceFees: true },
    }),
    prisma.settings.findFirst({
      include: { serviceFees: true },
    })
  ])

  const serviceCode = 'food-and-beverage'
  const matchedServiceFee = (
    site?.serviceFees?.find((fee: any) => fee.serviceCode === serviceCode) ||
    partnerAccount?.serviceFees?.find((fee: any) => fee.serviceCode === serviceCode) ||
    settings?.serviceFees?.find((fee: any) => fee.serviceCode === serviceCode)
  )

  return matchedServiceFee

}

export default async function ReservationPage({ params, searchParams }: { params: { id: string }, searchParams: { [key: string]: string } }) {

  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string
  
  const session = await auth()
  const signedIn = !!(session?.user)
  //if (!session?.user) return null

  const reservation = await getReservation(params.id)

  if (!reservation) return <div>Reservation {params.id} not found</div>

  const { payment_intent, payment_intent_client_secret, redirect_status } = searchParams

  let order: Order | null = null
  if (redirect_status === 'succeeded' && payment_intent) {
    order = await getOrder(payment_intent)
  }

  const serviceFee = reservation.site.appSalesEnabled ?
    await getServiceFee(reservation.site.id, reservation.site.userId) : undefined

  return <ReservationView signedIn={signedIn} serviceFee={serviceFee} reservation={reservation} apiKey={apiKey} stripePublicKey={STRIPE_PUBLIC_KEY} order={order} />

}