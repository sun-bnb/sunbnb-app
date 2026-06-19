import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import RentalCompletePage from './RentalCompletePage'

interface SearchParams {
  searchParams: { [key: string]: string }
}

/**
 * Verify that the requesting user owns the rental booking.
 * Supports both authenticated (session) and anonymous (anonId query param) users.
 */
function verifyRentalOwner(
  booking: { userId: string; anonId?: string | null },
  sessionUserId: string | undefined,
  anonId: string | undefined
): boolean {
  if (sessionUserId) {
    return booking.userId === sessionUserId
  }
  if (anonId && booking.anonId) {
    return booking.anonId === anonId
  }
  return false
}

export default async function RentalComplete({ searchParams }: SearchParams) {
  const { rentalBookingId, anonId } = searchParams

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

  if (!verifyRentalOwner(booking, sessionUserId, anonId)) {
    return <div>Not authorized</div>
  }

  return <RentalCompletePage bookingId={booking.id} initialStatus={booking.status} />
}
