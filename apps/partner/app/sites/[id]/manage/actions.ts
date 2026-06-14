'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import dayjs from 'dayjs'
import {
  RESERVATION_PAID_IN_CASH,
  RESERVATION_COMPLETE,
  RESERVATION_CANCELED,
  RENTAL_COMPLETE,
  RENTAL_CANCELED,
  OP_EXPECTED,
  OP_CHECKED_IN,
  OP_WALKED_IN,
  OP_DEPARTED,
  OP_NO_SHOW,
  OP_RESERVED,
  OP_RETURNED,
  OP_PICKED_UP,
} from '@repo/data/reservation-status'

// ─── Helpers ────────────────────────────────────────────────────────────────

async function verifySiteOwnership(siteId: string, accessKey?: string) {
  // Token-gated access for manage page (staff without login)
  if (accessKey) {
    const token = await prisma.securityToken.findUnique({
      where: {
        id: accessKey,
        expires: { gt: new Date() },
        resources: { hasSome: ['all', 'manage_site'] },
      },
    })
    if (!token) return { error: 'Invalid or expired access key' }
    // Verify the token belongs to this site's owner
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { userId: true },
    })
    if (!site || site.userId !== token.userId) return { error: 'Not authorized' }
    return { userId: site.userId }
  }

  // Session-based access for logged-in partners
  const session = await auth()
  if (!session?.user) return { error: 'Not authenticated' }
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { userId: true },
  })
  if (!site || site.userId !== session.user.id) return { error: 'Not authorized' }
  return { userId: session.user.id }
}

/**
 * Returns all other member IDs of the item's SunbedGroup.
 * Falls back to pairId/pairedBy for beds that pre-date SunbedGroup migration.
 * For a 2-member group this returns exactly one id — identical to the old
 * getPairItemId behaviour.
 */
async function getGroupMemberIds(itemId: string): Promise<string[]> {
  const item = await prisma.inventoryItem.findUnique({
    where: { id: itemId },
    select: {
      pairId: true,
      sunbedGroupId: true,
      pairedBy: { select: { id: true } },
    },
  })
  if (!item) return []

  // Prefer SunbedGroup (authoritative for co-booking) when present
  if (item.sunbedGroupId) {
    const siblings = await prisma.inventoryItem.findMany({
      where: { sunbedGroupId: item.sunbedGroupId, id: { not: itemId } },
      select: { id: true },
    })
    return siblings.map((s) => s.id)
  }

  // Fallback: legacy pairId / pairedBy self-relation
  if (item.pairedBy) return [item.pairedBy.id]
  if (item.pairId) return [item.pairId]
  return []
}

// ─── Walk-in: Place a customer on an empty bed ──────────────────────────────

export async function reserveItem(
  siteId: string,
  itemId: string,
  guestName?: string,
  internalNotes?: string,
  accessKey?: string,
  until?: string,
  applyToPair: boolean = true
) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  // The guest is being seated now, so the stay always starts today. `until`
  // optionally extends it across multiple days; omitted means today only.
  const fromDate = dayjs().startOf('day').toDate()
  let toDate = dayjs().endOf('day').toDate()
  if (until) {
    if (isNaN(Date.parse(until))) {
      return { status: 'error', errors: ['Invalid date format'] }
    }
    const days = dayjs(until).startOf('day').diff(dayjs().startOf('day'), 'day')
    if (days < 0) {
      return { status: 'error', errors: ['End date cannot be in the past'] }
    }
    if (days > 90) {
      return { status: 'error', errors: ['Date range cannot exceed 90 days'] }
    }
    toDate = dayjs(until).endOf('day').toDate()
  }

  const itemIds = [{ id: itemId }]
  if (applyToPair) {
    const memberIds = await getGroupMemberIds(itemId)
    for (const mid of memberIds) itemIds.push({ id: mid })
  }

  // Reject if the bed (or its group siblings) are already reserved on any day in the range.
  // The today-only case can't conflict — the Reserve action is only offered for
  // beds that are free today — but a multi-day hold must not collide with an
  // existing future booking.
  const conflicting = await prisma.reservation.findFirst({
    where: {
      siteId,
      status: { notIn: [RESERVATION_CANCELED] },
      operationalStatus: { notIn: [OP_NO_SHOW, OP_DEPARTED] },
      from: { lte: toDate },
      to: { gte: fromDate },
      items: { some: { id: { in: itemIds.map(i => i.id) } } },
    },
  })
  if (conflicting) {
    return { status: 'error', errors: ['Sunbed is already reserved for part of this period'] }
  }

  await prisma.reservation.create({
    data: {
      userId: ownership.userId,
      type: 'days',
      from: fromDate,
      to: toDate,
      siteId,
      status: RESERVATION_PAID_IN_CASH,
      operationalStatus: OP_WALKED_IN,
      checkedInAt: new Date(),
      guestName: guestName?.slice(0, 200) || null,
      internalNotes: internalNotes?.slice(0, 500) || null,
      items: { connect: itemIds },
    },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Release bed: walk-in departs or no-show ────────────────────────────────

export async function unreserveItem(siteId: string, itemId: string, accessKey?: string, applyToPair: boolean = true) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const todayStart = dayjs().startOf('day').toDate()
  const todayEnd = dayjs().endOf('day').toDate()

  if (applyToPair) {
    // Pair mode: delete the whole walk-in reservation (frees both seats).
    // For walk-ins (paid-in-cash), delete them entirely (no invoice trail).
    // Use overlap-with-today semantics so multi-day walk-ins (to > todayEnd)
    // and in-progress stays (from < todayStart) are matched correctly.
    const result = await prisma.reservation.deleteMany({
      where: {
        siteId,
        status: RESERVATION_PAID_IN_CASH,
        operationalStatus: OP_WALKED_IN,
        from: { lte: todayEnd },
        to: { gte: todayStart },
        items: { some: { id: itemId } },
      },
    })

    if (result.count === 0) {
      return { status: 'error', errors: ['No walk-in reservation found to release'] }
    }
  } else {
    // Single-seat mode: if the reservation has >1 item, disconnect just this
    // seat (the partner stays walked-in); otherwise delete the whole reservation.
    const reservation = await prisma.reservation.findFirst({
      where: {
        siteId,
        status: RESERVATION_PAID_IN_CASH,
        operationalStatus: OP_WALKED_IN,
        from: { lte: todayEnd },
        to: { gte: todayStart },
        items: { some: { id: itemId } },
      },
      include: { items: true },
    })

    if (!reservation) {
      return { status: 'error', errors: ['No walk-in reservation found to release'] }
    }

    if (reservation.items.length > 1) {
      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { items: { disconnect: [{ id: itemId }] } },
      })
    } else {
      await prisma.reservation.deleteMany({
        where: {
          id: reservation.id,
          siteId,
        },
      })
    }
  }

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Check-in: customer arrived for their booking ───────────────────────────

export async function checkInReservation(siteId: string, reservationId: string, accessKey?: string) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { siteId: true, operationalStatus: true },
  })
  if (!reservation || reservation.siteId !== siteId) {
    return { status: 'error', errors: ['Reservation not found'] }
  }
  if (reservation.operationalStatus !== OP_EXPECTED) {
    return { status: 'error', errors: [`Cannot check in from status: ${reservation.operationalStatus}`] }
  }

  await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      operationalStatus: OP_CHECKED_IN,
      checkedInAt: new Date(),
    },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Mark departed: customer left ───────────────────────────────────────────

export async function markDeparted(siteId: string, reservationId: string, accessKey?: string) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { siteId: true, operationalStatus: true },
  })
  if (!reservation || reservation.siteId !== siteId) {
    return { status: 'error', errors: ['Reservation not found'] }
  }
  if (!([OP_CHECKED_IN, OP_WALKED_IN] as string[]).includes(reservation.operationalStatus)) {
    return { status: 'error', errors: [`Cannot mark departed from: ${reservation.operationalStatus}`] }
  }

  await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      operationalStatus: OP_DEPARTED,
      departedAt: new Date(),
    },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Mark no-show: customer didn't arrive ───────────────────────────────────

export async function markNoShow(siteId: string, reservationId: string, accessKey?: string) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { siteId: true, operationalStatus: true },
  })
  if (!reservation || reservation.siteId !== siteId) {
    return { status: 'error', errors: ['Reservation not found'] }
  }
  if (reservation.operationalStatus !== OP_EXPECTED) {
    return { status: 'error', errors: [`Cannot mark no-show from: ${reservation.operationalStatus}`] }
  }

  await prisma.reservation.update({
    where: { id: reservationId },
    data: { operationalStatus: OP_NO_SHOW },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Update internal notes ──────────────────────────────────────────────────

export async function updateReservationNotes(
  siteId: string,
  reservationId: string,
  notes: string,
  accessKey?: string
) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { siteId: true },
  })
  if (!reservation || reservation.siteId !== siteId) {
    return { status: 'error', errors: ['Reservation not found'] }
  }

  await prisma.reservation.update({
    where: { id: reservationId },
    data: { internalNotes: notes.slice(0, 500) || null },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Move reservation to different beds ─────────────────────────────────────

export async function moveReservation(
  siteId: string,
  reservationId: string,
  newItemIds: string[],
  accessKey?: string
) {
  if (!newItemIds.length) {
    return { status: 'error', errors: ['Select at least one sunbed'] }
  }
  if (newItemIds.length > 20) {
    return { status: 'error', errors: ['Too many items (max 20)'] }
  }

  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { items: true },
  })
  if (!reservation || reservation.siteId !== siteId) {
    return { status: 'error', errors: ['Reservation not found'] }
  }
  if (([OP_NO_SHOW, OP_DEPARTED] as string[]).includes(reservation.operationalStatus)) {
    return { status: 'error', errors: ['Cannot move a completed reservation'] }
  }

  // Verify new items belong to this site and are active
  const newItems = await prisma.inventoryItem.findMany({
    where: { id: { in: newItemIds }, siteId, status: 'active' },
  })
  if (newItems.length !== newItemIds.length) {
    return { status: 'error', errors: ['Some items not found or inactive'] }
  }

  // Disconnect old items, connect new ones
  await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      items: {
        disconnect: reservation.items.map(i => ({ id: i.id })),
        connect: newItemIds.map(id => ({ id })),
      },
    },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Block bed (maintenance / VIP hold) ─────────────────────────────────────

export async function blockBed(
  siteId: string,
  itemId: string,
  notes?: string,
  accessKey?: string,
  applyToPair: boolean = true
) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const itemIds = [{ id: itemId }]
  if (applyToPair) {
    const memberIds = await getGroupMemberIds(itemId)
    for (const mid of memberIds) itemIds.push({ id: mid })
  }

  await prisma.reservation.create({
    data: {
      userId: ownership.userId,
      type: 'days',
      from: dayjs().startOf('day').toDate(),
      to: dayjs().endOf('day').toDate(),
      siteId,
      status: RESERVATION_PAID_IN_CASH,
      operationalStatus: 'blocked',
      internalNotes: notes?.slice(0, 500) || null,
      items: { connect: itemIds },
    },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Unblock bed ────────────────────────────────────────────────────────────

export async function unblockBed(siteId: string, itemId: string, accessKey?: string, applyToPair: boolean = true) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const todayStart = dayjs().startOf('day').toDate()
  const todayEnd = dayjs().endOf('day').toDate()

  if (applyToPair) {
    // Pair mode: delete the whole block reservation (frees both seats).
    await prisma.reservation.deleteMany({
      where: {
        siteId,
        operationalStatus: 'blocked',
        from: { gte: todayStart },
        to: { lte: todayEnd },
        items: { some: { id: itemId } },
      },
    })
  } else {
    // Single-seat mode: if the block reservation has >1 item, disconnect just
    // this seat (the partner stays blocked); otherwise delete the whole reservation.
    const reservation = await prisma.reservation.findFirst({
      where: {
        siteId,
        operationalStatus: 'blocked',
        from: { gte: todayStart },
        to: { lte: todayEnd },
        items: { some: { id: itemId } },
      },
      include: { items: true },
    })

    if (reservation) {
      if (reservation.items.length > 1) {
        await prisma.reservation.update({
          where: { id: reservation.id },
          data: { items: { disconnect: [{ id: itemId }] } },
        })
      } else {
        await prisma.reservation.deleteMany({
          where: {
            id: reservation.id,
            siteId,
          },
        })
      }
    }
  }

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ═══════════════════════════════════════════════════════════════════════════
// RENTAL BOOKING ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

// ─── Mark rental picked up ──────────────────────────────────────────────────

export async function markRentalPickedUp(siteId: string, bookingId: string, accessKey?: string) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const booking = await prisma.rentalBooking.findUnique({
    where: { id: bookingId },
    select: { siteId: true, operationalStatus: true },
  })
  if (!booking || booking.siteId !== siteId) {
    return { status: 'error', errors: ['Booking not found'] }
  }
  if (booking.operationalStatus !== OP_RESERVED) {
    return { status: 'error', errors: [`Cannot pick up from status: ${booking.operationalStatus}`] }
  }

  await prisma.rentalBooking.update({
    where: { id: bookingId },
    data: {
      operationalStatus: OP_PICKED_UP,
      pickedUpAt: new Date(),
    },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Mark rental returned ───────────────────────────────────────────────────

export async function markRentalReturned(siteId: string, bookingId: string, accessKey?: string) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const booking = await prisma.rentalBooking.findUnique({
    where: { id: bookingId },
    select: { siteId: true, operationalStatus: true },
  })
  if (!booking || booking.siteId !== siteId) {
    return { status: 'error', errors: ['Booking not found'] }
  }
  if (booking.operationalStatus !== OP_PICKED_UP) {
    return { status: 'error', errors: [`Cannot return from status: ${booking.operationalStatus}`] }
  }

  await prisma.rentalBooking.update({
    where: { id: bookingId },
    data: {
      operationalStatus: OP_RETURNED,
      returnedAt: new Date(),
    },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Create walk-in rental ──────────────────────────────────────────────────

export async function createWalkInRental(input: {
  siteId: string
  items: { rentalItemId: string; quantity: number }[]
  durationType: 'hours' | 'days'
  hours?: number
  guestName?: string
  paymentType: 'cash' | 'free'
  accessKey?: string
}) {
  // Input validation
  if (!input.items.length) {
    return { status: 'error', errors: ['Select at least one item'] }
  }
  if (input.items.length > 20) {
    return { status: 'error', errors: ['Too many items (max 20)'] }
  }
  if (!['hours', 'days'].includes(input.durationType)) {
    return { status: 'error', errors: ['Invalid duration type'] }
  }
  if (!['cash', 'free'].includes(input.paymentType)) {
    return { status: 'error', errors: ['Invalid payment type'] }
  }
  for (const item of input.items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) {
      return { status: 'error', errors: ['Quantity must be 1–100'] }
    }
  }
  if (input.hours !== undefined && (isNaN(Number(input.hours)) || Number(input.hours) < 1 || Number(input.hours) > 24)) {
    return { status: 'error', errors: ['Hours must be 1–24'] }
  }

  const ownership = await verifySiteOwnership(input.siteId, input.accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const now = new Date()
  const from = now
  const to = input.durationType === 'days'
    ? dayjs(now).endOf('day').toDate()
    : dayjs(now).add(input.hours || 1, 'hour').toDate()

  // Load rental items to calculate pricing
  const rentalItemIds = input.items.map(i => i.rentalItemId)
  const rentalItems = await prisma.rentalItem.findMany({
    where: { id: { in: rentalItemIds }, siteId: input.siteId, active: true },
  })

  if (rentalItems.length !== rentalItemIds.length) {
    return { status: 'error', errors: ['Some items are not available'] }
  }

  // Check availability
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

    const inUse = bookedQty._sum?.quantity || 0
    const available = rentalItem.totalQuantity - inUse
    if (cartItem.quantity > available) {
      return {
        status: 'error',
        errors: [`Only ${available} of "${rentalItem.name}" available`],
      }
    }
  }

  // Create bookings
  const bookings = []
  for (const cartItem of input.items) {
    const rentalItem = rentalItems.find(ri => ri.id === cartItem.rentalItemId)!

    const hours = (to.getTime() - from.getTime()) / (1000 * 60 * 60)
    const days = Math.max(1, Math.ceil(hours / 24))

    let totalPrice = 0
    if (input.paymentType === 'free') {
      totalPrice = 0
    } else if (input.durationType === 'hours' && rentalItem.pricePerHour) {
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
        userId: ownership.userId,
        from,
        to,
        quantity: cartItem.quantity,
        durationType: input.durationType,
        totalPrice,
        paymentAmount: totalPrice,
        status: input.paymentType === 'cash' ? RESERVATION_PAID_IN_CASH : RENTAL_COMPLETE,
        operationalStatus: OP_PICKED_UP,
        pickedUpAt: new Date(),
        guestName: input.guestName?.slice(0, 200) || null,
      },
    })
    bookings.push(booking)
  }

  revalidatePath(`/sites/${input.siteId}/manage`)
  return { status: 'ok', bookingIds: bookings.map(b => b.id) }
}

// ═══════════════════════════════════════════════════════════════════════════
// POOL SEAT ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

// Pool seats are ad-hoc overflow loungers: status='pool', sentinel coords (0,0),
// number = parcel*10000 + 9900 + seq (e.g. parcel 1 → 19901, 19902…).
// They are invisible to consumers (consumer side filters status:'active') and
// excluded from the headline occupancy summary — tracked only in their own section.

const POOL_BAND_BASE = 9900 // seq starts after this within each parcel's 10k block

// ─── Create pool seat ────────────────────────────────────────────────────────

export async function createPoolSeat(siteId: string, parcel: number, accessKey?: string) {
  if (!Number.isInteger(parcel) || parcel < 1 || parcel > 9) {
    return { status: 'error', errors: ['Invalid parcel number'] }
  }

  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  // Find the highest existing pool number in this parcel's pool band
  // Pool band: parcel*10000 + 9901 to parcel*10000 + 9999
  const bandMin = parcel * 10000 + POOL_BAND_BASE + 1
  const bandMax = parcel * 10000 + 9999

  const existing = await prisma.inventoryItem.findMany({
    where: {
      siteId,
      status: 'pool',
      group: parcel,
      number: { gte: bandMin, lte: bandMax },
    },
    select: { number: true },
    orderBy: { number: 'desc' },
  })

  const maxSeq = existing.length > 0 ? existing[0]!.number - (parcel * 10000 + POOL_BAND_BASE) : 0
  const nextSeq = maxSeq + 1

  if (nextSeq > 99) {
    return { status: 'error', errors: ['Maximum pool seats per parcel reached (99)'] }
  }

  const number = parcel * 10000 + POOL_BAND_BASE + nextSeq

  await prisma.inventoryItem.create({
    data: {
      siteId,
      userId: ownership.userId,
      number,
      status: 'pool',
      group: parcel,
      locationLat: '0',
      locationLng: '0',
      schematicX: null,
      schematicY: null,
      itemGroupId: null,
      pairId: null,
    },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Delete pool seat ────────────────────────────────────────────────────────

export async function deletePoolSeat(siteId: string, itemId: string, accessKey?: string) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  // Load item and verify it belongs to this site and is a pool seat
  const item = await prisma.inventoryItem.findUnique({
    where: { id: itemId },
    select: { siteId: true, status: true, number: true },
  })
  if (!item || item.siteId !== siteId) {
    return { status: 'error', errors: ['Item not found'] }
  }
  if (item.status !== 'pool') {
    return { status: 'error', errors: ['Item is not a pool seat'] }
  }

  // Reject if the seat has an active reservation (not departed/no-show)
  const todayStart = dayjs().startOf('day').toDate()
  const todayEnd = dayjs().endOf('day').toDate()
  const activeReservation = await prisma.reservation.findFirst({
    where: {
      siteId,
      from: { lte: todayEnd },
      to: { gte: todayStart },
      operationalStatus: { notIn: ['departed', 'no-show'] },
      items: { some: { id: itemId } },
    },
  })
  if (activeReservation) {
    return { status: 'error', errors: ['Release the seat before removing it'] }
  }

  await prisma.inventoryItem.delete({ where: { id: itemId } })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}