'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { reserveWithConflictGuard } from '@repo/data/reservations'
import dayjs from 'dayjs'
import {
  RESERVATION_COMPLETE,
  RESERVATION_PAID_IN_CASH,
  RESERVATION_CANCELED,
  OP_EXPECTED,
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

  // Input validation
  if (!data.itemIds.length) {
    return { status: 'error', errors: ['Select at least one sunbed'] }
  }
  if (data.itemIds.length > 50) {
    return { status: 'error', errors: ['Too many sunbeds (max 50)'] }
  }
  if (!['cash', 'free'].includes(data.paymentType)) {
    return { status: 'error', errors: ['Invalid payment type'] }
  }
  if (!data.from || !data.to || isNaN(Date.parse(data.from)) || isNaN(Date.parse(data.to))) {
    return { status: 'error', errors: ['Invalid date format'] }
  }

  const fromDate = dayjs(data.from).startOf('day').toDate()
  const toDate = dayjs(data.to).endOf('day').toDate()

  if (fromDate > toDate) {
    return { status: 'error', errors: ['From date must be before to date'] }
  }

  // Max 365-day range
  const diffDays = dayjs(data.to).diff(dayjs(data.from), 'day')
  if (diffDays > 365) {
    return { status: 'error', errors: ['Date range cannot exceed 365 days'] }
  }

  // Verify the partner owns this site
  const site = await prisma.site.findUnique({
    where: { id: data.siteId },
    select: { userId: true },
  })
  if (!site || site.userId !== session.user.id) {
    return { status: 'error', errors: ['Not authorized'] }
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

  // Expand group/pair siblings FIRST — the conflict check must cover ALL beds
  // that will be reserved, not just the requested itemIds. Previously, the
  // expansion happened after the conflict check, so a sibling already booked
  // was invisible to the guard (the pair-expansion double-booking bug).
  const expandedIdSet = new Set<string>(data.itemIds)
  for (const itemId of data.itemIds) {
    const item = await prisma.inventoryItem.findUnique({
      where: { id: itemId },
      select: { sunbedGroupId: true, pairId: true, pairedBy: { select: { id: true } } },
    })
    if (item?.sunbedGroupId) {
      // SunbedGroup is authoritative — include all other members
      const siblings = await prisma.inventoryItem.findMany({
        where: { sunbedGroupId: item.sunbedGroupId, id: { not: itemId } },
        select: { id: true },
      })
      for (const s of siblings) expandedIdSet.add(s.id)
    } else if (item?.pairedBy) {
      // Legacy fallback: pairedBy self-relation
      expandedIdSet.add(item.pairedBy.id)
    } else if (item?.pairId) {
      // Legacy fallback: pairId self-relation
      expandedIdSet.add(item.pairId)
    }
  }

  const allItemIds = [...expandedIdSet]

  const status = data.paymentType === 'free' ? RESERVATION_COMPLETE : RESERVATION_PAID_IN_CASH

  // reserveWithConflictGuard collapses conflict-check + create into one
  // $transaction with a SELECT … FOR UPDATE lock on the InventoryItem rows.
  // Passing the fully-expanded allItemIds means the conflict check now covers
  // both the requested beds AND their group/pair siblings.
  const guardResult = await reserveWithConflictGuard({
    itemIds: allItemIds,
    siteId: data.siteId,
    userId: session.user.id,
    type: 'days',
    from: fromDate,
    to: toDate,
    status,
    operationalStatus: OP_EXPECTED,
    guestName: data.guestName?.slice(0, 200) || null,
    guestContact: data.guestContact?.slice(0, 200) || null,
    internalNotes: data.internalNotes?.slice(0, 500) || null,
  })

  if (guardResult.outcome === 'conflict') {
    return { status: 'error', errors: ['One or more sunbeds are already reserved for this period'] }
  }

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
      // Operational status does NOT free a bed — a no-show/departed reservation
      // still blocks its date range (track 012); reuse via explicit release.
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
