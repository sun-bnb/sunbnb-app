import { notFound } from 'next/navigation'
import prisma from '@repo/data/PrismaCient'
import { isFlagEnabled } from '@/app/flags'
import TableBookingView from './view'

export default async function TableBookingPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { date?: string; partySize?: string }
}) {
  if (!(await isFlagEnabled('restaurants'))) notFound()
  const site = await prisma.site.findFirst({
    where: { OR: [{ id: params.id }, { slug: params.id }] },
    select: {
      id: true,
      name: true,
      restaurantId: true,
    },
  })
  if (!site?.restaurantId) {
    return (
      <div className="max-w-xl mx-auto p-6">
        <p className="text-sm text-gray-600">This site has no restaurant.</p>
      </div>
    )
  }
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: site.restaurantId },
    select: {
      id: true,
      name: true,
      reservationWindow: true,
      averageMealDuration: true,
      guestSelectionEnabled: true,
    },
  })
  if (!restaurant) {
    return (
      <div className="max-w-xl mx-auto p-6">
        <p className="text-sm text-gray-600">Restaurant not found.</p>
      </div>
    )
  }

  return (
    <TableBookingView
      siteId={site.id}
      restaurant={{
        id: restaurant.id,
        name: restaurant.name,
        reservationWindow: restaurant.reservationWindow,
        guestSelectionEnabled: restaurant.guestSelectionEnabled,
      }}
      initialDate={searchParams.date}
      initialPartySize={searchParams.partySize ? Number(searchParams.partySize) : undefined}
    />
  )
}
