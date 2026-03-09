import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import OrdersView from './view'


export default async function OrdersPage({ params }: { params: { id: string } }) {

  const session = await auth()
  if (!session?.user) return null

  const site = await prisma.site.findUnique({
    where: { id: params.id }
  })

  if (!site) return <div>Site {params.id} not found</div>
  if (site.userId !== session.user.id) return <div>Not authorized</div>

  // Fetch incoming + active + ready orders for initial render
  const orders = await prisma.order.findMany({ 
    where: { 
      siteId: site.id,
      status: { in: ['paid', 'complete', 'accepted', 'preparing', 'ready', 'delivered'] }
    },
    include: {
      seat: true,
      orderItems: true
    },
    orderBy: { createdAt: 'asc' }
  })
  
  return (
    <div className="w-screen max-w-[768px]">
      <OrdersView siteId={site.id} orders={orders} />
    </div>
  )

}