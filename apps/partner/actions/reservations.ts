'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { RESERVATION_CANCELED } from '@repo/data/reservation-status'

export async function cancelReservation(
  reservationId: string
) {
  
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  // Verify the reservation belongs to a site owned by this user
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { site: { select: { userId: true } } },
  })
  if (!reservation || reservation.site.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  await prisma.reservation.update({
    data: {
      status: RESERVATION_CANCELED
    },
    where: {
      id: reservationId
    }
  })

  // Send cancellation email (non-blocking)
  try {
    const { sendCancellationEmail } = await import('@repo/data/reservation-emails')
    sendCancellationEmail(reservationId).catch(() => {})
  } catch {}
  
  revalidatePath('/reservations')
  revalidatePath(`/reservations/${reservationId}`)

  return { status: 'ok' }
  
}