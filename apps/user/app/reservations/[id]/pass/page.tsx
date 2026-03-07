import prisma from '@repo/data/PrismaCient'
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

export default async function Pass({ params }: { params: { id: string } }) {

  const reservation = await getReservation(params.id)

  if (!reservation) {
    console.error('Reservation not found')
    return <div>Reservation not found</div>
  }

  return (
    <PassPage reservation={reservation} />
  )
}