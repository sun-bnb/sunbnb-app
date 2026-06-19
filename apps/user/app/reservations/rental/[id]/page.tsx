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

export default async function RentalBookingPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { [key: string]: string }
}) {
  const session = await auth()
  const signedIn = !!(session?.user)

  const { anonId } = searchParams

  const booking = await getRentalBooking(params.id)
  if (!booking) {
    return <div className="h-screen flex items-center justify-center text-neutral-500">Booking not found</div>
  }

  // Ownership check — mirror the sunbed reservation page pattern:
  // signed-in users must own the booking via userId;
  // anonymous users must provide the matching anonId via query param.
  if (signedIn) {
    if (booking.userId !== session?.user?.id) {
      return <div className="h-screen flex items-center justify-center text-neutral-500">Booking not found</div>
    }
  } else {
    if (!anonId || booking.anonId !== anonId) {
      return <div className="h-screen flex items-center justify-center text-neutral-500">No booking found</div>
    }
  }

  return <RentalBookingDetail booking={booking} anonId={anonId} />
}
