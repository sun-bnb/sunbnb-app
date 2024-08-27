import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import ReservationView from './view'

async function getReservation(id: string) {
  return await prisma.reservation.findUnique({ where: { id: id } })
}

export default async function Site({ params, searchParams }: { params: { id: string }, searchParams: URLSearchParams }) {

  console.log('params', params)
  const session = await auth()
  if (!session?.user) return null

  const reservation = await getReservation(params.id)

  if (!reservation) return <div>Reservation {params.id} not found</div>

  return <ReservationView reservation={reservation} />

}