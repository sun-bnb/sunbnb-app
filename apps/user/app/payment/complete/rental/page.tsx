import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import { round } from '@repo/data/payment'
import RentalCompletePage from './RentalCompletePage'

interface SearchParams {
  searchParams: Promise<{ [key: string]: string }>
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
  const { rentalBookingId, anonId } = await searchParams

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

  // GA4 purchase payload: a multi-item cart pays ONE payment across sibling bookings (same
  // paymentRef), so sum the stored amounts server-side instead of trusting the client.
  const siblings = booking.paymentRef
    ? await prisma.rentalBooking.findMany({ where: { paymentRef: booking.paymentRef }, select: { paymentAmount: true, totalPrice: true } })
    : [booking]
  const analytics = {
    siteId: booking.siteId,
    siteName: booking.site?.name ?? null,
    amount: round(siblings.reduce((sum, b) => sum + (b.paymentAmount ?? b.totalPrice ?? 0), 0)),
    quantity: siblings.length,
  }

  return <RentalCompletePage bookingId={booking.id} initialStatus={booking.status} analytics={analytics} />
}
