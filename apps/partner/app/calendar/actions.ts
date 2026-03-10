'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import dayjs from 'dayjs'
import {
  RESERVATION_COMPLETE,
  RESERVATION_PAID_IN_CASH,
  RESERVATION_CANCELED,
  OP_EXPECTED,
  OP_NO_SHOW,
  OP_DEPARTED,
} from '@repo/data/reservation-status'

/**
 * Create a partner-initiated reservation (phone booking, walk-in pre-reserve, VIP hold).
 *
 * The partner selects:
 *   - date range (from / to)
 *   - sunbed item IDs
 *   - payment type: 'cash' (pay on arrival) or 'free' (complimentary)
 *   - optional guest info + notes
 *
 * The reservation is created with:
 *   - status: 'paid-in-cash' (cash) or 'complete' (free)
 *   - operationalStatus: 'expected' (guest hasn't arrived yet)
 *
 * Availability is checked to prevent double-booking.
 */
export async function createPartnerReservation(data: {
  siteId: string
  itemIds: string[]
  from: string   // ISO date string (YYYY-MM-DD)
  to: string     // ISO date string (YYYY-MM-DD)
  paymentType: 'cash' | 'free'
  guestName?: string
  guestContact?: string
  internalNotes?: string
}) {
  const session = await auth()
  if (!session?.user) {
    return { status: 'error', errors: ['Not authenticated'] }
  }

  // Verify the partner owns this site
  const site = await prisma.site.findUnique({
    where: { id: data.siteId },
    select: { userId: true },
  })
  if (!site || site.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  if (!data.itemIds.length) {
    return { status: 'error', errors: ['Select at least one sunbed'] }
  }

  const fromDate = dayjs(data.from).startOf('day').toDate()
  const toDate = dayjs(data.to).endOf('day').toDate()

  if (fromDate > toDate) {
    return { status: 'error', errors: ['From date must be before to date'] }
  }

  // Verify items belong to this site and are active
  const items = await prisma.inventoryItem.findMany({
    where: {
      id: { in: data.itemIds },
      siteId: data.siteId,
      status: 'active',
    },
    select: { id: true },
  })

  if (items.length !== data.itemIds.length) {
    return { status: 'error', errors: ['Some sunbeds not found or inactive'] }
  }

  // Check availability — no overlapping active reservations
  const conflicting = await prisma.reservation.findFirst({
    where: {
      siteId: data.siteId,
      status: { notIn: [RESERVATION_CANCELED] },
      operationalStatus: { notIn: [OP_NO_SHOW, OP_DEPARTED] },
      from: { lte: toDate },
      to: { gte: fromDate },
      items: { some: { id: { in: data.itemIds } } },
    },
  })

  if (conflicting) {
    return { status: 'error', errors: ['One or more sunbeds are already reserved for this period'] }
  }

  // Also include paired items automatically
  const allItemIds: { id: string }[] = []
  for (const itemId of data.itemIds) {
    allItemIds.push({ id: itemId })
    const item = await prisma.inventoryItem.findUnique({
      where: { id: itemId },
      include: { pairedBy: true },
    })
    if (item?.pairedBy) {
      allItemIds.push({ id: item.pairedBy.id })
    } else if (item?.pairId) {
      allItemIds.push({ id: item.pairId })
    }
  }

  // Deduplicate
  const uniqueItemIds = [...new Map(allItemIds.map(i => [i.id, i])).values()]

  const status = data.paymentType === 'free' ? RESERVATION_COMPLETE : RESERVATION_PAID_IN_CASH

  await prisma.reservation.create({
    data: {
      userId: session.user.id,
      type: 'days',
      from: fromDate,
      to: toDate,
      siteId: data.siteId,
      status,
      operationalStatus: OP_EXPECTED,
      guestName: data.guestName?.slice(0, 200) || null,
      guestContact: data.guestContact?.slice(0, 200) || null,
      internalNotes: data.internalNotes?.slice(0, 500) || null,
      items: { connect: uniqueItemIds },
    },
  })

  revalidatePath('/calendar')
  revalidatePath(`/sites/${data.siteId}/manage`)

  return { status: 'ok' }
}

/**
 * Get available sunbeds for a given site and date range.
 * Used by the calendar create-reservation form.
 */
export async function getAvailableSunbeds(
  siteId: string,
  from: string,
  to: string,
) {
  const session = await auth()
  if (!session?.user) {
    return { status: 'error', errors: ['Not authenticated'], items: [] }
  }

  // Verify the partner owns this site
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { userId: true },
  })
  if (!site || site.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'], items: [] }
  }

  const fromDate = dayjs(from).startOf('day').toDate()
  const toDate = dayjs(to).endOf('day').toDate()

  // Get all active inventory items
  const allItems = await prisma.inventoryItem.findMany({
    where: { siteId, status: 'active' },
    orderBy: { number: 'asc' },
    select: { id: true, number: true, category: true, pairId: true },
  })

  // Get item IDs that have overlapping reservations
  const reservedItems = await prisma.reservation.findMany({
    where: {
      siteId,
      status: { notIn: [RESERVATION_CANCELED] },
      operationalStatus: { notIn: [OP_NO_SHOW, OP_DEPARTED] },
      from: { lte: toDate },
      to: { gte: fromDate },
    },
    select: { items: { select: { id: true } } },
  })

  const reservedIds = new Set(reservedItems.flatMap(r => r.items.map(i => i.id)))

  const items = allItems
    .filter(i => !reservedIds.has(i.id))
    .map(i => ({
      id: i.id,
      number: i.number,
      category: i.category,
      pairId: i.pairId,
    }))

  return { status: 'ok', items }
}
