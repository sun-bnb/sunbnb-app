'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

export async function updateReservation(
  reservation: {
    id: string,
    paymentRef?: string,
    paymentAmount?: number,
    status?: string 
  }) {
  
  const session = await auth()
  console.log('SAVE RES', session, reservation)

  // if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const reservationData: {
    paymentRef?: string,
    status?: string,
    paymentAmount?: number
  } = { 
  }

  if (reservation.paymentRef) {
    reservationData.paymentRef = reservation.paymentRef
  }

  if (reservation.paymentAmount) {
    reservationData.paymentAmount = reservation.paymentAmount
  }

  if (reservation.status) {
    reservationData.status = reservation.status
  }

  console.log('UPDATE RES', reservationData)
  const updatedReservation = await prisma.reservation.update({ where: { id: reservation.id },
    data: reservationData
  })

  console.log('UPDATED RES', updatedReservation)

  return { status: 'ok', id: updatedReservation.id }
  
}

export async function updateOrder(
  order: {
    id: string,
    paymentRef?: string,
    paymentAmount?: number 
  }) {
  
  const session = await auth()
  console.log('SAVE ORDER', session, order)

  // if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const orderData: {
    paymentRef?: string,
    paymentAmount?: number
  } = { 
  }

  if (order.paymentRef) {
    orderData.paymentRef = order.paymentRef
  }

  if (order.paymentAmount) {
    orderData.paymentAmount = order.paymentAmount
  }

  console.log('UPDATE ORDER', orderData)
  const updatedOrder = await prisma.order.update({ where: { id: order.id },
    data: orderData
  })

  console.log('UPDATED ORDER', updatedOrder)

  return { status: 'ok', id: updatedOrder.id }
  
}

export async function getReservationById({
  id
} : {
  id: string 
}) {
  
  const session = await auth()
  console.log('GET RES', session)

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const reservation = await prisma.reservation.findFirst({ where: { id: id } })

  console.log('reservation by id found', reservation)

  return { reservation }
  
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

export async function getOrderByPaymentRef({
  paymentRef
} : {
  paymentRef: string 
}) {
  
  const session = await auth()
  console.log('GET ORDER', session)

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const order = await prisma.order.findFirst({ where: { paymentRef: paymentRef } })

  console.log('order by ref found', order)

  return order
  
}