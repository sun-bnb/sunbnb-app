import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import CalendarView from './view'

export default async function CalendarPage() {

  const session = await auth()
  if (!session?.user) return null

  const sites = await prisma.site.findMany({
    where: { userId: session.user.id },
    select: {
      id: true,
      name: true,
      _count: { select: { inventoryItems: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const sitesData = sites.map(s => ({
    id: s.id,
    name: s.name,
    itemCount: s._count.inventoryItems,
  }))

  return <CalendarView sites={sitesData} />
}
