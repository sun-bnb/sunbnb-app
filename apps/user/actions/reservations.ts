'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

export async function updateReservation(
  reservation: {
    id: string,
    status: string
  }) {
  
  const session = await auth()
  console.log('SAVE RES', session, reservation)

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const reservationData = {
    status: reservation.status
  }

  console.log('UPDATE RES', reservationData)
  const newReservation = await prisma.reservation.update({ where: { id: reservation.id },
    data: reservationData
  })

  console.log('NEW RES', newReservation)

  return { status: 'ok', id: newReservation.id }
  
}