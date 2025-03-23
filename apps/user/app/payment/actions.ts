'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

export async function updateReservation(
  reservation: {
    id: string,
    paymentRef?: string,
    paymentAmount?: number 
  }) {
  
  const session = await auth()
  console.log('SAVE RES', session, reservation)

  // if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const reservationData: {
    paymentRef?: string,
    paymentAmount?: number
  } = { 
  }

  if (reservation.paymentRef) {
    reservationData.paymentRef = reservation.paymentRef
  }

  if (reservation.paymentAmount) {
    reservationData.paymentAmount = reservation.paymentAmount
  }

  console.log('UPDATE RES', reservationData)
  const updatedReservation = await prisma.reservation.update({ where: { id: reservation.id },
    data: reservationData
  })

  console.log('UPDATED RES', updatedReservation)

  return { status: 'ok', id: updatedReservation.id }
  
}

export async function getReservationByPaymentRef({
  paymentRef
} : {
  paymentRef: string 
}) {
  
  const session = await auth()
  console.log('GET RES', session)

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const reservation = await prisma.reservation.findFirst({ where: { paymentRef: paymentRef } })

  console.log('reservation by ref found', reservation)

  return reservation
  
}