import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import Reservations from './Reservations'
import { Reservation } from '@/app/sites/types'
import { isFlagEnabled } from '@/app/flags'

async function getReservations(userId: string): Promise<Reservation[]> {
  return await prisma.reservation.findMany({ 
    where: { userId: userId },
    orderBy: { from: 'desc' },
    include: {
      site: { select: { id: true, name: true } },
      items: { select: { id: true, number: true } },
    },
  })
}

async function getRentalBookings(userId: string) {
  return await prisma.rentalBooking.findMany({
    where: { userId },
    orderBy: { from: 'desc' },
    include: {
      site: { select: { id: true, name: true } },
      rentalItem: { select: { id: true, name: true } },
    },
  })
}

async function getTableReservations(userId: string) {
  // Gate on the `restaurants` feature flag — when off, the detail page (/
  // table-reservations/[id]) 404s, so surfacing cards in the list would deadlink.
  if (!(await isFlagEnabled('restaurants'))) return []
  return await prisma.tableReservation.findMany({
    where: { userId },
    orderBy: { from: 'desc' },
    include: {
      restaurant: { select: { id: true, name: true } },
      table: { select: { id: true, number: true, label: true } },
    },
  })
}

export default async function ReservationsPage() {

  const session = await auth()
  if (!session?.user) return null

  const [reservations, rentalBookings, tableReservations] = await Promise.all([
    getReservations(session.user.id),
    getRentalBookings(session.user.id),
    getTableReservations(session.user.id),
  ])

  // Combination bookings persist as N linked rows sharing a bookingGroupId
  // (chunk 1d). Dedupe to one card per booking — first seen wins (the query is
  // ordered by `from` desc, so it doesn't matter which member represents the group).
  const dedupedTables = (() => {
    const seen = new Set<string>()
    const out: typeof tableReservations = []
    for (const r of tableReservations) {
      if (r.bookingGroupId) {
        if (seen.has(r.bookingGroupId)) continue
        seen.add(r.bookingGroupId)
      }
      out.push(r)
    }
    return out
  })()

  return (
    <Reservations
      reservations={reservations}
      rentalBookings={rentalBookings}
      tableReservations={dedupedTables}
    />
  )

}