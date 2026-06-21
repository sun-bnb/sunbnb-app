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
import {
  createRentalBookingMolliePayment,
  reverifyAndFinalizeRentalBooking,
} from '@repo/data/rental-payment'
import { getOpenTill, recordSettlement, voidSettlementsForReservation, voidSettlementsForRentalBooking } from '@repo/data/till'
import { applyDayTransition } from './reservation-day'
import { siteDayKey } from '@repo/data/site-day'
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
  RENTAL_PROCESSING,
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
async function verifySiteOwnership(
  siteId: string,
  accessKey?: string,
): Promise<{ error: string } | { userId: string }> {
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

// ─── Per-day status helpers ──────────────────────────────────────────────────

/**
 * Returns the operationalStatus from today's ReservationDay row, or null when
 * no row exists yet (row will be created lazily by resolveTodayRow / page load).
 * Used by the transition actions to check today's actual state before mutating.
 */
async function getTodayStatus(
  reservationId: string,
  site: { timeZone?: string | null; locationLat?: string | null; locationLng?: string | null },
): Promise<string | null> {
  const todayKey = siteDayKey({
    timeZone: site.timeZone,
    latitude: site.locationLat ? parseFloat(site.locationLat) : undefined,
    longitude: site.locationLng ? parseFloat(site.locationLng) : undefined,
  })
  const row = await prisma.reservationDay.findUnique({
    where: { reservationId_date: { reservationId, date: new Date(todayKey) } },
    select: { operationalStatus: true },
  })
  return row?.operationalStatus ?? null
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

export async function unreserveItem(
  siteId: string,
  itemId: string,
  accessKey?: string,
  applyToPair: boolean = true,
  voidSettlements: boolean = true,
) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const todayStart = dayjs().startOf('day').toDate()
  const todayEnd = dayjs().endOf('day').toDate()

  if (applyToPair) {
    // Pair mode: delete the whole walk-in reservation (frees both seats).
    // For walk-ins (paid-in-cash), delete them entirely (no invoice trail).
    // Use overlap-with-today semantics so multi-day walk-ins (to > todayEnd)
    // and in-progress stays (from < todayStart) are matched correctly.
    //
    // Void settlements BEFORE delete: after deleteMany the reservationId FKs are
    // SetNull'd and voidSettlementsForReservation can no longer find the rows.
    const matchWhere = {
      siteId,
      status: RESERVATION_PAID_IN_CASH,
      // Any operational state — a cash walk-in can be unreserved at any time,
      // including after it's been departed or marked no-show (track 012).
      from: { lte: todayEnd },
      to: { gte: todayStart },
      items: { some: { id: itemId } },
    }

    if (voidSettlements) {
      // Fetch the reservation ids that will be deleted so we can void their
      // settlements before the delete clears the FK. (Shouldn't be more than
      // one, but safe to handle any count.)
      const toDelete = await prisma.reservation.findMany({
        where: matchWhere,
        select: { id: true },
      })
      for (const r of toDelete) {
        await voidSettlementsForReservation(r.id)
      }
    }

    const result = await prisma.reservation.deleteMany({ where: matchWhere })

    if (result.count === 0) {
      return { status: 'error', errors: ['No walk-in reservation found to release'] }
    }
  } else {
    // Single-seat mode: if the reservation has >1 item, disconnect just this
    // seat (the partner stays); otherwise delete the whole reservation.
    // Match a cash walk-in in ANY operational state — including the between-days
    // 'expected' leg of a multiday walk-in (track 012). The pair branch above
    // already dropped this constraint; the single branch must mirror it, or
    // unreserving a multiday cash booking that reads 'expected' today fails with
    // "No walk-in reservation found to release".
    const reservation = await prisma.reservation.findFirst({
      where: {
        siteId,
        status: RESERVATION_PAID_IN_CASH,
        from: { lte: todayEnd },
        to: { gte: todayStart },
        items: { some: { id: itemId } },
      },
      select: {
        id: true,
        from: true,
        to: true,
        items: { select: { id: true, price: true } },
        site: { select: { type: true, price: true } },
      },
    })

    if (!reservation) {
      return { status: 'error', errors: ['No walk-in reservation found to release'] }
    }

    if (reservation.items.length > 1) {
      // Multi-seat disconnect: freeing one seat from a group reservation.
      // Never void settlements here — the settlement belongs to the whole
      // reservation (the remaining seats still occupy the drawer). The
      // paymentAmount reduction below maintains the "expected price" prefill
      // for a later Settle; the till itself reads from TillEntry (unaffected).
      const remainingItems = reservation.items.filter((i) => i.id !== itemId)
      // Till conservation: reduce paymentAmount to the remaining seats' share so
      // the refunded seat's cash leaves the till (mirrors the depart-split logic).
      // Free sites always record 0; paid sites compute from DB prices only (payments.md).
      const remainingAmount =
        reservation.site.type === 'paid'
          ? computeWalkInAmount(
              remainingItems,
              reservation.site.price,
              reservation.from ?? dayjs().startOf('day').toDate(),
              reservation.to,
            )
          : 0
      await prisma.reservation.update({
        where: { id: reservation.id },
        data: {
          paymentAmount: remainingAmount,
          items: { disconnect: [{ id: itemId }] },
        },
      })
    } else {
      // Single-seat delete path: void settlements before delete (same FK-SetNull risk).
      if (voidSettlements) {
        await voidSettlementsForReservation(reservation.id)
      }
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
    select: {
      siteId: true,
      operationalStatus: true,
      site: { select: { timeZone: true, locationLat: true, locationLng: true } },
    },
  })
  if (!reservation || reservation.siteId !== siteId) {
    return { status: 'error', errors: ['Reservation not found'] }
  }

  // Precondition: read from today's row if it exists, else fall back to parent.
  // We load the today-row to get the real current-day operational status.
  const todayStatus = await getTodayStatus(reservationId, reservation.site)
  const effectiveStatus = todayStatus ?? reservation.operationalStatus
  if (effectiveStatus !== OP_EXPECTED) {
    return { status: 'error', errors: [`Cannot check in from status: ${effectiveStatus}`] }
  }

  const now = new Date()
  await applyDayTransition(
    { id: reservationId },
    reservation.site,
    { operationalStatus: OP_CHECKED_IN, checkedInAt: now },
  )

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Resume walk-in: returning multiday cash guest re-seats for the day ─────

/**
 * Re-seat a multiday cash walk-in that departed yesterday and is now back for
 * another day (the daily Depart→expected cycle). Operationally: expected →
 * walked-in, with checkedInAt stamped now.
 *
 * This is NOT a new payment: the cash was collected at the original Rent; no
 * till entry and no paymentAmount change. It mirrors the "Check-in" transition
 * but produces orange walked-in (not blue checked-in) because this is a walk-in
 * re-seat, not an online booking arrival.
 *
 * Precondition: effectiveStatus must be OP_EXPECTED (walked-in → departed →
 * expected is the multiday daily cycle). Any other status is rejected.
 */
export async function resumeWalkIn(siteId: string, reservationId: string, accessKey?: string) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: {
      siteId: true,
      operationalStatus: true,
      site: { select: { timeZone: true, locationLat: true, locationLng: true } },
    },
  })
  if (!reservation || reservation.siteId !== siteId) {
    return { status: 'error', errors: ['Reservation not found'] }
  }

  const todayStatus = await getTodayStatus(reservationId, reservation.site)
  const effectiveStatus = todayStatus ?? reservation.operationalStatus
  if (effectiveStatus !== OP_EXPECTED) {
    return { status: 'error', errors: [`Cannot resume walk-in from status: ${effectiveStatus}`] }
  }

  await applyDayTransition(
    { id: reservationId },
    reservation.site,
    { operationalStatus: OP_WALKED_IN, checkedInAt: new Date() },
  )

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Mark departed: customer left ───────────────────────────────────────────

/**
 * Mark a reservation (or a subset of seats of a multi-seat cash walk-in) as departed.
 *
 * `splitItemIds` — optional array; only honoured for `paid-in-cash` + walked-in
 * reservations. When set AND the subset is smaller than the reservation's full item
 * count, the selected seats are peeled into ONE new reservation:
 *   1. In a $transaction: disconnect the subset from the original reservation
 *      (remaining seats stay walked-in with the reduced paymentAmount), create a
 *      new reservation for the subset copying the original's attribution
 *      (employeeId, guestName, userId, from/to, status, checkedInAt), then apply
 *      the depart transition to the NEW reservation only.
 *   2. The original reservation is NOT transitioned — its remaining seats stay
 *      walked-in and the bed remains occupied.
 *   3. Till conservation: paymentAmount on both the original (reduced) and the new
 *      (per-subset) sum to the original total when prices are unchanged.
 * When `splitItemIds` covers ALL the reservation's items (or is empty), the
 * whole-reservation depart runs in place (no pointless split).
 *
 * Online checked-in (RESERVATION_COMPLETE) and QR-collected (complete + walked-in)
 * reservations are NOT splittable — `splitItemIds` is silently ignored for them and
 * the whole-reservation depart runs instead (invoice / refund complexity).
 */
export async function markDeparted(
  siteId: string,
  reservationId: string,
  accessKey?: string,
  splitItemIds?: string[],
) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: {
      siteId: true,
      status: true,
      operationalStatus: true,
      to: true,
      from: true,
      checkedInAt: true,
      guestName: true,
      userId: true,
      employeeId: true,
      items: { select: { id: true, price: true } },
      site: {
        select: {
          type: true,
          price: true,
          timeZone: true,
          locationLat: true,
          locationLng: true,
        },
      },
    },
  })
  if (!reservation || reservation.siteId !== siteId) {
    return { status: 'error', errors: ['Reservation not found'] }
  }

  // Precondition: derive from today's row (may not exist yet → fall back to parent).
  const todayStatus = await getTodayStatus(reservationId, reservation.site)
  const effectiveStatus = todayStatus ?? reservation.operationalStatus
  if (!([OP_CHECKED_IN, OP_WALKED_IN] as string[]).includes(effectiveStatus)) {
    return { status: 'error', errors: [`Cannot mark departed from: ${effectiveStatus}`] }
  }

  // Split-then-depart path: only for paid-in-cash + walked-in multi-seat walk-ins.
  // Online (complete) and QR-collected (complete + walked-in) are excluded: their
  // invoice complexity makes per-seat partial operations unsafe here.
  const isCashWalkIn =
    reservation.status === RESERVATION_PAID_IN_CASH &&
    effectiveStatus === OP_WALKED_IN

  // Normalise the split set: filter to item ids that actually belong to this reservation.
  const validSplitIds = (splitItemIds ?? []).filter((id) =>
    reservation.items.some((i) => i.id === id),
  )

  // A split is only meaningful when:
  //   - this is a cash walk-in
  //   - the caller specified a non-empty subset
  //   - the subset is SMALLER than the full item count (otherwise it's just a whole depart)
  const canSplit =
    isCashWalkIn &&
    validSplitIds.length > 0 &&
    reservation.items.length > 1 &&
    validSplitIds.length < reservation.items.length

  if (canSplit) {
    const splitItems = reservation.items.filter((i) => validSplitIds.includes(i.id))
    const remainingItems = reservation.items.filter((i) => !validSplitIds.includes(i.id))

    // Conserve the till: subset + remaining amounts sum to the original total
    // when prices are unchanged. Both computed from DB prices only (payments.md).
    const fromDate = reservation.from ?? dayjs().startOf('day').toDate()
    const toDate = reservation.to
    const newSubsetAmount =
      reservation.site.type === 'paid'
        ? computeWalkInAmount(splitItems, reservation.site.price, fromDate, toDate)
        : 0
    const remainingAmount =
      reservation.site.type === 'paid'
        ? computeWalkInAmount(remainingItems, reservation.site.price, fromDate, toDate)
        : 0

    // Determine departure transition BEFORE entering the transaction (uses site tz).
    const endOfToday = new Date()
    endOfToday.setHours(23, 59, 59, 999)
    const hasFutureDays = toDate > endOfToday

    // Compute todayKey BEFORE the transaction — it's a pure timezone calculation.
    const todayKey = siteDayKey({
      timeZone: reservation.site.timeZone,
      latitude: reservation.site.locationLat
        ? parseFloat(reservation.site.locationLat)
        : undefined,
      longitude: reservation.site.locationLng
        ? parseFloat(reservation.site.locationLng)
        : undefined,
    })
    const todayDate = new Date(todayKey)
    const departNow = new Date()

    // All DB mutations in one atomic transaction: disconnect → create → depart.
    await prisma.$transaction(async (tx) => {
      // 1. Disconnect the splitting subset from the original; reduce the original's amount.
      await tx.reservation.update({
        where: { id: reservationId },
        data: {
          paymentAmount: remainingAmount,
          items: { disconnect: validSplitIds.map((id) => ({ id })) },
        },
      })

      // 2. Create ONE new reservation for the entire subset, copying original attribution.
      //    Preserve: employeeId (who collected the cash), guestName, userId, from, to,
      //    status (paid-in-cash), operationalStatus (walked-in), checkedInAt.
      const newRes = await tx.reservation.create({
        data: {
          siteId,
          userId: reservation.userId,
          type: 'days',
          status: RESERVATION_PAID_IN_CASH,
          operationalStatus: OP_WALKED_IN,
          checkedInAt: reservation.checkedInAt,
          from: fromDate,
          to: toDate,
          paymentAmount: newSubsetAmount,
          ...(reservation.employeeId ? { employeeId: reservation.employeeId } : {}),
          ...(reservation.guestName ? { guestName: reservation.guestName } : {}),
          items: { connect: validSplitIds.map((id) => ({ id })) },
        },
        select: { id: true },
      })

      // 3. Apply the depart transition to the NEW single-seat reservation.
      //    future-days → expected (re-rentable tomorrow); last-day → departed (bed freed).
      if (hasFutureDays) {
        await tx.reservationDay.upsert({
          where: { reservationId_date: { reservationId: newRes.id, date: todayDate } },
          create: {
            reservationId: newRes.id,
            date: todayDate,
            operationalStatus: OP_EXPECTED,
            checkedInAt: null,
            departedAt: null,
          },
          update: {
            operationalStatus: OP_EXPECTED,
            checkedInAt: null,
            departedAt: null,
          },
        })
        await tx.reservation.update({
          where: { id: newRes.id },
          data: { operationalStatus: OP_EXPECTED, checkedInAt: null, departedAt: null },
        })
      } else {
        await tx.reservationDay.upsert({
          where: { reservationId_date: { reservationId: newRes.id, date: todayDate } },
          create: {
            reservationId: newRes.id,
            date: todayDate,
            operationalStatus: OP_DEPARTED,
            checkedInAt: null,
            departedAt: departNow,
          },
          update: {
            operationalStatus: OP_DEPARTED,
            departedAt: departNow,
          },
        })
        await tx.reservation.update({
          where: { id: newRes.id },
          data: { operationalStatus: OP_DEPARTED, departedAt: departNow },
        })
      }
    })

    revalidatePath(`/sites/${siteId}/manage`)
    return { status: 'ok' }
  }

  // Whole-reservation depart path (unchanged).
  // Depart returns the bed to RESERVED for the rest of the stay, not a terminal
  // "departed" — that's the daily cycle (state machine): a guest who leaves but is
  // booked again tomorrow goes back to reserved (re-rentable tomorrow). Only on the
  // LAST day (no remaining reserved days) does departing end the stay → `departed`,
  // which frees the bed via the stay-over rule. (track 012)
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)
  const hasFutureDays = reservation.to > endOfToday

  if (hasFutureDays) {
    await applyDayTransition(
      { id: reservationId },
      reservation.site,
      { operationalStatus: OP_EXPECTED, checkedInAt: null, departedAt: null },
    )
  } else {
    await applyDayTransition(
      { id: reservationId },
      reservation.site,
      { operationalStatus: OP_DEPARTED, departedAt: new Date() },
    )
  }

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Mark no-show: customer didn't arrive ───────────────────────────────────

export async function markNoShow(siteId: string, reservationId: string, accessKey?: string) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: {
      siteId: true,
      operationalStatus: true,
      site: { select: { timeZone: true, locationLat: true, locationLng: true } },
    },
  })
  if (!reservation || reservation.siteId !== siteId) {
    return { status: 'error', errors: ['Reservation not found'] }
  }

  // Precondition: derive from today's row (may not exist yet → fall back to parent).
  const todayStatus = await getTodayStatus(reservationId, reservation.site)
  const effectiveStatus = todayStatus ?? reservation.operationalStatus
  if (effectiveStatus !== OP_EXPECTED) {
    return { status: 'error', errors: [`Cannot mark no-show from: ${effectiveStatus}`] }
  }

  await applyDayTransition(
    { id: reservationId },
    reservation.site,
    { operationalStatus: OP_NO_SHOW },
  )

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
  employeeId?: string,
  until?: string
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

// ─── Grouped walk-in: seat an entire multiselect party as ONE reservation ────

/**
 * Create a single walk-in reservation spanning ALL the selected `itemIds`.
 *
 * This is the multiselect analogue of `reserveItem`: instead of one seat (+ pair
 * expansion), the caller supplies the full selection and it is booked atomically
 * under one `Reservation` row.  The `reserveWithConflictGuard` primitive already
 * creates one reservation over an `itemIds[]` array with a `SELECT … FOR UPDATE`
 * lock, so all-or-nothing falls out naturally: a conflict on ANY seat fails the
 * whole group and creates nothing.
 *
 * Decisions (track 011 P1):
 * - No pair expansion (`applyToPair = false` semantics): the UI sends the full
 *   selection; we act on exactly those ids.
 * - `paymentAmount` is the SUM across ALL seats × days, computed from DB prices
 *   only — never a client value (payments.md, no-inline-money guard).
 * - One till line for the whole group (same employeeId on the one reservation).
 */
export async function reserveItems(
  siteId: string,
  itemIds: string[],
  guestName?: string,
  internalNotes?: string,
  accessKey?: string,
  until?: string,
  employeeId?: string,
) {
  if (!itemIds || itemIds.length === 0) {
    return { status: 'error', errors: ['No items selected'] }
  }

  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

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

  // Summed paymentAmount across all selected seats from DB prices only.
  const [site, priceRows] = await Promise.all([
    prisma.site.findUnique({ where: { id: siteId }, select: { type: true, price: true } }),
    prisma.inventoryItem.findMany({ where: { id: { in: itemIds } }, select: { price: true } }),
  ])
  const paymentAmount = site?.type === 'paid'
    ? computeWalkInAmount(priceRows, site.price, fromDate, toDate)
    : 0

  const stampedEmployeeId = await resolveEmployeeId(employeeId, ownership.userId)

  const result = await reserveWithConflictGuard({
    itemIds,
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
    return { status: 'error', errors: ['One or more selected sunbeds are already reserved for this period'] }
  }

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Grouped hold: pencil in an entire multiselect party as ONE hold ─────────

/**
 * Create a single lightweight floor hold spanning ALL the selected `itemIds`.
 *
 * This is the multiselect analogue of `holdBed`: instead of one seat (+ pair
 * expansion), the full selection is held atomically under one `Reservation` row.
 * All-or-nothing atomicity is provided by `reserveWithConflictGuard`'s
 * `SELECT … FOR UPDATE` transaction over the whole `itemIds` set.
 *
 * Decisions (track 011 P1):
 * - No pair expansion: act on exactly the passed `itemIds`.
 * - `paymentAmount: 0` (hold, no cash taken).
 * - `status: held`, `operationalStatus: expected` — same as singular `holdBed`.
 * - Today-only (`to` = end of day); the cleanup cron garbage-collects expired holds.
 */
export async function holdBeds(
  siteId: string,
  itemIds: string[],
  accessKey?: string,
  guestName?: string,
  notes?: string,
  employeeId?: string,
) {
  if (!itemIds || itemIds.length === 0) {
    return { status: 'error', errors: ['No items selected'] }
  }

  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const fromDate = dayjs().startOf('day').toDate()
  const toDate = dayjs().endOf('day').toDate()

  const stampedEmployeeId = await resolveEmployeeId(employeeId, ownership.userId)

  const result = await reserveWithConflictGuard({
    itemIds,
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
    return { status: 'error', errors: ['One or more selected sunbeds are already occupied or blocked'] }
  }

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Grouped block: take an entire multiselect out of service as ONE reservation ──

/**
 * Create a single blocked (out-of-service) reservation spanning ALL the selected `itemIds`.
 *
 * This is the multiselect analogue of `blockBed`: instead of one seat (+ pair
 * expansion), the full selection is blocked atomically under one `Reservation` row.
 * All-or-nothing atomicity is provided by `reserveWithConflictGuard`'s
 * `SELECT … FOR UPDATE` transaction over the whole `itemIds` set.
 *
 * Decisions (track 011 Block/Comp parity):
 * - No pair expansion: act on exactly the passed `itemIds`.
 * - Same sticky `OUT_OF_SERVICE_TO` sentinel as `blockBed` — block survives rollover.
 * - Conflict on ANY seat → nothing created.
 */
export async function blockBeds(
  siteId: string,
  itemIds: string[],
  notes?: string,
  accessKey?: string,
  employeeId?: string,
) {
  if (!itemIds || itemIds.length === 0) {
    return { status: 'error', errors: ['No items selected'] }
  }

  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const fromDate = dayjs().startOf('day').toDate()
  const toDate = OUT_OF_SERVICE_TO

  const stampedEmployeeId = await resolveEmployeeId(employeeId, ownership.userId)

  const result = await reserveWithConflictGuard({
    itemIds,
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
    return { status: 'error', errors: ['One or more selected sunbeds are already occupied or blocked'] }
  }

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
}

// ─── Grouped comp: mark an entire multiselect as complimentary as ONE reservation ──

/**
 * Create a single comp reservation spanning ALL the selected `itemIds`.
 *
 * This is the multiselect analogue of `compBed`: instead of one seat (+ pair
 * expansion), the full selection is comped atomically under one `Reservation` row.
 * All-or-nothing atomicity is provided by `reserveWithConflictGuard`'s
 * `SELECT … FOR UPDATE` transaction over the whole `itemIds` set.
 *
 * Decisions (track 011 Block/Comp parity):
 * - No pair expansion: act on exactly the passed `itemIds`.
 * - Same `isComp: true`, `paymentAmount: 0`, `OP_COMP` semantics as `compBed`.
 * - Today-only (`to` = end of day); same as `compBed`.
 * - Conflict on ANY seat → nothing created.
 */
export async function compBeds(
  siteId: string,
  itemIds: string[],
  accessKey?: string,
  guestName?: string,
  notes?: string,
  employeeId?: string,
) {
  if (!itemIds || itemIds.length === 0) {
    return { status: 'error', errors: ['No items selected'] }
  }

  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const fromDate = dayjs().startOf('day').toDate()
  const toDate = dayjs().endOf('day').toDate()

  const stampedEmployeeId = await resolveEmployeeId(employeeId, ownership.userId)

  const result = await reserveWithConflictGuard({
    itemIds,
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
    return { status: 'error', errors: ['One or more selected sunbeds are already occupied or blocked'] }
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
  employeeId?: string,
  applyToGroup: boolean = true,
  splitItemIds?: string[],
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
          from: true,
          items: { select: { id: true, price: true } },
        },
      })

      if (!hold) {
        return { outcome: 'not_found' as const }
      }

      // Subset split path: hold has more items than the split set and caller chose
      // Seat scope (applyToGroup=false). Disconnect the subset from the hold (hold
      // stays held, paymentAmount stays 0) and create ONE new walk-in for the subset.
      // splitItemIds ?? [itemId] → single-seat when no bulk set provided; multi-seat
      // when bulkRent passes a subset of selected ids from a grouped hold.
      const splitSet = (splitItemIds ?? [itemId]).filter((id) =>
        hold.items.some((i) => i.id === id),
      )
      if (!applyToGroup && hold.items.length > splitSet.length && splitSet.length > 0) {
        const splitSetItems = hold.items.filter((i) => splitSet.includes(i.id))
        const perSubsetAmount = site?.type === 'paid'
          ? computeWalkInAmount(splitSetItems, site.price, todayStart, toDate)
          : 0

        // Re-check availability for the split seats on the extended days before creating —
        // the hold covers today only; the extra days could have a concurrent booking.
        await tx.$queryRaw`
          SELECT id FROM "InventoryItem"
          WHERE id = ANY(${splitSet}::text[])
          FOR UPDATE
        `
        const conflict = await tx.reservation.findFirst({
          where: {
            siteId,
            status: { in: BLOCKING_STATUSES as string[] },
            operationalStatus: { notIn: [OP_NO_SHOW, OP_DEPARTED] as string[] },
            from: { lte: toDate },
            to: { gte: todayStart },
            items: { some: { id: { in: splitSet } } },
            id: { not: hold.id },
          },
          select: { id: true },
        })
        if (conflict) {
          return { outcome: 'conflict' as const }
        }

        // Disconnect the subset from the hold; hold keeps its remaining items + held status.
        await tx.reservation.update({
          where: { id: hold.id },
          data: { items: { disconnect: splitSet.map((id) => ({ id })) } },
        })
        // Create ONE new walk-in for the whole subset.
        await tx.reservation.create({
          data: {
            siteId,
            userId: ownership.userId,
            type: 'days',
            status: RESERVATION_PAID_IN_CASH,
            operationalStatus: OP_WALKED_IN,
            checkedInAt: new Date(),
            from: hold.from ?? todayStart,
            to: toDate,
            paymentAmount: perSubsetAmount,
            ...(stampedEmployeeId ? { employeeId: stampedEmployeeId } : {}),
            ...(guestName && guestName.trim() ? { guestName: guestName.trim().slice(0, 200) } : {}),
            items: { connect: splitSet.map((id) => ({ id })) },
          },
        })
        return { outcome: 'split' as const }
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
    // re-check needed. Simple find + update outside a transaction (or a split).
    const reservation = await prisma.reservation.findFirst({
      where: {
        siteId,
        status: RESERVATION_HELD,
        from: { lte: todayEnd },
        to: { gte: todayStart },
        items: { some: { id: itemId } },
      },
      select: { id: true, from: true, items: { select: { id: true, price: true } } },
    })

    if (!reservation) {
      return { status: 'error', errors: ['No held reservation found to convert'] }
    }

    // Subset split path: hold has more items than the split set and caller chose
    // Seat scope (applyToGroup=false). The hold already covers today for all seats,
    // so no conflict re-check needed — disconnecting and re-connecting are safe.
    // splitItemIds ?? [itemId] → single-seat fallback; multi-seat when bulk passes a set.
    // Compute splitSet lazily inside the guard so tests that mock findFirst without
    // `items` don't crash when applyToGroup=true (items never accessed on that path).
    const splitSet = !applyToGroup && reservation.items
      ? (splitItemIds ?? [itemId]).filter((id) => reservation.items.some((i) => i.id === id))
      : []
    if (!applyToGroup && reservation.items && reservation.items.length > splitSet.length && splitSet.length > 0) {
      const splitSetItems = reservation.items.filter((i) => splitSet.includes(i.id))
      const perSubsetAmount = site?.type === 'paid'
        ? computeWalkInAmount(splitSetItems, site.price, todayStart, toDate)
        : 0

      await prisma.$transaction([
        prisma.reservation.update({
          where: { id: reservation.id },
          data: { items: { disconnect: splitSet.map((id) => ({ id })) } },
        }),
        prisma.reservation.create({
          data: {
            siteId,
            userId: ownership.userId,
            type: 'days',
            status: RESERVATION_PAID_IN_CASH,
            operationalStatus: OP_WALKED_IN,
            checkedInAt: new Date(),
            from: reservation.from ?? todayStart,
            to: toDate,
            paymentAmount: perSubsetAmount,
            ...(stampedEmployeeId ? { employeeId: stampedEmployeeId } : {}),
            ...(guestName && guestName.trim() ? { guestName: guestName.trim().slice(0, 200) } : {}),
            items: { connect: splitSet.map((id) => ({ id })) },
          },
        }),
      ])
    } else {
      // Whole-hold conversion (single-item hold OR Group scope): update in place.
      const paymentAmount = site?.type === 'paid'
        ? computeWalkInAmount(reservation.items, site.price, todayStart, toDate)
        : 0

      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { ...updateData, paymentAmount },
      })
    }
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

// ─── Settle reservation (record cash taken at the till) ─────────────────────

/**
 * Record cash collected for a walk-in reservation: writes a non-voided `TillEntry`
 * that immediately contributes to the worker's open till. This is the CASH
 * counterpart to the card-based `collectReservationPayment` flow.
 *
 * The amount is staff-entered (prefilled from the DB price in the UI, but the
 * operator may adjust for rounding, discounts, or partial payments). It must be
 * a positive finite number not exceeding 100,000.
 *
 * Preconditions checked:
 *   - Reservation exists and belongs to this site.
 *   - Reservation is an offline cash walk-in: status === paid-in-cash AND
 *     operationalStatus is walked-in or expected (multiday between-day leg).
 *   - Amount is a finite number > 0 and <= 100000.
 *
 * No invoice is created — cash settlements are till-only (Settle vs Collect).
 */
export async function settleReservation(
  siteId: string,
  reservationId: string,
  amount: number,
  accessKey?: string,
  employeeId?: string,
) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  // Amount validation: staff-entered cash, editable in the UI.
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    return { status: 'error', errors: ['Amount must be a positive number up to 100,000'] }
  }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: {
      siteId: true,
      status: true,
      operationalStatus: true,
    },
  })

  if (!reservation || reservation.siteId !== siteId) {
    return { status: 'error', errors: ['Reservation not found'] }
  }

  // Only offline cash walk-ins can be settled this way. Operational status may be
  // walked-in (guest currently seated) or expected (multiday between-day leg).
  if (reservation.status !== RESERVATION_PAID_IN_CASH) {
    return { status: 'error', errors: ['Only cash walk-in reservations can be settled'] }
  }
  if (!([OP_WALKED_IN, OP_EXPECTED] as string[]).includes(reservation.operationalStatus)) {
    return { status: 'error', errors: [`Cannot settle a reservation in state: ${reservation.operationalStatus}`] }
  }

  const stampedEmployeeId = await resolveEmployeeId(employeeId, ownership.userId)

  await recordSettlement({
    siteId,
    reservationId,
    employeeId: stampedEmployeeId,
    amount,
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok' }
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
    return { status: 'error', errors: [result.error ?? 'Payment could not be created'] }
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

// ─── Split one seat off a multi-seat walk-in (Seat-collect primitive) ────────

/**
 * Peel a single seat from a multi-seat cash walk-in into its own walk-in
 * reservation, so the Collect Payment QR can target that one seat independently.
 *
 * This is the split-without-depart analogue of the depart-split in markDeparted:
 * the new reservation stays `walked-in` (not departed) and carries the per-seat
 * paymentAmount. The original keeps its remaining seats with a reduced amount.
 *
 * Only valid for `paid-in-cash` + `walked-in` multi-seat reservations. Online
 * checked-in (complete) and QR-collected (complete + walked-in) are excluded —
 * their invoice complexity makes per-seat partial operations unsafe.
 *
 * Side effect (intentional): if the operator opens the QR modal and then abandons
 * it, `cancelCollection` reverts the new single-seat reservation to `paid-in-cash`
 * — the seat remains its own cash walk-in (revertible to cash, never stranded).
 *
 * Returns `{ status: 'ok', reservationId: <new id> }` on success.
 */
export async function splitWalkInSeat(
  siteId: string,
  reservationId: string,
  itemId: string,
  accessKey?: string,
): Promise<{ status: 'ok'; reservationId: string } | { status: 'error'; errors: string[] }> {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: {
      siteId: true,
      status: true,
      operationalStatus: true,
      from: true,
      to: true,
      checkedInAt: true,
      guestName: true,
      userId: true,
      employeeId: true,
      items: { select: { id: true, price: true } },
      site: { select: { type: true, price: true } },
    },
  })

  if (!reservation || reservation.siteId !== siteId) {
    return { status: 'error', errors: ['Reservation not found'] }
  }

  // Only cash walk-ins that are currently walked-in are splittable. Online
  // collected (complete) and any single-item reservation are rejected.
  if (
    reservation.status !== RESERVATION_PAID_IN_CASH ||
    reservation.operationalStatus !== OP_WALKED_IN
  ) {
    return { status: 'error', errors: ['Can only split a cash walk-in in walked-in state'] }
  }

  if (reservation.items.length <= 1) {
    return { status: 'error', errors: ['Reservation has only one seat — nothing to split'] }
  }

  const splitItem = reservation.items.find((i) => i.id === itemId)
  if (!splitItem) {
    return { status: 'error', errors: ['Item not found on this reservation'] }
  }

  const remainingItems = reservation.items.filter((i) => i.id !== itemId)
  const fromDate = reservation.from
  const toDate = reservation.to

  // Till conservation: per-seat and remaining amounts sum to the original total
  // when prices are unchanged. Both computed from DB prices only (payments.md).
  const newSeatAmount =
    reservation.site.type === 'paid'
      ? computeWalkInAmount([splitItem], reservation.site.price, fromDate, toDate)
      : 0
  const remainingAmount =
    reservation.site.type === 'paid'
      ? computeWalkInAmount(remainingItems, reservation.site.price, fromDate, toDate)
      : 0

  // All mutations in one atomic transaction: disconnect → create new walk-in.
  // Attribution (employeeId, guestName, userId, from/to, checkedInAt) is copied
  // to the new reservation so till/accounting traces back to the original worker.
  const newRes = await prisma.$transaction(async (tx) => {
    // 1. Disconnect the splitting seat from the original; reduce the original's amount.
    await tx.reservation.update({
      where: { id: reservationId },
      data: {
        paymentAmount: remainingAmount,
        items: { disconnect: [{ id: itemId }] },
      },
    })

    // 2. Create the new single-seat cash walk-in, copying original attribution.
    //    Preserve: employeeId (who collected the cash), guestName, userId,
    //    from, to, checkedInAt, status (paid-in-cash), operationalStatus (walked-in).
    const created = await tx.reservation.create({
      data: {
        siteId,
        userId: reservation.userId,
        type: 'days',
        status: RESERVATION_PAID_IN_CASH,
        operationalStatus: OP_WALKED_IN,
        checkedInAt: reservation.checkedInAt,
        from: fromDate,
        to: toDate,
        paymentAmount: newSeatAmount,
        ...(reservation.employeeId ? { employeeId: reservation.employeeId } : {}),
        ...(reservation.guestName ? { guestName: reservation.guestName } : {}),
        items: { connect: [{ id: itemId }] },
      },
      select: { id: true },
    })

    return created
  })

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok', reservationId: newRes.id }
}

// ─── Collect payment (QR → Mollie) for a cash walk-in rental ────────────────

/**
 * Begin collecting an online (Mollie) payment for one or more cash walk-in
 * rental bookings. A single walk-in session may create several bookings (one
 * per distinct rental item); all of them are settled under one Mollie payment
 * so the QR encodes a single `checkoutUrl` and `processConfirmedRentalBooking`
 * finalises the whole group at once via the shared `paymentRef`.
 *
 * Amount is the sum of `paymentAmount` across the bookings — persisted at
 * creation time from DB prices, never recomputed here (payments.md).
 * The `anonId` capability is minted so the renter can later access the receipt
 * at `/payment/complete/rental?rentalBookingId=...&anonId=...`. Reuse an
 * existing `anonId` if any booking already has one (idempotent re-mint).
 *
 * Demo mode short-circuits to a `pi_demo_` ref and leaves all bookings in
 * `processing`; the next `getRentalCollectStatus` poll sees the demo ref and
 * settles as paid.
 *
 * On provider error the helper already marks the bookings `payment_failed`;
 * we revert the whole group to `paid-in-cash` so the occupied item is never
 * abandoned as a terminal state on the manage page.
 */
export async function collectRentalPayment(
  siteId: string,
  bookingIds: string[],
  accessKey?: string,
) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  if (bookingIds.length === 0) {
    return { status: 'error', errors: ['No rental bookings specified'] }
  }

  // Load all bookings and verify they belong to the right site + are collectible.
  const bookings = await prisma.rentalBooking.findMany({
    where: { id: { in: bookingIds } },
    select: { id: true, siteId: true, status: true, paymentAmount: true, anonId: true },
  })

  if (bookings.length !== bookingIds.length) {
    return { status: 'error', errors: ['One or more rental bookings not found'] }
  }
  if (bookings.some((b) => b.siteId !== siteId)) {
    return { status: 'error', errors: ['Rental booking does not belong to this site'] }
  }
  // Only an un-collected cash walk-in is collectible — reject anything else
  // (already processing / complete / free) so we don't double-charge.
  if (bookings.some((b) => b.status !== RESERVATION_PAID_IN_CASH)) {
    return { status: 'error', errors: ['Payment can only be collected for a cash walk-in rental'] }
  }

  // Total amount shown to the operator in the QR modal (already DB-persisted at
  // creation — no monetary computation happens here; no-inline-money guard).
  const amount = bookings.reduce((sum, b) => sum + (b.paymentAmount ?? 0), 0)

  // Mint an anonId capability so the renter can reach their receipt after
  // paying. Reuse an existing one if any booking already has it (idempotent).
  const existingAnonId = bookings.find((b) => b.anonId)?.anonId
  const anonId = existingAnonId ?? randomUUID()
  if (!existingAnonId) {
    // Stamp anonId on every booking in the group (only those missing it).
    await prisma.rentalBooking.updateMany({
      where: { id: { in: bookingIds }, anonId: null },
      data: { anonId },
    })
  }

  // Representative booking id — the modal polls this one via getRentalCollectStatus.
  const primaryId = bookingIds[0]

  // Demo: skip the real provider — stamp a shared demo ref and move to processing.
  if (DEMO_MODE) {
    await prisma.rentalBooking.updateMany({
      where: { id: { in: bookingIds } },
      data: { paymentRef: `pi_demo_${Date.now()}`, status: RENTAL_PROCESSING },
    })
    revalidatePath(`/sites/${siteId}/manage`)
    return { status: 'ok', amount, demo: true, bookingId: primaryId }
  }

  const consumerAppUrl = process.env.CONSUMER_APP_URL
  if (!consumerAppUrl) {
    return { status: 'error', errors: ['Online payments are not configured (CONSUMER_APP_URL)'] }
  }
  // Standard post-payment redirect for rentals — the renter lands on
  // /payment/complete/rental which verifies and forwards to the rental receipt.
  const redirectUrl = new URL(
    `/payment/complete/rental?rentalBookingId=${primaryId}&anonId=${anonId}`,
    consumerAppUrl,
  ).toString()
  const webhookUrl = new URL('/api/webhooks/mollie', consumerAppUrl).toString()

  const result = await createRentalBookingMolliePayment(bookingIds, {
    redirectUrl,
    webhookUrl,
    metadataExtra: { collect: true },
  })

  if (result.status === 'error') {
    // The shared helper may have already marked bookings as payment_failed;
    // revert the whole group to paid-in-cash so the occupied item is never
    // stranded as a terminal state and can be re-collected or cashed out.
    await prisma.rentalBooking.updateMany({
      where: { id: { in: bookingIds } },
      data: { status: RESERVATION_PAID_IN_CASH, paymentRef: null },
    })
    return { status: 'error', errors: [result.error ?? 'Payment could not be created'] }
  }

  revalidatePath(`/sites/${siteId}/manage`)
  return { status: 'ok', amount, checkoutUrl: result.checkoutUrl, bookingId: primaryId }
}

/**
 * Poll the live payment status of a rental collection (the manage screen calls
 * this on an interval while the QR is shown). Reads the webhook-updated status
 * and, as a fallback, re-verifies with Mollie: a confirmed payment is finalised
 * (idempotent invoices, status → complete for all bookings sharing the ref); a
 * failed/expired one reverts the whole group to `paid-in-cash` so the rented
 * items survive.
 */
export async function getRentalCollectStatus(
  siteId: string,
  bookingId: string,
  accessKey?: string,
) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const booking = await prisma.rentalBooking.findUnique({
    where: { id: bookingId },
    select: { siteId: true, status: true, paymentRef: true },
  })
  if (!booking || booking.siteId !== siteId) {
    return { status: 'error', errors: ['Rental booking not found'] }
  }

  if (booking.status === RENTAL_COMPLETE) {
    return { status: 'ok', paymentStatus: 'complete' as const }
  }

  if (booking.status === RENTAL_PROCESSING && booking.paymentRef) {
    const fin = await reverifyAndFinalizeRentalBooking(bookingId)
    if (fin.settled === 'complete') {
      revalidatePath(`/sites/${siteId}/manage`)
      return { status: 'ok', paymentStatus: 'complete' as const }
    }
    if (fin.settled === 'failed') {
      // Failed collection → revert the WHOLE group (every booking sharing this
      // paymentRef) to cash so no rental is abandoned as a failed terminal state.
      await prisma.rentalBooking.updateMany({
        where: { siteId, paymentRef: booking.paymentRef },
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
 * Abandon an in-flight rental collection (operator closed the QR before the
 * renter paid). Re-verifies once: a payment that actually went through is
 * finalised (complete + invoices); otherwise the whole booking group reverts to
 * `paid-in-cash` and the paymentRef is cleared, keeping the rented items in a
 * safe state that can be re-collected or settled in cash. Idempotent / no-op
 * for a booking that isn't mid-collection.
 */
export async function cancelRentalCollection(
  siteId: string,
  bookingId: string,
  accessKey?: string,
) {
  const ownership = await verifySiteOwnership(siteId, accessKey)
  if ('error' in ownership) return { status: 'error', errors: [ownership.error] }

  const booking = await prisma.rentalBooking.findUnique({
    where: { id: bookingId },
    select: { siteId: true, status: true, paymentRef: true },
  })
  if (!booking || booking.siteId !== siteId) {
    return { status: 'error', errors: ['Rental booking not found'] }
  }
  // Only a processing collection is abandonable. Already complete or plain cash
  // is a no-op success — nothing to cancel.
  if (booking.status !== RENTAL_PROCESSING) {
    return { status: 'ok', paymentStatus: booking.status === RENTAL_COMPLETE ? 'complete' as const : 'cash' as const }
  }

  if (booking.paymentRef) {
    const fin = await reverifyAndFinalizeRentalBooking(bookingId)
    if (fin.settled === 'complete') {
      revalidatePath(`/sites/${siteId}/manage`)
      return { status: 'ok', paymentStatus: 'complete' as const }
    }
  }

  // Not paid — revert the whole group (every booking sharing this paymentRef)
  // to a plain cash walk-in (items kept, re-collectable).
  const ref = booking.paymentRef
  if (ref) {
    await prisma.rentalBooking.updateMany({
      where: { siteId, paymentRef: ref },
      data: { status: RESERVATION_PAID_IN_CASH, paymentRef: null },
    })
  } else {
    await prisma.rentalBooking.update({
      where: { id: bookingId },
      data: { status: RESERVATION_PAID_IN_CASH, paymentRef: null },
    })
  }
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
        // Blocks are out-of-service markers, not guests — managed on the grid, not
        // found here. (Operational floor search; investigation/history is owner-side.)
        operationalStatus: { not: 'blocked' },
        from: { lte: dayjs().add(RESERVATION_SEARCH_WINDOW_DAYS, 'day').endOf('day').toDate() },
        to: { gte: todayStart },
        OR: [
          { guestName: { contains: q, mode: 'insensitive' } },
          { guestContact: { contains: q, mode: 'insensitive' } },
          // Seat / bed number — "who's on 101?". seatLabel is the on-grid label.
          { items: { some: { seatLabel: { contains: q, mode: 'insensitive' } } } },
          // The consumer's own email/name — ONLY on consumer bookings. Staff-created
          // bookings (walk-in/hold/block) have user = the site owner, so matching
          // user.* there would surface every staff booking by the owner's name.
          { AND: [{ userId: { not: ownership.userId } }, { user: { email: { contains: q, mode: 'insensitive' } } }] },
          { AND: [{ userId: { not: ownership.userId } }, { user: { name: { contains: q, mode: 'insensitive' } } }] },
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
  /**
   * When true (genuine cash only), record a TillEntry for each created booking
   * so the ledger-sourced till reflects the cash taken. The Card(QR) path MUST
   * pass false here — the online Mollie collect is the payment; a cash entry
   * would double-count the same transaction. Defaults to false (no settlement).
   */
  recordCashSettlement?: boolean
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

  // Record a cash TillEntry for each created booking — ONLY for genuine cash.
  // The Card(QR) path MUST NOT record a settlement here; that path creates
  // bookings as paid-in-cash so paymentAmount is persisted, then routes to
  // collectRentalPayment (Mollie). Recording a TillEntry here for the card
  // path would double-count: once as cash below, once when Mollie settles.
  // Free bookings have paymentAmount 0 — skip them even if flag is somehow set.
  if (input.recordCashSettlement && input.paymentType === 'cash') {
    const bookingIdToAmount = new Map<string, number>()
    for (let i = 0; i < guardResult.bookingIds.length; i++) {
      const bi = bookingInputs[i]
      if (bi && bi.paymentAmount > 0) {
        bookingIdToAmount.set(guardResult.bookingIds[i]!, bi.paymentAmount)
      }
    }
    await Promise.all(
      Array.from(bookingIdToAmount.entries()).map(([rentalBookingId, amount]) =>
        recordSettlement({
          siteId: input.siteId,
          rentalBookingId,
          employeeId: stampedEmployeeId,
          amount,
        }),
      ),
    )
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