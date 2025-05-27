'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { Product } from '@/app/types/types'

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

export async function getProducts(siteId: string) {

  const session = await auth();
  console.log('GET PRODUCTS', session);

  const products = await prisma.product.findMany({
    where: { siteId: siteId, active: true },
  })

  return products;

}

export async function createOrder(
  order: { 
    userId?: string,
    anonId?: string,
    siteId: string,
    reservationId?: string,
    items: { product: Product, quantity: number }[]
  }) {
  
  console.log('SAVE ORDER', order)
  
  let orderUserId = order.userId
  if (!orderUserId) {
    const user = await prisma.user.findUnique({ where: { email: 'vhalme@gmail.com' } })
    if (!user) return { status: 'error', errors: [ 'User not found' ] }
    orderUserId = user.id
  }

  let orderData: any = {
    status: 'pending',
    paymentAmount: 0,
    price: 0,
    tax: 0,
    totalPrice: 0,
    anonId: order.anonId,
    orderItems: {
      create: order.items.map(item => ({
        productId:  item.product.id,
        quantity:   item.quantity,
        name:       item.product.name,
        price:      item.product.price * item.quantity,
        tax:        item.product.tax,
        totalPrice: item.product.totalPrice * item.quantity
      })),
    },
    site: {
      connect: { id: order.siteId }
    },
    user: {
      connect: { id: orderUserId }
    }
  }

  if (order.reservationId) {
    orderData = {
      ...orderData,
      reservation: {
        connect: { id: order.reservationId }
      }
    }
  }

  const sumPrice = order.items?.reduce((sum, item) => {
    return sum + (item.product.price * item.quantity)
  }, 0) ?? 0

  const sumTotalPrice = order.items?.reduce((sum, item) => {
    return sum + (item.product.totalPrice * item.quantity)
  }, 0) ?? 0

  orderData.price = sumPrice
  orderData.totalPrice = sumTotalPrice
  orderData.paymentAmount = sumTotalPrice
  orderData.tax = sumTotalPrice - sumPrice

  console.log('CREATE ORDER', orderData)
  const newOrder = await prisma.order.create({
    data: orderData
  })

  console.log('NEW ORDER', newOrder)

  return { status: 'ok', id: newOrder.id }
  
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