'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

export async function cancelReservation(
  reservationId: string
) {
  
  const session = await auth()
  console.log('CANCEL RESERVATION', reservationId, session)

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  await prisma.reservation.update({
    data: {
      status: 'canceled'
    },
    where: {
      id: reservationId
    }
  })
  
  revalidatePath('/reservations')
  revalidatePath(`/reservations/${reservationId}`)

  return { status: 'ok' }
  
}