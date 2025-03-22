import prisma from '@repo/data/PrismaCient'
import ReceiptPage from './ReceiptPage'

interface SearchParams {
  searchParams: { [key: string]: string }
}

async function getReservation(id: string) {

  console.log('GET RESERVATION BY ID', id)
  const reservation = await prisma.reservation.findUnique({ 
    where: { id },
    include: {
      items: true
    }
  })
  console.log('RESERVATION FOUND', reservation)
  return reservation

}

export default async function Receipt({ params }: { params: { id: string } }) {

  const reservation = await getReservation(params.id)

  if (!reservation) {
    console.error('Reservation not found')
    return <div>Reservation not found</div>
  }

  return (
    <ReceiptPage reservation={reservation} />
  )
}