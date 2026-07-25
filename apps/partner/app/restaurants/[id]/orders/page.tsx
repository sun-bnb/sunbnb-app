import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import OrdersView from '@/app/sites/[id]/orders/view'
import ErrorCard from '@/components/ErrorCard'
import {
  ORDER_COMPLETE,
  ORDER_ACCEPTED,
  ORDER_PREPARING,
  ORDER_READY,
  ORDER_DELIVERED,
} from '@repo/data/reservation-status'

// Public/token-gated, mirroring `sites/[id]/orders/page.tsx`. The
// `/restaurants` route group's layout only gates on the `restaurants`
// feature flag (no session/auth check), so a token-only (no session)
// request reaches this page unimpeded — the inline gate below is the only
// auth boundary, same as the site orders page.

export default async function RestaurantOrdersPage(
  { params, searchParams }: { params: { id: string }, searchParams: { [key: string]: string } }
) {

  const { key: accessKey } = searchParams

  // Resolve the restaurant owner via either a SecurityToken access key or the
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
        message="This access key is no longer valid. Please contact the restaurant operator to get a new link."
        showBackLink={false}
      />
    }
    ownerUserId = token.userId
  } else {
    const session = await auth()
    if (!session?.user) return null
    ownerUserId = session.user.id
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: params.id }
  })

  if (!restaurant) return <ErrorCard title="Restaurant not found" message="This restaurant does not exist or has been removed." showBackLink={!accessKey} />
  if (restaurant.partnerAccountId !== ownerUserId) {
    return <ErrorCard
      title="Not authorized"
      message={accessKey
        ? "This access key is not valid for this restaurant. Please contact the restaurant operator."
        : "You don't have access to this restaurant."}
      showBackLink={!accessKey}
    />
  }

  // Fetch incoming + active + ready orders for initial render
  const orders = await prisma.order.findMany({
    where: {
      restaurantId: restaurant.id,
      status: { in: [ORDER_COMPLETE, ORDER_ACCEPTED, ORDER_PREPARING, ORDER_READY, ORDER_DELIVERED] }
    },
    include: {
      seat: true,
      orderItems: true
    },
    orderBy: { createdAt: 'asc' }
  })

  // Build a table label map so the kitchen knows which dine-in table each round
  // belongs to. Order.tableId is a denormalized string (no FK relation), so we
  // collect unique ids and do a separate lookup to get number + label.
  const tableIds = [...new Set(
    orders.flatMap((o) => (o.tableId ? [o.tableId] : []))
  )]
  const tableRows = tableIds.length > 0
    ? await prisma.table.findMany({
        where: { id: { in: tableIds } },
        select: { id: true, number: true, label: true },
      })
    : []
  const tableMap: Record<string, { number: number; label: string | null }> = {}
  for (const row of tableRows) {
    tableMap[row.id] = { number: row.number, label: row.label }
  }

  return (
    <div className="w-screen max-w-[768px]">
      <OrdersView scope={{ kind: 'restaurant', id: restaurant.id }} orders={orders} tableMap={tableMap} accessKey={accessKey} />
    </div>
  )

}
