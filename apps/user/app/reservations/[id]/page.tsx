import prisma from '@repo/data/PrismaCient'
import { resolveSiteFees } from '@repo/data/payment'
import { reservationListPrice } from '@repo/data/reservation-price'
import { RESERVATION_COMPLETE } from '@repo/data/reservation-status'
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

export default async function ReservationPage({ params, searchParams }: { params: Promise<{ id: string }>, searchParams: Promise<{ [key: string]: string }> }) {

  const { id } = await params

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY
    || process.env.GOOGLE_MAPS_API_KEY as string

  const { payment_intent, payment_intent_client_secret, redirect_status, anonId, terms, orderId } = await searchParams
  
  const session = await auth()
  const signedIn = !!(session?.user)
  //if (!session?.user) return null

  const reservation = await getReservation(id)

  if (!reservation) return <div className="h-screen flex items-center justify-center">Reservation {id} not found</div>

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
    // Demo redirect: look up order by paymentRef (payment_intent query shape)
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

  // An off-platform-billing (unpaid) site completes bookings without charging,
  // so paymentAmount is 0 — state what the guest pays at the venue instead.
  // Same formula the booking action charges with (reservationListPrice).
  const amountDue = !reservation.paymentAmount && reservation.site.type === 'unpaid'
    ? reservationListPrice({
        sitePrice: reservation.site.price,
        itemPrices: reservation.items.map(i => i.price),
        from: reservation.from,
        to: reservation.to,
      }) || null
    : null

  // Where the confirmation went: sendConfirmationEmail fires once a booking is
  // COMPLETE (after payment, or at creation for an unpaid site) to the guest
  // email for an anonymous booking, the account email otherwise. QR/POS
  // walk-ins give no email, so there is nothing to claim.
  const confirmationEmail = reservation.status === RESERVATION_COMPLETE
    ? (reservation.anonId ? reservation.guestEmail : session?.user?.email) ?? null
    : null

  return <ReservationView signedIn={signedIn} showTerms={terms === 'true'} serviceFee={serviceFee} siteType={siteType} orderPaymentType={orderPaymentType} paymentProvider={reservation.site.paymentProvider} reservation={reservation} apiKey={apiKey} order={order} amountDue={amountDue} confirmationEmail={confirmationEmail} />

}