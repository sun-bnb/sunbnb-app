import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import OrdersView from './view'
import ErrorCard from '@/components/ErrorCard'
import {
  ORDER_COMPLETE,
  ORDER_ACCEPTED,
  ORDER_PREPARING,
  ORDER_READY,
  ORDER_DELIVERED,
} from '@repo/data/reservation-status'


export default async function OrdersPage(
  { params, searchParams }: { params: { id: string }, searchParams: { [key: string]: string } }
) {

  const { key: accessKey } = searchParams

  // Resolve the site owner via either a SecurityToken access key or the
  // signed-in session, then verify ownership.
  let ownerUserId: string | null = null

  if (accessKey) {
    const token = await prisma.securityToken.findUnique({
      where: {
        id: accessKey,
        expires: { gt: new Date() },
        resources: { has: 'all' },
      },
    })
    if (!token) {
      return <ErrorCard
        title="Invalid or expired access key"
        message="This access key is no longer valid. Please contact the site operator to get a new link."
        showBackLink={false}
      />
    }
    ownerUserId = token.userId
  } else {
    const session = await auth()
    if (!session?.user) return null
    ownerUserId = session.user.id
  }

  const site = await prisma.site.findUnique({
    where: { id: params.id }
  })

  if (!site) return <ErrorCard title="Site not found" message="This site does not exist or has been removed." showBackLink={!accessKey} />
  if (site.userId !== ownerUserId) {
    return <ErrorCard
      title="Not authorized"
      message={accessKey
        ? "This access key is not valid for this site. Please contact the site operator."
        : "You don't have access to this site."}
      showBackLink={!accessKey}
    />
  }

  // Fetch incoming + active + ready orders for initial render
  const orders = await prisma.order.findMany({
    where: {
      siteId: site.id,
      status: { in: [ORDER_COMPLETE, ORDER_ACCEPTED, ORDER_PREPARING, ORDER_READY, ORDER_DELIVERED] }
    },
    include: {
      seat: true,
      orderItems: true
    },
    orderBy: { createdAt: 'asc' }
  })

  return (
    <div className="w-screen max-w-[768px]">
      <OrdersView siteId={site.id} orders={orders} accessKey={accessKey} />
    </div>
  )

}
