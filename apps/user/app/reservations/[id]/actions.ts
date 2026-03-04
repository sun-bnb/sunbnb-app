'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import Stripe from 'stripe'

// ─── Helpers ────────────────────────────────────────────────────────────────

function isDemoPayment(paymentRef: string | null): boolean {
  return paymentRef?.startsWith('pi_demo_') ?? false
}

// ─── Cancel Reservation ─────────────────────────────────────────────────────

export async function cancelReservation(reservationId: string) {
  const session = await auth()
  if (!session?.user) {
    return { status: 'error', errors: ['Not authenticated'] }
  }

  // Verify the authenticated user owns this reservation
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { userId: true, status: true, paymentRef: true },
  })

  if (!reservation) {
    return { status: 'error', errors: ['Reservation not found'] }
  }

  if (reservation.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  if (reservation.status === 'canceled') {
    return { status: 'ok' }
  }

  // Issue a Stripe refund if this reservation was paid with a real payment
  const isPaid = ['paid', 'complete'].includes(reservation.status)
  const hasRealPayment = reservation.paymentRef && !isDemoPayment(reservation.paymentRef)

  if (isPaid && hasRealPayment) {
    const { STRIPE_SECRET_KEY } = process.env
    if (!STRIPE_SECRET_KEY) {
      return { status: 'error', errors: ['Payment service not configured — cannot process refund'] }
    }

    try {
      const stripe = new Stripe(STRIPE_SECRET_KEY)
      await stripe.refunds.create({ payment_intent: reservation.paymentRef! })
    } catch (error) {
      console.error(`[cancelReservation] Stripe refund failed for ${reservationId}:`, error)
      return { status: 'error', errors: ['Refund failed — please contact support'] }
    }
  }

  await prisma.reservation.update({
    data: { status: 'canceled' },
    where: { id: reservationId },
  })

  revalidatePath('/reservations')
  revalidatePath(`/reservations/${reservationId}`)

  return { status: 'ok' }
}

// ─── Get Products ───────────────────────────────────────────────────────────

export async function getProducts(siteId: string) {
  const products = await prisma.product.findMany({
    where: { siteId, active: true },
  })
  return products
}

// ─── Create Order ───────────────────────────────────────────────────────────

/**
 * Create an order with items. Prices are always looked up from the database
 * to prevent client-side price tampering. Only productId and quantity are
 * trusted from the client.
 */
export async function createOrder(order: {
  userId?: string
  anonId?: string
  siteId?: string
  reservationId?: string
  seatId?: string
  items: { product: { id: string }, quantity: number }[]
}) {
  // Authenticate: require either a session user or an anonId
  const session = await auth()
  let orderUserId = session?.user?.id ?? order.userId

  if (!orderUserId) {
    if (!order.anonId) {
      return { status: 'error', errors: ['Authentication required'] }
    }
    // For anonymous orders: use the site owner's userId to satisfy the FK constraint.
    // The anonId field identifies the actual anonymous customer.
    const site = order.siteId
      ? await prisma.site.findUnique({
          where: { id: order.siteId },
          select: { userId: true },
        })
      : null

    if (!site?.userId) {
      return { status: 'error', errors: ['Site not found'] }
    }

    orderUserId = site.userId
  }

  if (!order.siteId) {
    return { status: 'error', errors: ['siteId is required'] }
  }

  if (!order.items?.length) {
    return { status: 'error', errors: ['At least one item is required'] }
  }

  // Validate quantities are positive integers
  for (const item of order.items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      return { status: 'error', errors: ['Invalid item quantity'] }
    }
  }

  // Look up product prices from the database (never trust client-supplied prices)
  const productIds = order.items.map((item) => item.product.id)
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      siteId: order.siteId,
      active: true,
    },
  })

  const productMap = new Map(products.map((p) => [p.id, p]))

  // Validate all requested products exist and are active
  for (const item of order.items) {
    if (!productMap.has(item.product.id)) {
      return {
        status: 'error',
        errors: [`Product ${item.product.id} not found or not active`],
      }
    }
  }

  // Calculate totals from DB prices
  let sumPrice = 0
  let sumTotalPrice = 0

  const orderItemsData = order.items.map((item) => {
    const product = productMap.get(item.product.id)!
    const linePrice = product.price * item.quantity
    const lineTotalPrice = product.totalPrice * item.quantity

    sumPrice += linePrice
    sumTotalPrice += lineTotalPrice

    return {
      productId: product.id,
      quantity: item.quantity,
      name: product.name,
      price: linePrice,
      tax: product.tax,
      totalPrice: lineTotalPrice,
    }
  })

  const tax = sumTotalPrice - sumPrice

  // Build the order data
  const orderData: any = {
    status: 'pending',
    price: sumPrice,
    tax,
    totalPrice: sumTotalPrice,
    paymentAmount: sumTotalPrice,
    anonId: order.anonId,
    orderItems: { create: orderItemsData },
    site: { connect: { id: order.siteId } },
    user: { connect: { id: orderUserId } },
  }

  if (order.reservationId) {
    orderData.reservation = { connect: { id: order.reservationId } }
  }

  if (order.seatId) {
    orderData.seat = { connect: { id: order.seatId } }
  }

  const newOrder = await prisma.order.create({ data: orderData })

  return { status: 'ok', id: newOrder.id }
}

// ─── Query Actions ──────────────────────────────────────────────────────────

export async function getOrderByPaymentRef({
  paymentRef,
}: {
  paymentRef: string
}) {
  const session = await auth()
  if (!session?.user) {
    return { status: 'error', errors: ['Not authenticated'] }
  }

  const order = await prisma.order.findFirst({
    where: { paymentRef },
  })

  // Verify ownership
  if (order && order.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  return order
}

export async function getOrders({
  reservationId,
}: {
  reservationId: string
}) {
  const session = await auth()
  if (!session?.user) {
    return { status: 'error', errors: ['Not authenticated'] }
  }

  // Verify the user owns the reservation before returning its orders
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { userId: true },
  })

  if (!reservation || reservation.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  const orders = await prisma.order.findMany({
    where: { reservationId },
    include: {
      orderItems: true,
      invoice: {
        include: { invoiceLines: true },
      },
    },
  })

  return orders
}