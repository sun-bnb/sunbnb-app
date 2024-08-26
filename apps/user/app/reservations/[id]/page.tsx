import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import ReservationView from './view'

export default async function Site({ params, searchParams }: { params: { id: string }, searchParams: URLSearchParams }) {

  console.log('params', params)
  const session = await auth()
  if (!session?.user) return null

  const reservation = await prisma.reservation.findUnique({ where: { id: params.id } })

  if (!reservation) return <div>Reservation {params.id} not found</div>

  return <ReservationView reservation={reservation} />

}