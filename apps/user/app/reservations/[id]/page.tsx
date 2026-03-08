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
      include: {
        serviceFees: true,
        subscription: { include: { plan: { select: { tier: true } } } },
      },
    }),
    prisma.settings.findFirst({
      include: {
        serviceFees: { where: { siteId: null, accountId: null } },
      },
    })
  ])

  const serviceCode = 'food-and-beverage'
  const tier = partnerAccount?.subscription?.plan?.tier ?? null

  // 1. Site-level override
  const siteFee = site?.serviceFees?.find((fee: any) => fee.serviceCode === serviceCode)
  if (siteFee) return siteFee

  // 2. Account-level override
  const accountFee = partnerAccount?.serviceFees?.find((fee: any) => fee.serviceCode === serviceCode)
  if (accountFee) return accountFee

  // 3. Platform-level: prefer tier-specific, fall back to default (null tier)
  const platformFees = settings?.serviceFees ?? []
  if (tier) {
    const tierFee = platformFees.find((f: any) => f.serviceCode === serviceCode && f.subscriptionTier === tier)
    if (tierFee) return tierFee
  }
  return platformFees.find((f: any) => f.serviceCode === serviceCode && f.subscriptionTier === null)

}

export default async function ReservationPage({ params, searchParams }: { params: { id: string }, searchParams: { [key: string]: string } }) {

  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string

  const { payment_intent, payment_intent_client_secret, redirect_status, anonId, terms } = searchParams
  
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
    order = await getOrder(payment_intent)
  }

  // Only enable food & drinks if appSalesEnabled AND the site has active products
  let serviceFee: Awaited<ReturnType<typeof getServiceFee>> | undefined
  if (reservation.site.appSalesEnabled) {
    const productCount = await prisma.product.count({
      where: { siteId: reservation.site.id, active: true },
    })
    if (productCount > 0) {
      serviceFee = await getServiceFee(reservation.site.id, reservation.site.userId)
    }
  }

  const siteType = reservation.site.type ?? 'paid'
  const orderPaymentType = (reservation.site as any).orderPaymentType ?? siteType

  return <ReservationView signedIn={signedIn} showTerms={terms === 'true'} serviceFee={serviceFee} siteType={siteType} orderPaymentType={orderPaymentType} paymentProvider={reservation.site.paymentProvider} reservation={reservation} apiKey={apiKey} stripePublicKey={STRIPE_PUBLIC_KEY} order={order} />

}