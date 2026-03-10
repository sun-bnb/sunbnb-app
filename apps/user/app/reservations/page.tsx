import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import Reservations from './Reservations'
import { Reservation } from '@/app/sites/types'

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

export default async function ReservationsPage() {

  const session = await auth()
  if (!session?.user) return null

  const [reservations, rentalBookings] = await Promise.all([
    getReservations(session.user.id),
    getRentalBookings(session.user.id),
  ])

  return <Reservations reservations={reservations} rentalBookings={rentalBookings} />

}