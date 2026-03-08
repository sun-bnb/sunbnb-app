'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { processConfirmedOrder } from '@repo/data/payment'
import { isDemoPayment } from '@/app/api/_lib/stripe'
import { issueRefund } from '@/app/api/_lib/payment-provider'

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

  // Issue a refund (Stripe or Mollie) if this reservation was paid with a real payment
  const isPaid = ['paid', 'complete'].includes(reservation.status)
  const hasRealPayment = reservation.paymentRef && !isDemoPayment(reservation.paymentRef)

  if (isPaid && hasRealPayment) {
    try {
      await issueRefund(reservation.paymentRef!)
    } catch (error) {
      console.error(`[cancelReservation] Refund failed for ${reservationId}:`, error)
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
  anonId?: string
  siteId?: string
  reservationId?: string
  seatId?: string
  items: { product: { id: string }, quantity: number }[]
}) {
  const session = await auth()

  // ── Validate basic inputs ──────────────────────────────────────────────────

  if (!order.siteId) {
    return { status: 'error', errors: ['siteId is required'] }
  }

  if (!order.items?.length) {
    return { status: 'error', errors: ['At least one item is required'] }
  }

  if (order.items.length > 50) {
    return { status: 'error', errors: ['Too many distinct items'] }
  }

  // Validate quantities are positive integers; cap total
  let totalQty = 0
  for (const item of order.items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      return { status: 'error', errors: ['Invalid item quantity'] }
    }
    totalQty += item.quantity
    if (totalQty > 200) {
      return { status: 'error', errors: ['Total quantity exceeds limit'] }
    }
  }

  // ── Verify site exists and has sales enabled ───────────────────────────────

  const site = await prisma.site.findUnique({
    where: { id: order.siteId },
    select: { userId: true, appSalesEnabled: true },
  })

  if (!site) {
    return { status: 'error', errors: ['Site not found'] }
  }

  if (!site.appSalesEnabled) {
    return { status: 'error', errors: ['Product ordering is not available for this site'] }
  }

  // ── Determine authenticated user ──────────────────────────────────────────

  let orderUserId = session?.user?.id

  if (!orderUserId) {
    if (!order.anonId) {
      return { status: 'error', errors: ['Authentication required'] }
    }
    // For anonymous orders: use the site owner's userId to satisfy the FK constraint.
    // The anonId field identifies the actual anonymous customer.
    orderUserId = site.userId
  }

  // ── Verify reservation ownership (if provided) ────────────────────────────

  if (order.reservationId) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: order.reservationId },
      select: { userId: true, anonId: true, siteId: true },
    })

    if (!reservation || reservation.siteId !== order.siteId) {
      return { status: 'error', errors: ['Reservation not found'] }
    }

    if (session?.user?.id) {
      if (reservation.userId !== session.user.id) {
        return { status: 'error', errors: ['Not authorized'] }
      }
    } else if (order.anonId && reservation.anonId !== order.anonId) {
      return { status: 'error', errors: ['Not authorized'] }
    }
  }

  // ── Look up product prices from DB (never trust client-supplied prices) ───

  const productIds = order.items.map((i) => i.product.id)
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, siteId: order.siteId, active: true },
  })

  const productMap = new Map(products.map((p) => [p.id, p]))

  for (const item of order.items) {
    if (!productMap.has(item.product.id)) {
      return { status: 'error', errors: [`Product ${item.product.id} not found or not active`] }
    }
  }

  // ── Calculate totals from DB prices ────────────────────────────────────────

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

  // ── Create the order ──────────────────────────────────────────────────────

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

// ─── Complete Off-Platform Order ────────────────────────────────────────────

/**
 * Complete an order without payment. Only allowed for sites using
 * off-platform billing for food orders (site.orderPaymentType or site.type === 'unpaid').
 */
export async function completeUnpaidOrder(orderId: string) {
  const session = await auth()

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { site: { select: { type: true, orderPaymentType: true } } },
  })

  if (!order) {
    return { status: 'error', errors: ['Order not found'] }
  }

  // Only allow for off-platform billing sites (check orderPaymentType first, fall back to type)
  const effectiveOrderPaymentType = order.site.orderPaymentType ?? order.site.type
  if (effectiveOrderPaymentType !== 'unpaid') {
    return { status: 'error', errors: ['Payment is required for this site'] }
  }

  // Verify ownership
  if (session?.user?.id) {
    if (order.userId !== session.user.id) {
      return { status: 'error', errors: ['Not authorized'] }
    }
  } else {
    // Anonymous: check anonId from the request
    // Note: for server actions we can't read localStorage directly,
    // but the order already has the anonId from createOrder
    return { status: 'error', errors: ['Authentication required'] }
  }

  if (order.status !== 'pending') {
    return { status: 'error', errors: ['Order is not in pending state'] }
  }

  // Set paymentRef first so the order is identifiable, then create invoices
  await prisma.order.update({
    where: { id: orderId },
    data: { paymentRef: `offplatform_${orderId}` },
  })

  try {
    // processConfirmedOrder creates PARTNER + PLATFORM invoices and sets status to 'complete'
    await processConfirmedOrder(orderId)
  } catch (error) {
    console.error('[completeUnpaidOrder] Invoice creation failed:', error)
    // Fall back to just setting complete so the order isn't stuck
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'complete' },
    })
  }

  revalidatePath(`/reservations/${order.reservationId}`)

  return { status: 'ok' }
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
      invoices: {
        include: { invoiceLines: true },
      },
    },
  })

  return orders
}