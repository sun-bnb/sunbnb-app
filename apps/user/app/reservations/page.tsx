import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import Reservations from './Reservations'
import { Reservation } from '@/app/sites/types'

async function getReservations(userId: string): Promise<Reservation[]> {
  return await prisma.reservation.findMany({ 
    where: { userId: userId },
    orderBy: { from: 'desc' }
  })
}

export default async function ReservationsPage() {

  const session = await auth()
  if (!session?.user) return null

  const reservations = await getReservations(session.user.id)

  return <Reservations reservations={reservations} />

}