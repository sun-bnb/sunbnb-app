'use server'

import { revalidatePath } from 'next/cache'
import dayjs from 'dayjs'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getAvailability } from '@/service/availabilityService'
import { isValidEntityId } from '@/app/api/_lib/payment-ids'
import { InventoryItem } from '../types'
import {
  RESERVATION_PENDING,
  RESERVATION_COMPLETE,
  RENTAL_PENDING,
  RENTAL_COMPLETE,
  RENTAL_CANCELED,
  OP_RETURNED,
} from '@repo/data/reservation-status'

const VALID_RESERVATION_TYPES = ['days', 'hours'] as const

// ─── Reservations ───────────────────────────────────────────────────────────

export async function saveReservationForMultipleItems(
  reservation: {
    userId?: string,
    anonId?: string,
    siteId: string,
    items?: InventoryItem[],
    type: string,
    from: string, to: string
  }) {

  // ── Input validation ────────────────────────────────────────────────────
  if (!isValidEntityId(reservation.siteId)) {
    return { status: 'error', errors: ['Invalid site ID'] }
  }

  if (reservation.items && reservation.items.length > 20) {
    return { status: 'error', errors: ['Too many items'] }
  }

  if (reservation.items) {
    for (const item of reservation.items) {
      if (!isValidEntityId(item.id)) {
        return { status: 'error', errors: ['Invalid item ID'] }
      }
    }
  }

  if (!VALID_RESERVATION_TYPES.includes(reservation.type as any)) {
    return { status: 'error', errors: ['Invalid reservation type'] }
  }

  if (reservation.anonId && reservation.anonId.length > 36) {
    return { status: 'error', errors: ['Invalid anonymous ID'] }
  }

  const fromDate = new Date(reservation.from)
  const toDate = new Date(reservation.to)

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return { status: 'error', errors: ['Invalid date format'] }
  }

  const daysDiff = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)
  if (daysDiff > 90) {
    return { status: 'error', errors: ['Date range cannot exceed 90 days'] }
  }

  // Authenticate: require either a session user or an anonId
  // Never trust client-supplied userId — always derive from session
  const session = await auth()
  let reservationUserId = session?.user?.id

  if (!reservationUserId) {
    if (!reservation.anonId) {
      return { status: 'error', errors: ['Authentication required'] }
    }
    // For anonymous reservations: use the site owner's userId to satisfy the FK constraint.
    // The anonId field identifies the actual anonymous customer.
    const site = await prisma.site.findUnique({
      where: { id: reservation.siteId },
      select: { userId: true },
    })
    if (!site?.userId) {
      return { status: 'error', errors: ['Site not found'] }
    }
    reservationUserId = site.userId
  }

  const from = new Date(reservation.from)
  const to = new Date(reservation.to)

  if (from >= to) {
    return { status: 'error', errors: ['End date must be after start date'] }
  }

  const site = await prisma.site.findUnique({ where: { id: reservation.siteId } })
  if (!site) return { status: 'error', errors: ['Site not found'] }
  if (site.type === 'paid' && !site.price) return { status: 'error', errors: ['Site price not set'] }

  if (site.type === 'paid' && (!reservation.items || reservation.items.length === 0)) {
    return { status: 'error', errors: ['At least one item is required'] }
  }

  // ── Server-side availability check ─────────────────────────────────────
  if (reservation.items?.length) {
    const availability = await getAvailability(reservation.siteId, from, to)
    const requestedIds = new Set(reservation.items.map(i => i.id))
    const unavailable = availability
      .filter(a => requestedIds.has(a.itemId) && !a.available)
      .map(a => a.itemId)

    if (unavailable.length > 0) {
      return {
        status: 'error',
        errors: [`Some items are not available for the requested dates`],
      }
    }
  }

  // Determine status server-side: only explicitly 'paid' sites enter the payment flow
  const status = site.type === 'paid' ? RESERVATION_PENDING : RESERVATION_COMPLETE

  const timeBetween = to.getTime() - from.getTime()
  const daysBetween = Math.round(timeBetween / (1000 * 60 * 60 * 24))

  // Fetch item prices from DB — never trust client-supplied prices
  let totalPrice = 0
  if (site.type === 'paid' && reservation.items?.length) {
    const itemIds = reservation.items.map(i => i.id)
    const dbItems = await prisma.inventoryItem.findMany({
      where: { id: { in: itemIds }, siteId: reservation.siteId },
      select: { id: true, price: true },
    })
    const dbItemMap = new Map(dbItems.map(i => [i.id, i]))
    totalPrice = reservation.items.reduce((sum, item) => {
      const dbItem = dbItemMap.get(item.id)
      return sum + ((dbItem?.price ?? null) || site.price || 0)
    }, 0)
  }

  const paymentAmount = totalPrice * daysBetween

  const newReservation = await prisma.reservation.create({
    data: {
      from,
      to,
      type: reservation.type,
      status,
      paymentAmount,
      anonId: reservation.anonId,
      items: {
        connect: reservation.items?.map(item => ({ id: item.id }))
      },
      site: {
        connect: { id: reservation.siteId }
      },
      user: {
        connect: { id: reservationUserId }
      }
    }
  })

  revalidatePath('/sites')

  return { status: 'ok', id: newReservation.id }
}

// ─── Rental Bookings ────────────────────────────────────────────────────────

export async function saveRentalBooking(input: {
  siteId: string
  items: { rentalItemId: string; quantity: number }[]
  durationType: string
  from: string
  to: string
}) {
  // ── Input validation ────────────────────────────────────────────────────
  if (!isValidEntityId(input.siteId)) {
    return { status: 'error', errors: ['Invalid site ID'] }
  }

  if (input.items.length > 20) {
    return { status: 'error', errors: ['Too many items'] }
  }

  if (!['hours', 'days'].includes(input.durationType)) {
    return { status: 'error', errors: ['Invalid duration type'] }
  }

  for (const cartItem of input.items) {
    if (!isValidEntityId(cartItem.rentalItemId)) {
      return { status: 'error', errors: ['Invalid rental item ID'] }
    }
    if (!Number.isInteger(cartItem.quantity) || cartItem.quantity < 1) {
      return { status: 'error', errors: ['Invalid quantity'] }
    }
  }

  const session = await auth()
  if (!session?.user?.id) {
    return { status: 'error', errors: ['Authentication required'] }
  }

  const site = await prisma.site.findUnique({ where: { id: input.siteId } })
  if (!site) return { status: 'error', errors: ['Site not found'] }

  const from = new Date(input.from)
  const to = new Date(input.to)

  if (from >= to) {
    return { status: 'error', errors: ['End date must be after start date'] }
  }

  // Load rental items to calculate pricing
  const rentalItemIds = input.items.map(i => i.rentalItemId)
  const rentalItems = await prisma.rentalItem.findMany({
    where: { id: { in: rentalItemIds }, siteId: input.siteId, active: true },
  })

  if (rentalItems.length !== rentalItemIds.length) {
    return { status: 'error', errors: ['Some items are not available'] }
  }

  // TODO: Check availability (compare booked quantities for the time range)
  // For each item, count how many are already booked (excluding returned) in the overlapping time window
  for (const cartItem of input.items) {
    const rentalItem = rentalItems.find(ri => ri.id === cartItem.rentalItemId)
    if (!rentalItem) continue

    const bookedQty = await prisma.rentalBooking.aggregate({
      where: {
        rentalItemId: cartItem.rentalItemId,
        siteId: input.siteId,
        operationalStatus: { notIn: [OP_RETURNED, RENTAL_CANCELED] },
        from: { lt: to },
        to: { gt: from },
      },
      _sum: { quantity: true },
    })

    const inUse = bookedQty._sum.quantity || 0
    const available = rentalItem.totalQuantity - inUse
    if (cartItem.quantity > available) {
      return {
        status: 'error',
        errors: [`Only ${available} of "${rentalItem.name}" available (${inUse} already booked)`],
      }
    }
  }

  // Create one booking per item type
  const bookings = []
  for (const cartItem of input.items) {
    const rentalItem = rentalItems.find(ri => ri.id === cartItem.rentalItemId)
    if (!rentalItem) continue

    const hours = (to.getTime() - from.getTime()) / (1000 * 60 * 60)
    const days = Math.max(1, Math.ceil(hours / 24))

    let totalPrice = 0
    if (input.durationType === 'hours' && rentalItem.pricePerHour) {
      totalPrice = rentalItem.pricePerHour * Math.ceil(hours) * cartItem.quantity
    } else if (rentalItem.pricePerDay) {
      totalPrice = rentalItem.pricePerDay * days * cartItem.quantity
    } else if (rentalItem.pricePerHour) {
      totalPrice = rentalItem.pricePerHour * Math.ceil(hours) * cartItem.quantity
    }

    const booking = await prisma.rentalBooking.create({
      data: {
        siteId: input.siteId,
        rentalItemId: cartItem.rentalItemId,
        userId: session.user.id,
        from,
        to,
        quantity: cartItem.quantity,
        durationType: input.durationType,
        totalPrice,
        paymentAmount: totalPrice,
        status: (site.rentalPaymentType ?? site.type) === 'paid' ? RENTAL_PENDING : RENTAL_COMPLETE,
      },
    })
    bookings.push(booking)
  }

  revalidatePath('/sites')
  return { status: 'ok', bookingIds: bookings.map(b => b.id) }
}

// ─── Queries ────────────────────────────────────────────────────────────────

export async function findAnonReservation(
  anonId: string,
  itemId: string
) {

  const now = new Date()

  const reservation = await prisma.reservation.findFirst({
    where: {
      anonId: anonId,
      status: RESERVATION_COMPLETE,
      from: { lte: now },
      to: { gte: now },
      items: {
        some: {
          id: { in: [itemId] },
        },
      }
    },
    include: {
      items: true,
      site: true
    }
  })


  return reservation
  
}

export async function findUserReservation(
  userId: string,
  itemId: string
) {

  const now = new Date()

  const reservation = await prisma.reservation.findFirst({
    where: {
      userId: userId,
      status: RESERVATION_COMPLETE,
      from: { lte: now },
      to: { gte: now },
      items: {
        some: {
          id: { in: [itemId] },
        },
      }
    },
    include: {
      items: true,
      site: true
    }
  })


  return reservation
  
}