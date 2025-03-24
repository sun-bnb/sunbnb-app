import prisma from '@repo/data/PrismaCient'
import PassPage from './PassPage'

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

async function getSite(id: string) {

  console.log('GET SITE BY ID', id)
  const site = await prisma.site.findUnique({ where: { id: id } })
  console.log('SITE FOUND', site)
  return site

}

export default async function Pass({ params }: { params: { id: string } }) {

  const reservation = await getReservation(params.id)

  if (!reservation) {
    console.error('Reservation not found')
    return <div>Reservation not found</div>
  }

  const site = await getSite(reservation.siteId)

  return (
    <PassPage reservation={reservation} />
  )
}