import prisma from '@repo/data/PrismaCient'
import { resolveSiteFees } from '@repo/data/payment'
import { auth } from '@/app/auth'
import ReservationView from './view'
import { Order } from '@/app/types/types'

async function getReservation(id: string) {
  return await prisma.reservation.findUnique({ 
    where: { id: id },
    include: {
      items: true,
      site: true,
      orders: {
        include: {
          orderItems: true,
          invoices: {
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

async function getServiceFee(siteId: string): Promise<{
  chargeType: string
  feeAmount?: number | null
  percentage?: number | null
} | undefined> {
  const [fee] = await resolveSiteFees(siteId, ['food-and-beverage'])
  return fee
}

export default async function ReservationPage({ params, searchParams }: { params: { id: string }, searchParams: { [key: string]: string } }) {

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY
    || process.env.GOOGLE_MAPS_API_KEY as string

  const { payment_intent, payment_intent_client_secret, redirect_status, anonId, terms, orderId } = searchParams
  
  const session = await auth()
  const signedIn = !!(session?.user)
  //if (!session?.user) return null

  const reservation = await getReservation(params.id)

  if (!reservation) return <div className="h-screen flex items-center justify-center">Reservation {params.id} not found</div>

  if (signedIn) {
    if(reservation?.userId !== session?.user?.id) {
      return <div className="h-screen flex items-center justify-center">Reservation not found</div>
    }
  } else {
    if (!anonId || reservation.anonId !== anonId) {
      return <div className="h-screen flex items-center justify-center">No reservation found</div>
    }
  }

  let order: Order | null = null
  if (redirect_status === 'succeeded' && payment_intent) {
    // Stripe redirect: look up order by paymentRef
    order = await getOrder(payment_intent)
  } else if (orderId) {
    // Mollie redirect: look up order by ID
    order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { orderItems: true },
    }) as Order | null
  }

  // Only enable food & drinks if appSalesEnabled AND the site has active products
  let serviceFee: Awaited<ReturnType<typeof getServiceFee>> | undefined
  if (reservation.site.appSalesEnabled) {
    const productCount = await prisma.product.count({
      where: { siteId: reservation.site.id, active: true },
    })
    if (productCount > 0) {
      serviceFee = await getServiceFee(reservation.site.id)
    }
  }

  const siteType = reservation.site.type ?? 'paid'
  const orderPaymentType = (reservation.site as any).orderPaymentType ?? siteType

  return <ReservationView signedIn={signedIn} showTerms={terms === 'true'} serviceFee={serviceFee} siteType={siteType} orderPaymentType={orderPaymentType} paymentProvider={reservation.site.paymentProvider} reservation={reservation} apiKey={apiKey} order={order} />

}