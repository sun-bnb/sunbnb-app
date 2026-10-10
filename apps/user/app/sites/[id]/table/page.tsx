import { notFound } from 'next/navigation'
import prisma from '@repo/data/PrismaCient'
import { isFlagEnabled } from '@/app/flags'
import TableBookingView from './view'

export default async function TableBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ date?: string; partySize?: string }>
}) {
  const { id } = await params
  const { date, partySize } = await searchParams
  if (!(await isFlagEnabled('restaurants'))) notFound()
  const site = await prisma.site.findFirst({
    where: { OR: [{ id }, { slug: id }] },
    select: {
      id: true,
      name: true,
      restaurantId: true,
      paymentProvider: true,
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
      paymentProvider={site.paymentProvider}
      restaurant={{
        id: restaurant.id,
        name: restaurant.name,
        reservationWindow: restaurant.reservationWindow,
        guestSelectionEnabled: restaurant.guestSelectionEnabled,
      }}
      initialDate={date}
      initialPartySize={partySize ? Number(partySize) : undefined}
    />
  )
}
