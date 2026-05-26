import { notFound } from 'next/navigation'
import prisma from '@repo/data/PrismaCient'
import { getTableReservationById } from '@repo/table-reservations-core'
import { isFlagEnabled } from '@/app/flags'
import TableReservationView from './view'

export default async function TableReservationPage({ params }: { params: { id: string } }) {
  if (!(await isFlagEnabled('restaurants'))) notFound()
  const reservation = await getTableReservationById(params.id)
  if (!reservation) {
    return (
      <div className="max-w-xl mx-auto p-6">
        <p className="text-sm text-gray-600">Reservation not found.</p>
      </div>
    )
  }
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: reservation.restaurantId },
    select: { id: true, name: true, slug: true, siteId: true, reservationWindow: true },
  })

  return (
    <TableReservationView
      reservation={{
        id: reservation.id,
        from: reservation.from.toISOString(),
        to: reservation.to.toISOString(),
        partySize: reservation.partySize,
        specialRequests: reservation.specialRequests,
        status: reservation.status,
        userId: reservation.userId,
        anonId: reservation.anonId,
      }}
      restaurantName={restaurant?.name ?? ''}
      restaurantId={reservation.restaurantId}
      reservationWindow={restaurant?.reservationWindow ?? 60}
    />
  )
}
