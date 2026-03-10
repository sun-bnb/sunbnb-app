import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import RentalBookingDetail from './view'

async function getRentalBooking(id: string) {
  return await prisma.rentalBooking.findUnique({
    where: { id },
    include: {
      site: { select: { id: true, name: true } },
      rentalItem: { select: { id: true, name: true, category: true } },
    },
  })
}

export default async function RentalBookingPage({ params }: { params: { id: string } }) {

  const session = await auth()
  if (!session?.user) return null

  const booking = await getRentalBooking(params.id)
  if (!booking) {
    return <div className="h-screen flex items-center justify-center text-neutral-500">Booking not found</div>
  }

  if (booking.userId !== session.user.id) {
    return <div className="h-screen flex items-center justify-center text-neutral-500">Booking not found</div>
  }

  return <RentalBookingDetail booking={booking} />
}
