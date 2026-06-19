'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { verifySiteAccess } from '@/lib/auth-helpers'
import prisma from '@repo/data/PrismaCient'
import {
  reserveWithConflictGuard,
  moveReservationWithConflictGuard,
  createRentalBookingsWithGuard,
} from '@repo/data/reservations'
import { issueReservationRefund } from '@repo/data/refund'
import {
  createReservationMolliePayment,
  reverifyAndFinalizeReservation,
} from '@repo/data/reservation-payment'
import { getOpenTill } from '@repo/data/till'
import type { Prisma } from '@prisma/client'
import dayjs from 'dayjs'
import {
  RESERVATION_PAID_IN_CASH,
  RESERVATION_HELD,
  RESERVATION_COMPLETE,
  RESERVATION_PROCESSING,
  RESERVATION_CANCELED,
  RESERVATION_REFUNDED,
  RESERVATION_PAYMENT_FAILED,
  RENTAL_COMPLETE,
  OP_EXPECTED,
  OP_CHECKED_IN,
  OP_WALKED_IN,
  OP_DEPARTED,
  OP_NO_SHOW,
  OP_RESERVED,
  OP_RETURNED,
  OP_PICKED_UP,
  OP_COMP,
  BLOCKING_STATUSES,
} from '@repo/data/reservation-status'

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Thin wrapper around the canonical `verifySiteAccess` helper (lib/auth-helpers.ts).
 * Kept as a local alias so all existing `verifySiteOwnership(siteId, accessKey)` call
 * sites inside this file are untouched; the single-implementation guarantee lives in
 * `verifySiteAccess`.
 */
async function verifySiteOwnership(siteId: string, accessKey?: string) {
  const { userId, error } = await verifySiteAccess(siteId, accessKey)
  return error ? { error } : { userId: userId! }
}

/**
 * Resolve a floor-staff attribution id for stamping on an on-site transaction.
 *
 * The current worker is chosen on the device (a toolbar chip) and passed to the
 * action; we validate it belongs to THIS account before trusting it. Returns the
 * id only when the employee exists and `employee.accountId === accountUserId`
 * (the site owner's userId === the account key). Anything else — unset, unknown,
 * or a cross-account id — resolves to `null` so a stale/spoofed selection is
 * silently dropped rather than blocking the booking or mis-attributing it.
 */
async function resolveEmployeeId(
  employeeId: string | undefined,
  accountUserId: string,
): Promise<string | null> {
  if (!employeeId) return null
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { accountId: true },
  })
  return employee && employee.accountId === accountUserId ? employeeId : null
}

/**
 * End-of-window for a "blocked" (out-of-service) bed. A block is **sticky**: it
 * survives the daily rollover (overlaps every day's manage query) and stays out
 * of online inventory until the operator taps Unblock — modelling Alonso's
 * `desactivada` lifecycle while keeping our "block" vocabulary. Walk-ins/holds
 * keep a today-scoped `to` and still expire via the cleanup cron; a block's `to`
 * is never `< now`, so the cron never sweeps it. A far-future sentinel (not a
 * true "infinity") keeps it a plain timestamp that ordinary date-overlap queries
 * match without special-casing.
 */
const OUT_OF_SERVICE_TO = new Date('2999-12-31T23:59:59.999Z')

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
  applyToPair: boolean = true,
  employeeId?: string
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

  // Expand group/pair siblings FIRST so the conflict guard checks all affected
  // beds atomically (fixes the pair-expansion double-booking: previously the
  // conflict check ran on only the requested itemId, then siblings were added
  // after — so a sibling already booked was invisible to the check).
  const allItemIds = [itemId]
  if (applyToPair) {
    const memberIds = await getGroupMemberIds(itemId)
    for (const mid of memberIds) {
      if (!allItemIds.includes(mid)) allItemIds.push(mid)
    }
  }

  // Record the cash taken so the per-worker till has € (paymentAmount is null on
  // walk-ins today — the till would be countless). Computed from DB chair prices
  // only (never a client value — payments.md); a free site charges nothing.
  const [site, priceRows] = await Promise.all([
    prisma.site.findUnique({ where: { id: siteId }, select: { type: true, price: true } }),
    prisma.inventoryItem.findMany({ where: { id: { in: allItemIds } }, select: { price: true } }),
  ])
  const paymentAmount = site?.type === 'paid'
    ? computeWalkInAmount(priceRows, site.price, fromDate, toDate)
    : 0

  const stampedEmployeeId = await resolveEmployeeId(employeeId, ownership.userId)

  // reserveWithConflictGuard collapses availability-check + create into one
  // $transaction with a SELECT … FOR UPDATE lock on the InventoryItem rows,
  // eliminating the check-then-create race window.
  const result = await reserveWithConflictGuard({
    itemIds: allItemIds,
    siteId,
    userId: ownership.userId,
    employeeId: stampedEmployeeId,
    type: 'days',
    from: fromDate,
    to: toDate,
    status: RESERVATION_PAID_IN_CASH,
    operationalStatus: OP_WALKED_IN,
    checkedInAt: new Date(),
    paymentAmount,
    guestName: guestName?.slice(0, 200) || null,
    internalNotes: internalNotes?.slice(0, 500) || null,
  })

  if (result.outcome === 'conflict') {
    return { status: 'error', errors: ['Sunbed is already reserved for part of this period'] }
  }

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

  // Fast pre-check: reservation exists, belongs to this site, not in a terminal
  // operational state. (The guard also loads the reservation inside the tx — this
  // is a cheap early-fail that avoids acquiring the FOR UPDATE lock unnecessarily.)
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { siteId: true, operationalStatus: true },
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

  // Expand SunbedGroup/pair siblings of the target items BEFORE calling the guard
  // so the conflict check covers all affected beds atomically. Without expansion
  // a sibling of a target item that is already occupied goes undetected.
  const allNewItemIds = [...newItemIds]
  for (const itemId of newItemIds) {
    const memberIds = await getGroupMemberIds(itemId)
    for (const mid of memberIds) {
      if (!allNewItemIds.includes(mid)) allNewItemIds.push(mid)
    }
  }

  // moveReservationWithConflictGuard collapses the conflict check + item swap into
  // one $transaction with SELECT … FOR UPDATE on the target InventoryItem rows,
  // eliminating the check-then-move race that previously allowed double-booking.
  const result = await moveReservationWithConflictGuard(reservationId, allNewItemIds)

  if (result.outcome === 'conflict') {
    return { status: 'error', errors: ['Target bed is already reserved for this period'] }
  }
  if (result.outcome === 'not_found') {
    return { status: 'error', errors: ['Reservation not found'] }
  }

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Move reservation to exact seats (tap-to-move / Cambio de Lugar) ─────────

/**
 * Relocate an occupancy to an EXACT set of destination seats, count-preserving
 * (Alonso's `ul()`: destination.length must equal the reservation's seat count).
 *
 * Unlike `moveReservation`, this does NOT auto-expand the destination's group —
 * the caller passes the precise destination ids (a single seat, or a same-size
 * free group). That keeps a 1-seat booking 1 seat (auto-expansion would grow it
 * onto a destination's pair partner). The same `Reservation` row is re-pointed,
 * so identity, `checkedInAt` clock, payment, and the Invoice are all preserved;
 * no money moves. Race-safe via `moveReservationWithConflictGuard`.
 */
export async function moveReservationToSeats(
  siteId: string,
  reservationId: string,
  destItemIds: string[],
  accessKey?: string
) {
  if (!destItemIds.length) {
    return { status: 'error', errors: ['Select a destination'] }
  }
  if (destItemIds.length > 20) {
    return { status: 'error', errors: ['Too many items (max 20)'] }
  }

  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { siteId: true, operationalStatus: true, items: { select: { id: true } } },
  })
  if (!reservation || reservation.siteId !== siteId) {
    return { status: 'error', errors: ['Reservation not found'] }
  }
  if (([OP_NO_SHOW, OP_DEPARTED] as string[]).includes(reservation.operationalStatus)) {
    return { status: 'error', errors: ['Cannot move a completed reservation'] }
  }

  // Count-preserving 1:1 relocate — the destination must hold exactly the same
  // number of seats the booking occupies.
  if (destItemIds.length !== reservation.items.length) {
    return { status: 'error', errors: ['Destination must be the same number of seats'] }
  }

  // Destinations must exist on this site and be real seats — active (regular) OR
  // pool (group-extra / overflow) seats, since a group booking can span extras.
  const destItems = await prisma.inventoryItem.findMany({
    where: { id: { in: destItemIds }, siteId, status: { in: ['active', 'pool'] } },
    select: { id: true },
  })
  if (destItems.length !== destItemIds.length) {
    return { status: 'error', errors: ['Some destination seats are not available'] }
  }

  // moveReservationWithConflictGuard re-points the reservation's items to exactly
  // destItemIds inside a $transaction with FOR UPDATE + a self-excluding conflict
  // check — no double-book window.
  const result = await moveReservationWithConflictGuard(reservationId, destItemIds)
  if (result.outcome === 'conflict') {
    return { status: 'error', errors: ['Destination is already reserved for this period'] }
  }
  if (result.outcome === 'not_found') {
    return { status: 'error', errors: ['Reservation not found'] }
  }

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Block bed (maintenance / VIP hold) ─────────────────────────────────────

export async function blockBed(
  siteId: string,
  itemId: string,
  notes?: string,
  accessKey?: string,
  applyToPair: boolean = true,
  employeeId?: string
) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  // Expand group/pair siblings FIRST so the conflict check covers all affected
  // beds. Without this, a sibling already occupied would go undetected (the bug).
  const allItemIds = [itemId]
  if (applyToPair) {
    const memberIds = await getGroupMemberIds(itemId)
    for (const mid of memberIds) {
      if (!allItemIds.includes(mid)) allItemIds.push(mid)
    }
  }

  const fromDate = dayjs().startOf('day').toDate()
  // Sticky out-of-service: end the block far in the future so it persists across
  // days and stays out of online inventory until Unblock (see OUT_OF_SERVICE_TO).
  const toDate = OUT_OF_SERVICE_TO

  const stampedEmployeeId = await resolveEmployeeId(employeeId, ownership.userId)

  // reserveWithConflictGuard adds the conflict check that blockBed previously
  // lacked entirely — blocking an already-occupied bed (walk-in, reservation,
  // or existing block) is now rejected rather than creating a duplicate row.
  // With the far-future `to`, the conflict window is [today, ∞): a bed with any
  // future paid booking can't be blocked until that booking is cleared (correct —
  // you can't take a seat out of service while it still owes a guest).
  const result = await reserveWithConflictGuard({
    itemIds: allItemIds,
    siteId,
    userId: ownership.userId,
    employeeId: stampedEmployeeId,
    type: 'days',
    from: fromDate,
    to: toDate,
    status: RESERVATION_PAID_IN_CASH,
    operationalStatus: 'blocked',
    internalNotes: notes?.slice(0, 500) || null,
  })

  if (result.outcome === 'conflict') {
    return { status: 'error', errors: ['Sunbed is already occupied or blocked'] }
  }

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
    // Overlap-with-today (from <= todayEnd && to >= todayStart) matches a sticky
    // block whose `to` is far in the future, not just a same-day window.
    await prisma.reservation.deleteMany({
      where: {
        siteId,
        operationalStatus: 'blocked',
        from: { lte: todayEnd },
        to: { gte: todayStart },
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
        from: { lte: todayEnd },
        to: { gte: todayStart },
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

// ─── Comp bed (complimentary / gratis occupancy) ────────────────────────────

/**
 * Mark a bed as comp (complimentary — given free to a guest, staff, regular, etc.).
 * Structurally identical to a walk-in but distinct in operational status (OP_COMP)
 * so comps never collide with walk-in release queries, and the durable `isComp` flag
 * allows clean analytics reporting independent of operational lifecycle.
 *
 * Revenue impact: paymentAmount=0 → no invoice will be created → automatically
 * excluded from invoice-driven accounting. No accounting code change required.
 */
export async function compBed(
  siteId: string,
  itemId: string,
  accessKey?: string,
  applyToPair: boolean = true,
  guestName?: string,
  notes?: string,
  employeeId?: string
) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const allItemIds = [itemId]
  if (applyToPair) {
    const memberIds = await getGroupMemberIds(itemId)
    for (const mid of memberIds) {
      if (!allItemIds.includes(mid)) allItemIds.push(mid)
    }
  }

  const fromDate = dayjs().startOf('day').toDate()
  const toDate = dayjs().endOf('day').toDate()

  const stampedEmployeeId = await resolveEmployeeId(employeeId, ownership.userId)

  const result = await reserveWithConflictGuard({
    itemIds: allItemIds,
    siteId,
    userId: ownership.userId,
    employeeId: stampedEmployeeId,
    type: 'days',
    from: fromDate,
    to: toDate,
    status: RESERVATION_PAID_IN_CASH,
    operationalStatus: OP_COMP,
    isComp: true,
    paymentAmount: 0,
    guestName: guestName?.slice(0, 200) || null,
    internalNotes: notes?.slice(0, 500) || null,
  })

  if (result.outcome === 'conflict') {
    return { status: 'error', errors: ['Sunbed is already occupied or blocked'] }
  }

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Uncomp bed (end the complimentary occupancy) ───────────────────────────

export async function uncompBed(siteId: string, itemId: string, accessKey?: string, applyToPair: boolean = true) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const todayStart = dayjs().startOf('day').toDate()
  const todayEnd = dayjs().endOf('day').toDate()

  if (applyToPair) {
    // Pair mode: delete the whole comp reservation (frees both seats).
    await prisma.reservation.deleteMany({
      where: {
        siteId,
        operationalStatus: OP_COMP,
        from: { gte: todayStart },
        to: { lte: todayEnd },
        items: { some: { id: itemId } },
      },
    })
  } else {
    // Single-seat mode: if the comp reservation has >1 item, disconnect just
    // this seat; otherwise delete the whole reservation.
    const reservation = await prisma.reservation.findFirst({
      where: {
        siteId,
        operationalStatus: OP_COMP,
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

// ─── Hold bed (lightweight same-day hold, no payment) ───────────────────────

/**
 * Place a lightweight floor hold on a bed for today — "pencil someone in".
 * No payment taken. Operationally identical to an inbound reservation:
 * - `status: held` — distinct from paid-in-cash so it's excluded from revenue
 *   but still occupies the bed via BLOCKING_STATUSES (conflict guard will reject
 *   a second hold on the same bed).
 * - `operationalStatus: expected` — renders in the yellow "booked" lane; the
 *   existing check-in / no-show transitions work unchanged.
 * - `paymentAmount: 0`, no `checkedInAt` (the guest isn't present yet).
 * - Today-only: `from` = start of day, `to` = end of day. The cleanup cron
 *   garbage-collects expired holds the same way it cleans up stale walk-ins.
 */
export async function holdBed(
  siteId: string,
  itemId: string,
  accessKey?: string,
  applyToPair: boolean = true,
  guestName?: string,
  notes?: string,
  employeeId?: string
) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const allItemIds = [itemId]
  if (applyToPair) {
    const memberIds = await getGroupMemberIds(itemId)
    for (const mid of memberIds) {
      if (!allItemIds.includes(mid)) allItemIds.push(mid)
    }
  }

  const fromDate = dayjs().startOf('day').toDate()
  const toDate = dayjs().endOf('day').toDate()

  const stampedEmployeeId = await resolveEmployeeId(employeeId, ownership.userId)

  const result = await reserveWithConflictGuard({
    itemIds: allItemIds,
    siteId,
    userId: ownership.userId,
    employeeId: stampedEmployeeId,
    type: 'days',
    from: fromDate,
    to: toDate,
    status: RESERVATION_HELD,
    operationalStatus: OP_EXPECTED,
    paymentAmount: 0,
    guestName: guestName?.slice(0, 200) || null,
    internalNotes: notes?.slice(0, 500) || null,
  })

  if (result.outcome === 'conflict') {
    return { status: 'error', errors: ['Sunbed is already occupied or blocked'] }
  }

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Convert hold to walk-in (held guest arrives — collect cash) ────────────

/**
 * Convert a staff hold to a paid walk-in IN PLACE.
 *
 * When a held guest arrives the operator taps "Rent" in the Held panel.
 * This updates the existing reservation row to status=paid-in-cash,
 * operationalStatus=walked-in, checkedInAt=now.
 *
 * `until` extends the stay across multiple days. A hold only covers TODAY, so
 * extending past today requires a race-safe availability re-check: we run the
 * find + conflict-check + update atomically in a $transaction with a FOR UPDATE
 * lock on the item rows (mirroring reserveWithConflictGuard). Today-only
 * conversions skip the transaction — the hold already occupies the seat.
 *
 * guestName is updated only when a non-empty value is supplied (preserves the
 * hold's existing guestName when the caller passes nothing).
 */
export async function convertHoldToWalkIn(
  siteId: string,
  itemId: string,
  accessKey?: string,
  guestName?: string,
  until?: string,
  employeeId?: string
) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const todayStart = dayjs().startOf('day').toDate()
  const todayEnd = dayjs().endOf('day').toDate()

  // Validate and compute the end date (same rules as reserveItem).
  let toDate = todayEnd
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

  // The conversion turns a free hold into a paid cash walk-in, so it must record
  // the € for the till (else the converted seat undercounts) and attribute it to
  // the worker who collected. Price from DB only (payments.md); free site → 0.
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { type: true, price: true },
  })
  const stampedEmployeeId = await resolveEmployeeId(employeeId, ownership.userId)

  const updateData = {
    status: RESERVATION_PAID_IN_CASH,
    operationalStatus: OP_WALKED_IN,
    checkedInAt: new Date(),
    to: toDate,
    ...(stampedEmployeeId ? { employeeId: stampedEmployeeId } : {}),
    ...(guestName && guestName.trim() ? { guestName: guestName.trim().slice(0, 200) } : {}),
  }

  if (until && toDate > todayEnd) {
    // Extending beyond today: re-check availability atomically.
    // The hold occupies today only; the extended days are open → a concurrent
    // booking on those days must be blocked before we widen the `to` date.
    const result = await prisma.$transaction(async (tx) => {
      // Step 1: Find the held reservation + its connected items.
      const hold = await tx.reservation.findFirst({
        where: {
          siteId,
          status: RESERVATION_HELD,
          from: { lte: todayEnd },
          to: { gte: todayStart },
          items: { some: { id: itemId } },
        },
        select: {
          id: true,
          items: { select: { id: true, price: true } },
        },
      })

      if (!hold) {
        return { outcome: 'not_found' as const }
      }

      const allItemIds = hold.items.map((i) => i.id)
      const paymentAmount = site?.type === 'paid'
        ? computeWalkInAmount(hold.items, site.price, todayStart, toDate)
        : 0

      // Step 2: Lock those InventoryItem rows FOR UPDATE so concurrent reservations
      // for the same beds in the extended range are serialized behind this tx.
      if (allItemIds.length > 0) {
        await tx.$queryRaw`
          SELECT id FROM "InventoryItem"
          WHERE id = ANY(${allItemIds}::text[])
          FOR UPDATE
        `
      }

      // Step 3: Check for any OTHER blocking reservation overlapping
      // [todayStart, toDate] on those items, excluding this hold itself.
      const conflict = await tx.reservation.findFirst({
        where: {
          siteId,
          status: { in: BLOCKING_STATUSES as string[] },
          operationalStatus: { notIn: [OP_NO_SHOW, OP_DEPARTED] as string[] },
          from: { lte: toDate },
          to: { gte: todayStart },
          items: { some: { id: { in: allItemIds } } },
          id: { not: hold.id },
        },
        select: { id: true },
      })

      if (conflict) {
        return { outcome: 'conflict' as const }
      }

      // Step 4: Update in place — extend the hold and convert it to a walk-in.
      await tx.reservation.update({
        where: { id: hold.id },
        data: { ...updateData, paymentAmount },
      })

      return { outcome: 'updated' as const }
    })

    if (result.outcome === 'not_found') {
      return { status: 'error', errors: ['No held reservation found to convert'] }
    }
    if (result.outcome === 'conflict') {
      return { status: 'error', errors: ['Seat is already reserved for part of this period'] }
    }
  } else {
    // Today-only conversion: the hold already occupies the seat — no conflict
    // re-check needed. Simple find + update outside a transaction.
    const reservation = await prisma.reservation.findFirst({
      where: {
        siteId,
        status: RESERVATION_HELD,
        from: { lte: todayEnd },
        to: { gte: todayStart },
        items: { some: { id: itemId } },
      },
      select: { id: true, items: { select: { price: true } } },
    })

    if (!reservation) {
      return { status: 'error', errors: ['No held reservation found to convert'] }
    }

    const paymentAmount = site?.type === 'paid'
      ? computeWalkInAmount(reservation.items, site.price, todayStart, toDate)
      : 0

    await prisma.reservation.update({
      where: { id: reservation.id },
      data: { ...updateData, paymentAmount },
    })
  }

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Refund reservation (manual, Mollie) ────────────────────────────────────

/**
 * Resolve the PartnerAccount.userId that owns a site's Mollie account.
 * (`PartnerAccount.userId` === the site owner's User id.) Returns null when the
 * site has no connected partner account.
 */
async function resolvePartnerAccountId(siteId: string): Promise<string | null> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { user: { select: { partnerAccount: { select: { userId: true } } } } },
  })
  return site?.user?.partnerAccount?.userId ?? null
}

/**
 * Issue a refund for a paid online/QR reservation, in place — WITHOUT freeing the
 * bed. The booking stays `complete` (the seat is still occupied) and only the
 * durable `refundedAt` marker is stamped. Freeing the seat is the separate
 * `cancelReservation` step; once refunded it terminates the booking as REFUNDED.
 *
 * Decoupling refund from cancel lets staff issue the money-back manually from the
 * cancel confirmation dialog and see it confirmed before committing the cancel.
 *
 * Idempotent: a reservation already carrying `refundedAt` returns ok without
 * calling Mollie again (guards against a double refund on re-tap / re-open).
 */
export async function refundReservation(
  siteId: string,
  itemId: string,
  accessKey?: string
) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const todayStart = dayjs().startOf('day').toDate()
  const todayEnd = dayjs().endOf('day').toDate()

  const reservation = await prisma.reservation.findFirst({
    where: {
      siteId,
      status: RESERVATION_COMPLETE,
      from: { lte: todayEnd },
      to: { gte: todayStart },
      items: { some: { id: itemId } },
    },
    select: { id: true, paymentRef: true, refundedAt: true },
  })

  if (!reservation) {
    return { status: 'error', errors: ['No paid reservation found to refund'] }
  }
  // Idempotent: already refunded → no second Mollie call.
  if (reservation.refundedAt) return { status: 'ok' }

  const partnerAccountId = await resolvePartnerAccountId(siteId)
  const result = await issueReservationRefund(reservation.paymentRef, partnerAccountId)
  if (result.status === 'error') {
    // `needsReconnect` lets the UI offer the Mollie re-consent ("Enable refunds")
    // action for a missing-permission (403) failure, vs a plain retry for transient ones.
    return {
      status: 'error',
      errors: [result.error],
      needsReconnect: result.reason === 'permission',
    }
  }

  await prisma.reservation.update({
    where: { id: reservation.id },
    data: { refundedAt: new Date() },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Cancel reservation (partner-side) ──────────────────────────────────────

/**
 * Cancel a paid online/QR reservation and free the bed.
 *
 * Cancel no longer issues a refund itself — refunding is the separate, manual
 * `refundReservation` action surfaced in the cancel confirmation dialog. Cancel
 * only frees the seat: the terminal status reflects whether a refund was already
 * issued (REFUNDED when `refundedAt` is set, otherwise CANCELED).
 *
 * The reservation row is KEPT for audit; it is never deleted. Idempotent: if the
 * reservation is already in a terminal CANCELED/REFUNDED state, returns ok.
 *
 * Cancel is whole-reservation by design: updating the status row covers all items
 * in the booking regardless of how many seats the reservation spans.
 */
export async function cancelReservation(
  siteId: string,
  itemId: string,
  accessKey?: string
) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const todayStart = dayjs().startOf('day').toDate()
  const todayEnd = dayjs().endOf('day').toDate()

  // Find the active paid reservation for this item (overlap-with-today semantics
  // so multi-day consumer bookings that started before today are matched correctly).
  const reservation = await prisma.reservation.findFirst({
    where: {
      siteId,
      status: RESERVATION_COMPLETE,
      from: { lte: todayEnd },
      to: { gte: todayStart },
      items: { some: { id: itemId } },
    },
    select: { id: true, refundedAt: true },
  })

  if (!reservation) {
    // Idempotent: if already terminal (canceled or refunded), return ok
    const alreadyTerminal = await prisma.reservation.findFirst({
      where: {
        siteId,
        status: { in: [RESERVATION_CANCELED, RESERVATION_REFUNDED] },
        from: { lte: todayEnd },
        to: { gte: todayStart },
        items: { some: { id: itemId } },
      },
      select: { id: true },
    })
    if (alreadyTerminal) return { status: 'ok' }
    return { status: 'error', errors: ['No active reservation found to cancel'] }
  }

  // A refund issued earlier (via refundReservation) sets refundedAt — reflect that
  // in the terminal status so the booking reads as REFUNDED, not merely CANCELED.
  const finalStatus = reservation.refundedAt ? RESERVATION_REFUNDED : RESERVATION_CANCELED

  await prisma.reservation.update({
    where: { id: reservation.id },
    data: { status: finalStatus },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Release hold (lightweight floor hold, no payment) ──────────────────────

/**
 * Release a staff hold (status=held) and free the bed.
 * Mirrors `unblockBed` but targets RESERVATION_HELD status.
 * No payment involved — just deletes the hold record.
 */
export async function releaseHold(siteId: string, itemId: string, accessKey?: string, applyToPair: boolean = true) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const todayStart = dayjs().startOf('day').toDate()
  const todayEnd = dayjs().endOf('day').toDate()

  if (applyToPair) {
    // Pair mode: delete the whole hold reservation (frees both seats).
    await prisma.reservation.deleteMany({
      where: {
        siteId,
        status: RESERVATION_HELD,
        from: { gte: todayStart },
        to: { lte: todayEnd },
        items: { some: { id: itemId } },
      },
    })
  } else {
    // Single-seat mode: if the hold reservation has >1 item, disconnect just
    // this seat (the partner stays held); otherwise delete the whole reservation.
    const reservation = await prisma.reservation.findFirst({
      where: {
        siteId,
        status: RESERVATION_HELD,
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
          where: { id: reservation.id, siteId },
        })
      }
    }
  }

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Collect payment (QR → Mollie) for a walk-in ────────────────────────────

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'

/**
 * Amount owed for a walk-in's chairs, computed from DB prices only (never a
 * client value — payments.md). Mirrors the consumer calc in
 * apps/user/app/sites/[id]/actions.ts: per-seat price (item.price ?? site.price)
 * summed across the reservation's items, times the number of days in [from, to].
 */
function computeWalkInAmount(
  items: { price: number | null }[],
  sitePrice: number | null,
  from: Date,
  to: Date,
): number {
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)))
  const perDay = items.reduce((sum, it) => sum + ((it.price ?? null) || sitePrice || 0), 0)
  return perDay * days
}

/**
 * Begin collecting an online (Mollie) payment for an existing cash walk-in.
 *
 * Computes the amount from DB chair prices, persists it, then creates a Mollie
 * payment on the partner's account (platform fee included) via the shared
 * `@repo/data` helper. The QR shown to the beachgoer encodes the returned
 * `checkoutUrl`. On success the walk-in is left `processing`; the webhook (or the
 * `getCollectStatus` poll) flips it to `complete` + invoices once paid. A failed
 * creation reverts to `paid-in-cash` so the bed is never lost.
 *
 * Demo mode short-circuits to a `pi_demo_` ref that `getCollectStatus` settles
 * as paid on the next poll (no real checkout).
 */
export async function collectReservationPayment(
  siteId: string,
  reservationId: string,
  accessKey?: string,
) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: {
      siteId: true,
      status: true,
      operationalStatus: true,
      anonId: true,
      from: true,
      to: true,
      items: { select: { price: true } },
      site: { select: { type: true, price: true } },
    },
  })
  if (!reservation || reservation.siteId !== siteId) {
    return { status: 'error', errors: ['Reservation not found'] }
  }
  // Walk-in only: a cash walk-in that hasn't started a collection yet.
  if (reservation.operationalStatus !== OP_WALKED_IN || reservation.status !== RESERVATION_PAID_IN_CASH) {
    return { status: 'error', errors: ['Payment can only be collected for a walk-in'] }
  }
  if (reservation.site.type !== 'paid') {
    return { status: 'error', errors: ['This site does not charge for sunbeds'] }
  }

  const amount = computeWalkInAmount(
    reservation.items,
    reservation.site.price,
    reservation.from,
    reservation.to,
  )
  if (amount <= 0) {
    return { status: 'error', errors: ['Nothing to charge for this sunbed'] }
  }

  // Mint an anonId capability so the beachgoer's browser can claim THIS one
  // reservation after paying (the walk-in was partner-created, so it has none) —
  // it then flows through /payment/complete → /reservations/[id] → receipt exactly
  // like an anonymous POS booking. Reuse an existing anonId if one is already set.
  const anonId = reservation.anonId ?? randomUUID()

  // Persist the DB-computed amount (and the new anonId) before creating the
  // payment — the shared helper reads paymentAmount off the reservation row.
  await prisma.reservation.update({
    where: { id: reservationId },
    data: { paymentAmount: amount, ...(reservation.anonId ? {} : { anonId }) },
  })

  // Demo: skip the real provider — assign a demo ref and move to processing.
  if (DEMO_MODE) {
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { paymentRef: `pi_demo_${Date.now()}`, status: RESERVATION_PROCESSING },
    })
    revalidatePath(`/sites/${siteId}/manage`)
    return { status: 'ok', amount, demo: true }
  }

  const consumerAppUrl = process.env.CONSUMER_APP_URL
  if (!consumerAppUrl) {
    return { status: 'error', errors: ['Online payments are not configured (CONSUMER_APP_URL)'] }
  }
  // Standard post-payment redirect (same as every other payment): the beachgoer
  // lands on /payment/complete, which polls then forwards to /reservations/[id].
  const redirectUrl = new URL(
    `/payment/complete?reservationId=${reservationId}&anonId=${anonId}`,
    consumerAppUrl,
  ).toString()
  const webhookUrl = new URL('/api/webhooks/mollie', consumerAppUrl).toString()

  const result = await createReservationMolliePayment(reservationId, {
    redirectUrl,
    webhookUrl,
    metadataExtra: { collect: true },
  })

  if (result.status === 'error') {
    // The shared helper marks payment_failed only on a provider error; for a
    // walk-in we must keep the bed as cash, never strand it as a failed seat.
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { status: RESERVATION_PAID_IN_CASH, paymentRef: null },
    })
    return { status: 'error', errors: [result.error] }
  }

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok', amount, checkoutUrl: result.checkoutUrl }
}

/**
 * Poll the live payment status of a walk-in collection (the manage screen calls
 * this on an interval while the QR is shown). Reads the webhook-updated status
 * and, as a fallback, re-verifies with Mollie: a confirmed payment is finalized
 * (idempotent invoices, status → complete); a failed/expired one reverts to
 * `paid-in-cash` so the walk-in (and the bed) survive.
 */
export async function getCollectStatus(
  siteId: string,
  reservationId: string,
  accessKey?: string,
) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { siteId: true, status: true, paymentRef: true },
  })
  if (!reservation || reservation.siteId !== siteId) {
    return { status: 'error', errors: ['Reservation not found'] }
  }

  if (reservation.status === RESERVATION_COMPLETE) {
    return { status: 'ok', paymentStatus: 'complete' as const }
  }

  if (reservation.status === RESERVATION_PROCESSING && reservation.paymentRef) {
    const fin = await reverifyAndFinalizeReservation(reservationId)
    if (fin.settled === 'complete') {
      revalidatePath(`/sites/${siteId}/manage`)
      return { status: 'ok', paymentStatus: 'complete' as const }
    }
    if (fin.settled === 'failed') {
      // Failed collection → keep the walk-in as cash, free nothing.
      await prisma.reservation.update({
        where: { id: reservationId },
        data: { status: RESERVATION_PAID_IN_CASH, paymentRef: null },
      })
      revalidatePath(`/sites/${siteId}/manage`)
      return { status: 'ok', paymentStatus: 'failed' as const }
    }
    return { status: 'ok', paymentStatus: 'processing' as const }
  }

  return { status: 'ok', paymentStatus: 'cash' as const }
}

/**
 * Abandon an in-flight collection (operator closed the QR before the beachgoer
 * paid). Re-verifies once: a payment that actually went through is finalized
 * (complete + invoices); otherwise the walk-in reverts to `paid-in-cash` and the
 * paymentRef is cleared, so the occupied bed is safe from the PENDING/PROCESSING
 * cleanup cron (which keys on the walk-in's old `createdAt`) and can be
 * re-collected. Idempotent / no-op for a reservation that isn't mid-collection.
 */
export async function cancelCollection(
  siteId: string,
  reservationId: string,
  accessKey?: string,
) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { siteId: true, status: true, paymentRef: true },
  })
  if (!reservation || reservation.siteId !== siteId) {
    return { status: 'error', errors: ['Reservation not found'] }
  }
  // Only a processing collection is abandonable. Anything else (already complete,
  // already cash) is a no-op success.
  if (reservation.status !== RESERVATION_PROCESSING) {
    return { status: 'ok', paymentStatus: reservation.status === RESERVATION_COMPLETE ? 'complete' as const : 'cash' as const }
  }

  if (reservation.paymentRef) {
    const fin = await reverifyAndFinalizeReservation(reservationId)
    if (fin.settled === 'complete') {
      revalidatePath(`/sites/${siteId}/manage`)
      return { status: 'ok', paymentStatus: 'complete' as const }
    }
  }

  // Not paid — revert to a plain cash walk-in (bed kept, re-collectable).
  await prisma.reservation.update({
    where: { id: reservationId },
    data: { status: RESERVATION_PAID_IN_CASH, paymentRef: null },
  })
  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok', paymentStatus: 'cash' as const }
}

// ═══════════════════════════════════════════════════════════════════════════
// TILL ACTIONS (per-worker cash reconciliation)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Read the current worker's OPEN till at this site — cash they've taken since
 * their last `TillClose` (today-scoped). The current worker is client state
 * (the toolbar chip's localStorage), so this is a thin token-gated read of the
 * shared `getOpenTill` aggregation. Validates the worker belongs to the account
 * before reading so a stale/foreign id can't probe another account's till.
 */
export async function getTillStatus(
  siteId: string,
  employeeId: string,
  accessKey?: string,
) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const valid = await resolveEmployeeId(employeeId, ownership.userId)
  if (!valid) return { status: 'error', errors: ['Unknown worker'] }

  const { total, count } = await getOpenTill(siteId, valid)
  return { status: 'ok', total, count }
}

/**
 * Close the current worker's till — the cash-handoff ritual at shift end.
 *
 * Snapshots the open total into a `TillClose` row (worker, site, total, count,
 * closedAt = now); `getOpenTill` then reads zero because it only counts cash
 * taken AFTER the latest close. Closing an already-empty till is a no-op (no
 * snapshot written) so the history isn't littered with empty rows. Idempotent
 * in effect: a second close right after the first sees count 0 → no-op.
 */
export async function closeTill(
  siteId: string,
  employeeId: string,
  accessKey?: string,
) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const valid = await resolveEmployeeId(employeeId, ownership.userId)
  if (!valid) return { status: 'error', errors: ['Unknown worker'] }

  const { total, count } = await getOpenTill(siteId, valid)
  if (count === 0) {
    return { status: 'ok', total, count, closed: false }
  }

  await prisma.tillClose.create({
    data: { siteId, employeeId: valid, totalAmount: total, txnCount: count },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok', total, count, closed: true }
}

// ═══════════════════════════════════════════════════════════════════════════
// GUEST LOOKUP / ARRIVALS (track 010 — the "Guests" host stand)
// ═══════════════════════════════════════════════════════════════════════════

/** How far ahead a name/phone search reaches (the grid only shows today). */
const RESERVATION_SEARCH_WINDOW_DAYS = 90
/** Cap on rows returned so a broad query can't pull the whole reservation book. */
const RESERVATION_SEARCH_CAP = 50

/** A reservation summary row for the Guests sheet (arrivals list + search). */
export type ReservationMatch = {
  id: string
  status: string
  operationalStatus: string
  from: Date
  to: Date
  guestName: string | null
  guestContact: string | null
  internalNotes: string | null
  paymentRef: string | null
  /** Number of seats on the booking (party size). */
  partySize: number
  items: { id: string; number: number; seatLabel: string | null }[]
  /** Email of the linked account (online bookings); null for staff-created. */
  userEmail: string | null
}

/**
 * Floor reservation lookup + today's arrivals for the manage page (track 010).
 *
 * **No `query` → today's ARRIVALS:** bookings overlapping today that are still
 * `expected` (not yet checked in) — online paid (`complete`) + staff holds
 * (`held`). The bed grid only shows today as colour; this is the scannable
 * "who's coming" list staff can prep against.
 *
 * **With `query` → name / phone / email SEARCH** across `[today, +90d]`, so the
 * floor can find a booking that ISN'T on today's grid (future-dated, early
 * arrival) — the gap the token-gated page can't otherwise reach (the only other
 * search, frontdesk `searchAllReservations`, is owner-session-only). Matches
 * `guestName` / `guestContact` and the linked account's email/name,
 * case-insensitively; canceled/refunded excluded; capped + date-sorted.
 *
 * Read-only — no mutation, so no new access-key blast radius. token-or-session.
 */
export async function findReservations(
  siteId: string,
  query?: string,
  accessKey?: string,
) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const todayStart = dayjs().startOf('day').toDate()
  const todayEnd = dayjs().endOf('day').toDate()
  const q = query?.trim()

  const where: Prisma.ReservationWhereInput = q
    ? {
        siteId,
        status: { notIn: [RESERVATION_CANCELED, RESERVATION_REFUNDED] },
        from: { lte: dayjs().add(RESERVATION_SEARCH_WINDOW_DAYS, 'day').endOf('day').toDate() },
        to: { gte: todayStart },
        OR: [
          { guestName: { contains: q, mode: 'insensitive' } },
          { guestContact: { contains: q, mode: 'insensitive' } },
          { user: { email: { contains: q, mode: 'insensitive' } } },
          { user: { name: { contains: q, mode: 'insensitive' } } },
        ],
      }
    : {
        siteId,
        operationalStatus: OP_EXPECTED,
        status: { in: [RESERVATION_COMPLETE, RESERVATION_HELD] },
        from: { lte: todayEnd },
        to: { gte: todayStart },
      }

  const rows = (await prisma.reservation.findMany({
    where,
    select: {
      id: true,
      status: true,
      operationalStatus: true,
      from: true,
      to: true,
      guestName: true,
      guestContact: true,
      internalNotes: true,
      paymentRef: true,
      items: { select: { id: true, number: true, seatLabel: true }, orderBy: { number: 'asc' } },
      user: { select: { email: true } },
    },
    orderBy: { from: 'asc' },
    take: RESERVATION_SEARCH_CAP,
  })) ?? []

  const reservations: ReservationMatch[] = rows.map((r) => ({
    id: r.id,
    status: r.status,
    operationalStatus: r.operationalStatus,
    from: r.from,
    to: r.to,
    guestName: r.guestName,
    guestContact: r.guestContact,
    internalNotes: r.internalNotes,
    paymentRef: r.paymentRef,
    partySize: r.items.length,
    items: r.items,
    userEmail: r.user?.email ?? null,
  }))

  return { status: 'ok' as const, reservations }
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
  employeeId?: string
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

  const stampedEmployeeId = await resolveEmployeeId(input.employeeId, ownership.userId)

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

  // Build booking inputs with DB-fetched pricing.
  // createRentalBookingsWithGuard owns the availability check and all-or-nothing
  // creation inside a transaction — we must NOT recompute money here; just
  // translate the already-computed prices into the guard's input shape.
  const hours = (to.getTime() - from.getTime()) / (1000 * 60 * 60)
  const days = Math.max(1, Math.ceil(hours / 24))

  const bookingInputs = input.items.map(cartItem => {
    const rentalItem = rentalItems.find(ri => ri.id === cartItem.rentalItemId)!

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

    return {
      rentalItemId: cartItem.rentalItemId,
      siteId: input.siteId,
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
      employeeId: stampedEmployeeId,
    }
  })

  // createRentalBookingsWithGuard collapses availability-check + create into one
  // $transaction with SELECT … FOR UPDATE on the RentalItem rows. The second
  // concurrent request blocks until the first commits, then re-aggregates and
  // sees the already-created bookings — eliminating the race that previously
  // allowed total bookings to exceed totalQuantity.
  const guardResult = await createRentalBookingsWithGuard(bookingInputs)

  if (guardResult.outcome === 'unavailable') {
    const unavailableItem = rentalItems.find(ri => ri.id === guardResult.rentalItemId)
    const name = unavailableItem?.name ?? 'Requested item'
    return { status: 'error', errors: [`Not enough "${name}" available`] }
  }

  revalidatePath(`/sites/${input.siteId}/manage`)
  return { status: 'ok', bookingIds: guardResult.bookingIds }
}

// ═══════════════════════════════════════════════════════════════════════════
// POOL SEAT ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

// Pool seats are ad-hoc overflow loungers: status='pool', sentinel coords (0,0),
// number = parcel*10000 + 9900 + seq (e.g. parcel 1 → 19901, 19902…).
// They are invisible to consumers (consumer side filters status:'active') and
// excluded from the headline occupancy summary — tracked only in their own section.

const POOL_BAND_BASE = 9900 // seq starts after this within each parcel's 10k block

/**
 * Computes the next available number in a parcel's pool band.
 * Pool band: parcel*10000 + 9901 to parcel*10000 + 9999 (max 99 seats).
 * Returns { number } on success or { error } when the band is exhausted.
 */
async function nextPoolNumber(
  siteId: string,
  parcel: number
): Promise<{ number: number } | { error: string }> {
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
    return { error: 'Maximum pool seats per parcel reached (99)' }
  }

  return { number: parcel * 10000 + POOL_BAND_BASE + nextSeq }
}

// ─── Create pool seat ────────────────────────────────────────────────────────

export async function createPoolSeat(siteId: string, parcel: number, accessKey?: string) {
  if (!Number.isInteger(parcel) || parcel < 1 || parcel > 9) {
    return { status: 'error', errors: ['Invalid parcel number'] }
  }

  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  // Find the highest existing pool number in this parcel's pool band
  const poolNum = await nextPoolNumber(siteId, parcel)
  if ('error' in poolNum) {
    return { status: 'error', errors: [poolNum.error] }
  }

  await prisma.inventoryItem.create({
    data: {
      siteId,
      userId: ownership.userId,
      number: poolNum.number,
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

// ─── Add extra seat to a sunbed group ────────────────────────────────────────
//
// Creates a status='pool' InventoryItem linked to the anchor item's SunbedGroup.
// If the anchor doesn't have a SunbedGroup yet (legacy paired beds), one is
// created and both the anchor and its pair partner are updated to reference it.

export async function addSeatToGroup(siteId: string, itemId: string, accessKey?: string) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  // Load anchor item with all fields needed for group resolution and pool numbering
  const anchor = await prisma.inventoryItem.findUnique({
    where: { id: itemId },
    select: {
      siteId: true,
      group: true,
      number: true,
      status: true,
      sunbedGroupId: true,
      pairId: true,
      pairedBy: { select: { id: true } },
    },
  })

  if (!anchor || anchor.siteId !== siteId) {
    return { status: 'error', errors: ['Item not found'] }
  }
  // A FREE pool seat (no group) can't seed a group. A GROUP-EXTRA pool seat
  // (already linked to a SunbedGroup) CAN — clicking it adds another extra to the
  // same group, reusing its sunbedGroupId below.
  if (anchor.status === 'pool' && !anchor.sunbedGroupId) {
    return { status: 'error', errors: ['Cannot add a group seat to a free pool seat'] }
  }

  // Compute next pool number before entering the transaction (avoids holding the
  // transaction open while doing a findMany that isn't write-conflicting anyway).
  const poolNum = await nextPoolNumber(siteId, anchor.group)
  if ('error' in poolNum) {
    return { status: 'error', errors: [poolNum.error] }
  }

  const newItem = await prisma.$transaction(async (tx) => {
    let groupId: string

    if (anchor.sunbedGroupId) {
      // Group already exists — use it directly
      groupId = anchor.sunbedGroupId
    } else {
      // Self-heal: create a SunbedGroup and wire up the anchor + its pair partner
      const newGroup = await tx.sunbedGroup.create({ data: { siteId } })
      groupId = newGroup.id

      const pairPartnerId = anchor.pairId ?? anchor.pairedBy?.id ?? null

      // Update the anchor
      await tx.inventoryItem.update({
        where: { id: itemId },
        data: { sunbedGroupId: groupId },
      })

      // Update the pair partner (if any)
      if (pairPartnerId) {
        await tx.inventoryItem.update({
          where: { id: pairPartnerId },
          data: { sunbedGroupId: groupId },
        })
      }
    }

    return tx.inventoryItem.create({
      data: {
        siteId,
        userId: ownership.userId,
        number: poolNum.number,
        status: 'pool',
        group: anchor.group,
        locationLat: '0',
        locationLng: '0',
        schematicX: null,
        schematicY: null,
        itemGroupId: null,
        pairId: null,
        sunbedGroupId: groupId,
      },
    })
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok', itemId: newItem.id }
}

// ─── Remove a group extra seat ────────────────────────────────────────────────
//
// Deletes a status='pool' item that belongs to a SunbedGroup (a group extra).
// Plain pool seats (no sunbedGroupId) must be removed via deletePoolSeat.

export async function removeGroupSeat(siteId: string, itemId: string, accessKey?: string) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const item = await prisma.inventoryItem.findUnique({
    where: { id: itemId },
    select: { siteId: true, status: true, sunbedGroupId: true },
  })

  if (!item || item.siteId !== siteId) {
    return { status: 'error', errors: ['Item not found'] }
  }
  if (item.status !== 'pool' || item.sunbedGroupId == null) {
    return { status: 'error', errors: ['Item is not a group extra seat'] }
  }

  // Reject if the seat has an active reservation today
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

// ─── Remove failed reservation (payment never completed) ─────────────────────

/**
 * Permanently deletes a failed-payment reservation and frees the seat.
 *
 * Only targets reservations whose status is RESERVATION_PAYMENT_FAILED
 * ('payment_failed') or the legacy literal 'error'. No refund is issued —
 * these reservations never collected money.
 *
 * The guard (`status === RESERVATION_PAYMENT_FAILED || status === 'error'`)
 * ensures this action can NEVER delete a paid, held, or active reservation.
 *
 * After deletion, `revalidatePath` refreshes the manage page so the seat
 * appears free immediately.
 */
export async function removeFailedReservation(
  siteId: string,
  reservationId: string,
  accessKey?: string
) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { siteId: true, status: true },
  })

  if (!reservation || reservation.siteId !== siteId) {
    return { status: 'error', errors: ['Reservation not found'] }
  }

  // Guard: only delete genuinely failed reservations — never paid/held/active ones.
  const isFailed = reservation.status === RESERVATION_PAYMENT_FAILED || reservation.status === 'error'
  if (!isFailed) {
    return { status: 'error', errors: ['Reservation is not in a failed-payment state'] }
  }

  await prisma.reservation.deleteMany({
    where: { id: reservationId, siteId },
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}