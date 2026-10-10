import { redirect } from 'next/navigation'
import prisma from '@repo/data/PrismaCient'

// Restaurant management moved to the top-level /restaurants section. This stub
// forwards any bookmarked /sites/[id]/restaurant URL to the linked restaurant.
export default async function LegacyRestaurantRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const site = await prisma.site.findUnique({
    where: { id },
    select: { restaurantId: true },
  })
  redirect(site?.restaurantId ? `/restaurants/${site.restaurantId}` : '/restaurants')
}
