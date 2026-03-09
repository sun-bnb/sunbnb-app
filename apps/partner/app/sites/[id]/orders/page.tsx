import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import { SiteProps } from '@/types/shared'
import OrdersView from './view'


export default async function OrdersPage({ params }: { params: { id: string } }) {

  const session = await auth()
  if (!session?.user) return null

  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string

  const site = await prisma.site.findUnique({
    where: { id: params.id }
  })

  if (!site) return <div>Site {params.id} not found</div>
  if (site.userId !== session.user.id) return <div>Not authorized</div>

  const orders = await prisma.order.findMany({ 
    where: { 
      siteId: site.id,
      status: { in: [ 'paid' ] }
    },
    include: {
      seat: true,
      orderItems: true
    }
  })
  
  if (!site) return <div>Site {params.id} not found</div>
  
  return (
    <div className="w-screen max-w-[768px]">
      <OrdersView siteId={site.id} orders={orders} />
    </div>
  )

}