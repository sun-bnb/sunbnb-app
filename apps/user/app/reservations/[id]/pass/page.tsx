import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import PassPage from './PassPage'

async function getReservation(id: string) {
  const reservation = await prisma.reservation.findUnique({ 
    where: { id },
    include: {
      site: { select: { id: true, name: true } },
      items: true
    }
  })
  return reservation
}

export default async function Pass({ params, searchParams }: { params: { id: string }, searchParams: { [key: string]: string } }) {

  const reservation = await getReservation(params.id)

  if (!reservation) {
    console.error('Reservation not found')
    return <div>Reservation not found</div>
  }

  // Verify ownership: session user or anonymous user via anonId
  const session = await auth()
  if (session?.user?.id) {
    if (reservation.userId !== session.user.id) {
      return <div>Not authorized</div>
    }
  } else {
    const { anonId } = searchParams
    if (!anonId || reservation.anonId !== anonId) {
      return <div>Not authorized</div>
    }
  }

  return (
    <PassPage reservation={reservation} />
  )
}