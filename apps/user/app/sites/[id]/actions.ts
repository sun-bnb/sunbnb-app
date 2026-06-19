'use server'

import { revalidatePath } from 'next/cache'
import dayjs from 'dayjs'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { reserveWithConflictGuard, createRentalBookingsWithGuard } from '@repo/data/reservations'
import { getAvailability } from '@/service/availabilityService'
import { isValidEntityId } from '@/app/api/_lib/payment-ids'
import { InventoryItem } from '../types'
import {
  RESERVATION_PENDING,
  RESERVATION_COMPLETE,
  RENTAL_PENDING,
  RENTAL_COMPLETE,
  OP_RESERVED,
} from '@repo/data/reservation-status'

const VALID_RESERVATION_TYPES = ['days', 'hours'] as const

// ─── Reservations ───────────────────────────────────────────────────────────

// Minimal email format check — full RFC validation is impractical and noisy.
// We only need to reject obvious nonsense; deliverability is verified by the email service.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function saveReservationForMultipleItems(
  reservation: {
    userId?: string,
    anonId?: string,
    email?: string,
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

  if (reservation.email !== undefined) {
    if (reservation.email.length > 254 || !EMAIL_REGEX.test(reservation.email)) {
      return { status: 'error', errors: ['Invalid email address'] }
    }
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
  // Every requested item must be present in the availability set (i.e. a real,
  // active seat for this site) AND available for the date range. Items absent
  // from the set are non-active seats (disabled, pool overflow, cross-site IDs,
  // bogus IDs) and must never be booked — never-trust-the-client.
  if (reservation.items?.length) {
    const availability = await getAvailability(reservation.siteId, from, to)
    const availableIds = new Set(
      availability.filter(a => a.available).map(a => a.itemId)
    )
    const hasUnavailable = reservation.items.some(i => !availableIds.has(i.id))

    if (hasUnavailable) {
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

  // Expand to the full item set the client sent (page already expands
  // SunbedGroup / pair siblings before calling this action).
  // Pass the full expanded set to the guard so it locks ALL candidate rows
  // and re-checks conflict inside the transaction — prevents pair-expansion
  // double-booking where a sibling was already reserved by a concurrent request.
  const itemIds = reservation.items?.map(item => item.id) ?? []

  const result = await reserveWithConflictGuard({
    itemIds,
    siteId: reservation.siteId,
    userId: reservationUserId,
    from,
    to,
    type: reservation.type,
    status,
    paymentAmount,
    anonId: reservation.anonId,
    guestEmail: reservation.email,
  })

  if (result.outcome === 'conflict') {
    return {
      status: 'error',
      errors: ['Some items are not available for the requested dates'],
    }
  }

  revalidatePath('/sites')

  return { status: 'ok', id: result.reservationId }
}

// ─── Rental Bookings ────────────────────────────────────────────────────────

export async function saveRentalBooking(input: {
  siteId: string
  items: { rentalItemId: string; quantity: number }[]
  durationType: string
  from: string
  to: string
  anonId?: string
  guestEmail?: string
  guestContact?: string
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

  if (input.anonId && input.anonId.length > 36) {
    return { status: 'error', errors: ['Invalid anonymous ID'] }
  }

  if (input.guestEmail !== undefined) {
    if (input.guestEmail.length > 254 || !EMAIL_REGEX.test(input.guestEmail)) {
      return { status: 'error', errors: ['Invalid email address'] }
    }
  }

  // Authenticate: require either a session user or an anonId
  // Never trust client-supplied userId — always derive from session
  const session = await auth()
  let bookingUserId = session?.user?.id

  if (!bookingUserId) {
    if (!input.anonId) {
      return { status: 'error', errors: ['Authentication required'] }
    }
    // For anonymous bookings: use the site owner's userId to satisfy the FK constraint.
    // The anonId field identifies the actual anonymous customer.
    const site = await prisma.site.findUnique({
      where: { id: input.siteId },
      select: { userId: true },
    })
    if (!site?.userId) {
      return { status: 'error', errors: ['Site not found'] }
    }
    bookingUserId = site.userId
  }

  const site = await prisma.site.findUnique({ where: { id: input.siteId } })
  if (!site) return { status: 'error', errors: ['Site not found'] }

  const from = new Date(input.from)
  const to = new Date(input.to)

  if (from >= to) {
    return { status: 'error', errors: ['End date must be after start date'] }
  }

  // Load rental items to calculate pricing — never trust client-supplied prices
  const rentalItemIds = input.items.map(i => i.rentalItemId)
  const rentalItems = await prisma.rentalItem.findMany({
    where: { id: { in: rentalItemIds }, siteId: input.siteId, active: true },
  })

  if (rentalItems.length !== rentalItemIds.length) {
    return { status: 'error', errors: ['Some items are not available'] }
  }

  const status = (site.rentalPaymentType ?? site.type) === 'paid' ? RENTAL_PENDING : RENTAL_COMPLETE

  const hours = (to.getTime() - from.getTime()) / (1000 * 60 * 60)
  const days = Math.max(1, Math.ceil(hours / 24))

  // Build the booking inputs with DB-sourced prices
  const bookingInputs = input.items.map(cartItem => {
    const rentalItem = rentalItems.find(ri => ri.id === cartItem.rentalItemId)!

    let totalPrice = 0
    if (input.durationType === 'hours' && rentalItem.pricePerHour) {
      totalPrice = rentalItem.pricePerHour * Math.ceil(hours) * cartItem.quantity
    } else if (rentalItem.pricePerDay) {
      totalPrice = rentalItem.pricePerDay * days * cartItem.quantity
    } else if (rentalItem.pricePerHour) {
      totalPrice = rentalItem.pricePerHour * Math.ceil(hours) * cartItem.quantity
    }

    return {
      siteId: input.siteId,
      rentalItemId: cartItem.rentalItemId,
      userId: bookingUserId!,
      from,
      to,
      quantity: cartItem.quantity,
      durationType: input.durationType,
      totalPrice,
      paymentAmount: totalPrice,
      status,
      operationalStatus: OP_RESERVED,
      anonId: input.anonId ?? null,
      guestEmail: input.guestEmail ?? null,
      guestContact: input.guestContact ?? null,
    }
  })

  // Transactional guard: locks RentalItem rows, re-checks availability inside
  // the tx, and creates all bookings atomically — prevents quantity race conditions.
  const result = await createRentalBookingsWithGuard(bookingInputs)

  if (result.outcome === 'unavailable') {
    const unavailableItem = rentalItems.find(ri => ri.id === result.rentalItemId)
    return {
      status: 'error',
      errors: [
        unavailableItem
          ? `Not enough "${unavailableItem.name}" available for the requested time`
          : 'Some items are not available for the requested time',
      ],
    }
  }

  revalidatePath('/sites')
  return { status: 'ok', bookingIds: result.bookingIds }
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