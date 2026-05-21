import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import CreateRestaurantView from './view'

export default async function CreateRestaurantPage() {
  const session = await auth()
  if (!session?.user) return null

  // Sites that have no linked restaurant — available to link during creation
  const availableSites = await prisma.site.findMany({
    where: { userId: session.user.id!, restaurantId: null },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  return <CreateRestaurantView availableSites={availableSites} />
}
