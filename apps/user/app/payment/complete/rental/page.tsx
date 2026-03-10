import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import RentalCompletePage from './RentalCompletePage'

interface SearchParams {
  searchParams: { [key: string]: string }
}

export default async function RentalComplete({ searchParams }: SearchParams) {
  const { rentalBookingId } = searchParams

  if (!rentalBookingId) {
    return <div>Missing booking reference</div>
  }

  const session = await auth()
  const sessionUserId = session?.user?.id

  const booking = await prisma.rentalBooking.findUnique({
    where: { id: rentalBookingId },
    include: { rentalItem: true, site: true },
  })

  if (!booking) {
    return <div>Booking not found</div>
  }

  if (sessionUserId && booking.userId !== sessionUserId) {
    return <div>Not authorized</div>
  }

  return <RentalCompletePage bookingId={booking.id} initialStatus={booking.status} />
}
