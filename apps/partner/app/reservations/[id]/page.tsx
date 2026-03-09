import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import ReservationView from './view'

export default async function Site({ params, searchParams }: { params: { id: string }, searchParams: URLSearchParams }) {

  const session = await auth()
  if (!session?.user) return null

  const reservation = await prisma.reservation.findUnique({ 
    where: { id: params.id },
    include: {
      user: { select: { id: true, email: true } },
      site: { select: { userId: true } }
    }
  })
  
  if (!reservation) return <div>Reservation {params.id} not found</div>
  if (reservation.site.userId !== session.user.id) return <div>Not authorized</div>

  return <ReservationView reservation={reservation} />

}