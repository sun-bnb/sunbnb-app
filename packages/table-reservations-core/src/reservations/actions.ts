import prisma from '@repo/data/PrismaCient'
import type { ActionResult } from '../types'
import {
  BLOCKING_TABLE_RESERVATION_STATUSES,
  BLOCKING_TABLE_RESERVATION_OP_STATUSES,
  TABLE_RESERVATION_STATUS,
  TABLE_RESERVATION_OP_STATUS,
  DEPOSIT_STATUS,
} from '../status'
import { DEFAULT_TIME_ZONE, getZonedParts, zonedWallClockToUtc } from '../tz'
import { pacingWindowStartMs } from '../pacing'
import { computeDepositAmount } from '../deposit'
import {
  getTableReservationById,
  reservationOwnedBy,
  type CustomerIdentity,
  type TableReservationRecord,
} from './queries'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface CreateTableReservationInput {
  restaurantId: string
  tableId: string
  from: Date
  to: Date
  partySize: number
  guestName: string
  guestEmail: string
  guestPhone?: string | null
  specialRequests?: string | null
  userId?: string | null
  anonId?: string | null
}

function validate(input: CreateTableReservationInput): string[] {
  const errors: string[] = []
  if (!input.restaurantId) errors.push('restaurantId is required')
  if (!input.tableId) errors.push('tableId is required')
  if (!(input.from instanceof Date) || Number.isNaN(input.from.getTime())) {
    errors.push('Invalid from')
  }
  if (!(input.to instanceof Date) || Number.isNaN(input.to.getTime())) {
    errors.push('Invalid to')
  }
  if (input.from && input.to && input.from >= input.to) {
    errors.push('from must be before to')
  }
  if (!Number.isInteger(input.partySize) || input.partySize < 1 || input.partySize > 50) {
    errors.push('Party size must be 1–50')
  }
  if (!input.guestName || input.guestName.trim().length === 0) {
    errors.push('Guest name is required')
  }
  if (input.guestName && input.guestName.length > 120) errors.push('Guest name too long')
  if (!input.guestEmail || !EMAIL_RE.test(input.guestEmail)) {
    errors.push('Valid guest email is required')
  }
  if (input.guestPhone && input.guestPhone.length > 40) errors.push('Guest phone too long')
  if (input.specialRequests && input.specialRequests.length > 500) {
    errors.push('Special requests too long')
  }
  if (!input.userId && !input.anonId) {
    errors.push('Identity is required (userId or anonId)')
  }
  // Past-time guard: allow a small grace period for clock skew.
  if (input.from && input.from.getTime() < Date.now() - 60 * 1000) {
    errors.push('Cannot book in the past')
  }
  return errors
}

/**
 * Create a table reservation. Re-checks availability inside the transaction
 * to guard against double-booking the same table slot from two concurrent
 * customers.
 */
export async function createTableReservation(
  input: CreateTableReservationInput,
): Promise<ActionResult & { reservation?: TableReservationRecord }> {
  const errors = validate(input)
  if (errors.length > 0) return { status: 'error', errors }

  // Load restaurant + table together to enforce constraints: table belongs to
  // restaurant, capacity ≥ party size, minPartySize ≤ party size, status active.
  const table = await prisma.table.findUnique({
    where: { id: input.tableId },
    select: {
      id: true,
      restaurantId: true,
      capacity: true,
      minPartySize: true,
      status: true,
    },
  })
  if (!table) return { status: 'error', errors: ['Table not found'] }
  if (table.restaurantId !== input.restaurantId) {
    return { status: 'error', errors: ['Table does not belong to this restaurant'] }
  }
  if (table.status !== 'active') {
    return { status: 'error', errors: ['Table is not available for booking'] }
  }
  if (table.capacity < input.partySize) {
    return { status: 'error', errors: ['Table capacity is below the party size'] }
  }
  if (table.minPartySize > input.partySize) {
    return { status: 'error', errors: ['Party is too small for this table'] }
  }

  // Resolve the pacing constraint (if any) for the booking's start instant from
  // the restaurant's shifts. Enforced inside the txn below to close the race.
  const pacing = await resolvePacingForInstant(input.restaurantId, input.from)

  // Resolve any required no-show deposit. The amount + 'pending' state are
  // recorded here; collecting it (Stripe/Mollie) is an app-layer concern that
  // calls markDepositHeld() once paid.
  const depositAmount = await resolveDepositForInstant(
    input.restaurantId,
    input.from,
    input.partySize,
    input.tableId,
  )

  // Availability re-check inside transaction. If the overlap count is > 0
  // after the insert, we've hit a race and should roll back. Pacing is
  // re-checked in the same txn for the same reason.
  let failReason: 'SLOT_TAKEN' | 'PACING_FULL' | null = null
  const reservation = await prisma.$transaction(async (tx) => {
    const overlap = await tx.tableReservation.count({
      where: {
        tableId: input.tableId,
        status: { in: BLOCKING_TABLE_RESERVATION_STATUSES as string[] },
        operationalStatus: {
          in: BLOCKING_TABLE_RESERVATION_OP_STATUSES as string[],
        },
        from: { lt: input.to },
        to: { gt: input.from },
      },
    })
    if (overlap > 0) {
      throw new Error('SLOT_TAKEN')
    }
    if (pacing) {
      const windowEnd = new Date(pacing.windowStartMs + pacing.windowMinutes * 60000)
      const others = await tx.tableReservation.findMany({
        where: {
          restaurantId: input.restaurantId,
          status: { in: BLOCKING_TABLE_RESERVATION_STATUSES as string[] },
          operationalStatus: { in: BLOCKING_TABLE_RESERVATION_OP_STATUSES as string[] },
          from: { gte: new Date(pacing.windowStartMs), lt: windowEnd },
        },
        select: { partySize: true },
      })
      const existing = others.reduce((sum, o) => sum + o.partySize, 0)
      if (existing + input.partySize > pacing.cap) {
        throw new Error('PACING_FULL')
      }
    }
    return tx.tableReservation.create({
      data: {
        restaurantId: input.restaurantId,
        tableId: input.tableId,
        userId: input.userId ?? null,
        anonId: input.anonId ?? null,
        from: input.from,
        to: input.to,
        partySize: input.partySize,
        // Deposit-required bookings start as a PENDING_PAYMENT hold (confirmed
        // once the deposit is collected via markDepositHeld); free bookings
        // confirm immediately.
        status: depositAmount > 0
          ? TABLE_RESERVATION_STATUS.PENDING_PAYMENT
          : TABLE_RESERVATION_STATUS.CONFIRMED,
        operationalStatus: TABLE_RESERVATION_OP_STATUS.EXPECTED,
        guestName: input.guestName.trim(),
        guestEmail: input.guestEmail.trim().toLowerCase(),
        guestPhone: input.guestPhone?.trim() || null,
        specialRequests: input.specialRequests?.trim() || null,
        depositAmount: depositAmount > 0 ? depositAmount : null,
        depositStatus: depositAmount > 0 ? DEPOSIT_STATUS.PENDING : DEPOSIT_STATUS.NONE,
      },
      select: { id: true },
    })
  }).catch((err: unknown) => {
    if (err instanceof Error && (err.message === 'SLOT_TAKEN' || err.message === 'PACING_FULL')) {
      failReason = err.message
      return null
    }
    throw err
  })

  if (!reservation) {
    return {
      status: 'error',
      errors: [failReason === 'PACING_FULL' ? 'This time is fully booked' : 'Slot no longer available'],
    }
  }
  const full = await getTableReservationById(reservation.id)
  return { status: 'ok', ...(full ? { reservation: full } : {}) }
}

export interface ModifyChanges {
  from?: Date
  to?: Date
  partySize?: number
  tableId?: string
}

/**
 * Re-apply a reservation's time/party/table after validating + re-checking
 * availability and pacing **inside a transaction** (excluding the reservation's
 * own row). Shared by the consumer + staff modify entry points. Combination
 * bookings are not modifiable yet.
 */
async function reapplyReservation(
  reservationId: string,
  changes: ModifyChanges,
): Promise<ActionResult & { reservation?: TableReservationRecord }> {
  const existing = await prisma.tableReservation.findUnique({
    where: { id: reservationId },
    select: {
      id: true,
      restaurantId: true,
      tableId: true,
      from: true,
      to: true,
      partySize: true,
      status: true,
      bookingGroupId: true,
      depositStatus: true,
    },
  })
  if (!existing) return { status: 'error', errors: ['Not found'] }
  if (existing.bookingGroupId) {
    return { status: 'error', errors: ['Combination bookings cannot be modified yet'] }
  }
  if (existing.status === TABLE_RESERVATION_STATUS.CANCELED) {
    return { status: 'error', errors: ['Cannot modify a canceled reservation'] }
  }

  const from = changes.from ?? existing.from
  const to = changes.to ?? existing.to
  const partySize = changes.partySize ?? existing.partySize
  const tableId = changes.tableId ?? existing.tableId

  const errors: string[] = []
  if (!(from instanceof Date) || Number.isNaN(from.getTime())) errors.push('Invalid from')
  if (!(to instanceof Date) || Number.isNaN(to.getTime())) errors.push('Invalid to')
  if (from && to && from >= to) errors.push('from must be before to')
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 50) errors.push('Party size must be 1–50')
  if (!tableId) errors.push('tableId is required')
  if (from && from.getTime() < Date.now() - 60 * 1000) errors.push('Cannot move to the past')
  if (errors.length > 0) return { status: 'error', errors }

  const table = await prisma.table.findUnique({
    where: { id: tableId! },
    select: { restaurantId: true, capacity: true, minPartySize: true, status: true },
  })
  if (!table) return { status: 'error', errors: ['Table not found'] }
  if (table.restaurantId !== existing.restaurantId) {
    return { status: 'error', errors: ['Table does not belong to this restaurant'] }
  }
  if (table.status !== 'active') return { status: 'error', errors: ['Table is not available'] }
  if (table.capacity < partySize) return { status: 'error', errors: ['Table capacity is below the party size'] }
  if (table.minPartySize > partySize) return { status: 'error', errors: ['Party is too small for this table'] }

  const pacing = await resolvePacingForInstant(existing.restaurantId, from)

  let failReason: 'SLOT_TAKEN' | 'PACING_FULL' | null = null
  const ok = await prisma
    .$transaction(async (tx) => {
      const overlap = await tx.tableReservation.count({
        where: {
          tableId: tableId!,
          id: { not: reservationId },
          status: { in: BLOCKING_TABLE_RESERVATION_STATUSES as string[] },
          operationalStatus: { in: BLOCKING_TABLE_RESERVATION_OP_STATUSES as string[] },
          from: { lt: to },
          to: { gt: from },
        },
      })
      if (overlap > 0) throw new Error('SLOT_TAKEN')

      if (pacing) {
        const windowEnd = new Date(pacing.windowStartMs + pacing.windowMinutes * 60000)
        const others = await tx.tableReservation.findMany({
          where: {
            restaurantId: existing.restaurantId,
            id: { not: reservationId },
            status: { in: BLOCKING_TABLE_RESERVATION_STATUSES as string[] },
            operationalStatus: { in: BLOCKING_TABLE_RESERVATION_OP_STATUSES as string[] },
            from: { gte: new Date(pacing.windowStartMs), lt: windowEnd },
          },
          select: { partySize: true },
        })
        const existingCovers = others.reduce((sum, o) => sum + o.partySize, 0)
        if (existingCovers + partySize > pacing.cap) throw new Error('PACING_FULL')
      }

      await tx.tableReservation.update({
        where: { id: reservationId },
        data: { from, to, partySize, tableId },
      })
      return true
    })
    .catch((err: unknown) => {
      if (err instanceof Error && (err.message === 'SLOT_TAKEN' || err.message === 'PACING_FULL')) {
        failReason = err.message
        return false
      }
      throw err
    })

  if (!ok) {
    return {
      status: 'error',
      errors: [failReason === 'PACING_FULL' ? 'This time is fully booked' : 'Slot no longer available'],
    }
  }

  // Recompute the deposit when the party/time changed and it isn't yet collected.
  if (existing.depositStatus === DEPOSIT_STATUS.PENDING || existing.depositStatus === DEPOSIT_STATUS.NONE) {
    const depositAmount = await resolveDepositForInstant(existing.restaurantId, from, partySize, tableId)
    await prisma.tableReservation.update({
      where: { id: reservationId },
      data: {
        depositAmount: depositAmount > 0 ? depositAmount : null,
        depositStatus: depositAmount > 0 ? DEPOSIT_STATUS.PENDING : DEPOSIT_STATUS.NONE,
      },
    })
  }

  const full = await getTableReservationById(reservationId)
  return { status: 'ok', ...(full ? { reservation: full } : {}) }
}

/** Consumer-initiated modify. Ownership by userId/anonId. */
export async function modifyTableReservation(
  reservationId: string,
  changes: ModifyChanges,
  identity: CustomerIdentity,
): Promise<ActionResult & { reservation?: TableReservationRecord }> {
  const owner = await prisma.tableReservation.findUnique({
    where: { id: reservationId },
    select: { userId: true, anonId: true },
  })
  if (!owner) return { status: 'error', errors: ['Not found'] }
  if (!reservationOwnedBy(owner, identity)) return { status: 'error', errors: ['Not authorized'] }
  return reapplyReservation(reservationId, changes)
}

/** Staff-initiated modify. Ownership via the restaurant's partnerAccount. */
export async function modifyReservationAsStaff(
  reservationId: string,
  changes: ModifyChanges,
  userId: string | null | undefined,
): Promise<ActionResult & { reservation?: TableReservationRecord }> {
  const r = await requireStaffOwner(reservationId, userId)
  if (!r.ok) return { status: 'error', errors: [r.error] }
  return reapplyReservation(reservationId, changes)
}

export async function cancelTableReservation(
  id: string,
  identity: CustomerIdentity,
): Promise<ActionResult & { reservation?: TableReservationRecord }> {
  const existing = await prisma.tableReservation.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      anonId: true,
      status: true,
      operationalStatus: true,
    },
  })
  if (!existing) return { status: 'error', errors: ['Not found'] }
  if (!reservationOwnedBy(existing, identity)) {
    return { status: 'error', errors: ['Not authorized'] }
  }
  if (existing.status === TABLE_RESERVATION_STATUS.CANCELED) {
    // Already canceled — idempotent.
    const full = await getTableReservationById(id)
    return { status: 'ok', ...(full ? { reservation: full } : {}) }
  }
  await prisma.tableReservation.updateMany({
    where: await targetGroupWhere(id),
    data: { status: TABLE_RESERVATION_STATUS.CANCELED },
  })
  const full = await getTableReservationById(id)
  return { status: 'ok', ...(full ? { reservation: full } : {}) }
}

/**
 * Resolve the prisma `where` that targets a reservation *and its booking group*
 * — so combination bookings (N rows sharing a bookingGroupId) transition
 * together. Falls back to the single row for ordinary bookings.
 */
async function targetGroupWhere(reservationId: string): Promise<Record<string, unknown>> {
  const r = await prisma.tableReservation.findUnique({
    where: { id: reservationId },
    select: { bookingGroupId: true },
  })
  return r?.bookingGroupId ? { bookingGroupId: r.bookingGroupId } : { id: reservationId }
}

// ─── Partner-side operational transitions (exposed for MVP-5, but simple
// enough to ship alongside the customer actions). ───────────────────────────

export async function markSeated(
  reservationId: string,
  userId: string | null | undefined,
): Promise<ActionResult> {
  const r = await requireStaffOwner(reservationId, userId)
  if (!r.ok) return { status: "error", errors: [r.error] }
  await prisma.tableReservation.updateMany({
    where: await targetGroupWhere(reservationId),
    data: {
      operationalStatus: TABLE_RESERVATION_OP_STATUS.SEATED,
      seatedAt: new Date(),
    },
  })
  return { status: 'ok' }
}

export async function markDeparted(
  reservationId: string,
  userId: string | null | undefined,
): Promise<ActionResult> {
  const r = await requireStaffOwner(reservationId, userId)
  if (!r.ok) return { status: "error", errors: [r.error] }
  await prisma.tableReservation.updateMany({
    where: await targetGroupWhere(reservationId),
    data: {
      operationalStatus: TABLE_RESERVATION_OP_STATUS.DEPARTED,
      departedAt: new Date(),
    },
  })
  return { status: 'ok' }
}

export async function markNoShow(
  reservationId: string,
  userId: string | null | undefined,
): Promise<ActionResult> {
  const r = await requireStaffOwner(reservationId, userId)
  if (!r.ok) return { status: "error", errors: [r.error] }
  await prisma.tableReservation.updateMany({
    where: await targetGroupWhere(reservationId),
    data: { operationalStatus: TABLE_RESERVATION_OP_STATUS.NO_SHOW },
  })
  return { status: 'ok' }
}

export async function updateReservationInternalNotes(
  reservationId: string,
  notes: string | null,
  userId: string | null | undefined,
): Promise<ActionResult> {
  if (notes !== null && notes.length > 2000) {
    return { status: 'error', errors: ['Internal notes too long (max 2000)'] }
  }
  const r = await requireStaffOwner(reservationId, userId)
  if (!r.ok) return { status: "error", errors: [r.error] }
  await prisma.tableReservation.update({
    where: { id: reservationId },
    data: { internalNotes: notes },
  })
  return { status: 'ok' }
}

/**
 * Partner/staff-initiated cancellation. Authorizes via the restaurant's
 * partnerAccount rather than the customer's identity. Idempotent.
 */
export async function cancelReservationAsStaff(
  reservationId: string,
  userId: string | null | undefined,
): Promise<ActionResult & { reservation?: TableReservationRecord }> {
  const r = await requireStaffOwner(reservationId, userId)
  if (!r.ok) return { status: 'error', errors: [r.error] }

  const existing = await prisma.tableReservation.findUnique({
    where: { id: reservationId },
    select: { status: true },
  })
  if (!existing) return { status: 'error', errors: ['Not found'] }

  if (existing.status === TABLE_RESERVATION_STATUS.CANCELED) {
    const full = await getTableReservationById(reservationId)
    return { status: 'ok', ...(full ? { reservation: full } : {}) }
  }

  await prisma.tableReservation.updateMany({
    where: await targetGroupWhere(reservationId),
    data: { status: TABLE_RESERVATION_STATUS.CANCELED },
  })
  const full = await getTableReservationById(reservationId)
  return { status: 'ok', ...(full ? { reservation: full } : {}) }
}

/**
 * Resolve the pacing window/cap that applies to a booking starting at `instant`,
 * by matching it against the restaurant's shifts (in the venue timezone).
 * Returns null when no shift with pacing covers the instant.
 */
export async function resolvePacingForInstant(
  restaurantId: string,
  instant: Date,
): Promise<{ windowStartMs: number; windowMinutes: number; cap: number } | null> {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: {
      timeZone: true,
      shifts: {
        select: {
          day: true,
          startTime: true,
          endTime: true,
          pacingCovers: true,
          pacingWindowMinutes: true,
        },
      },
    },
  })
  if (!restaurant || restaurant.shifts.length === 0) return null
  const tz = restaurant.timeZone ?? DEFAULT_TIME_ZONE
  const parts = getZonedParts(instant, tz)
  const fromMs = instant.getTime()
  const wallMs = (hhmm: string): number => {
    const [h = 0, m = 0] = hhmm.split(':').map(Number)
    return zonedWallClockToUtc(parts.year, parts.month, parts.day, h, m, tz).getTime()
  }
  for (const s of restaurant.shifts) {
    if (s.day !== parts.weekday || s.pacingCovers == null) continue
    if (fromMs >= wallMs(s.startTime) && fromMs < wallMs(s.endTime)) {
      return {
        windowStartMs: pacingWindowStartMs(fromMs, s.pacingWindowMinutes),
        windowMinutes: s.pacingWindowMinutes,
        cap: s.pacingCovers,
      }
    }
  }
  return null
}

/**
 * Resolve the no-show deposit required for a booking at `instant` for a party of
 * `partySize`, by matching the restaurant's policy + the covering shift. Returns
 * the amount (0 = none). Combination bookings don't carry a deposit yet.
 */
export async function resolveDepositForInstant(
  restaurantId: string,
  instant: Date,
  partySize: number,
  tableId?: string | null,
): Promise<number> {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: {
      timeZone: true,
      noShowPolicy: true,
      depositPerGuest: true,
      shifts: {
        select: {
          day: true,
          startTime: true,
          endTime: true,
          requiresDeposit: true,
          depositMinPartySize: true,
        },
      },
    },
  })
  if (!restaurant || restaurant.noShowPolicy !== 'deposit') return 0

  // Per-table override (force-require / exempt / amount).
  let tableRequiresDeposit: boolean | null = null
  let tableDepositPerGuest: number | null = null
  if (tableId) {
    const table = await prisma.table.findUnique({
      where: { id: tableId },
      select: { requiresDeposit: true, depositPerGuest: true },
    })
    if (table) {
      tableRequiresDeposit = table.requiresDeposit
      tableDepositPerGuest = table.depositPerGuest
    }
  }

  // Find the shift covering this instant (for the inherited gate + min party).
  const tz = restaurant.timeZone ?? DEFAULT_TIME_ZONE
  const parts = getZonedParts(instant, tz)
  const fromMs = instant.getTime()
  const wallMs = (hhmm: string): number => {
    const [h = 0, m = 0] = hhmm.split(':').map(Number)
    return zonedWallClockToUtc(parts.year, parts.month, parts.day, h, m, tz).getTime()
  }
  let shiftRequiresDeposit = false
  let shiftDepositMinPartySize: number | null = null
  for (const s of restaurant.shifts) {
    if (s.day !== parts.weekday) continue
    if (fromMs >= wallMs(s.startTime) && fromMs < wallMs(s.endTime)) {
      shiftRequiresDeposit = s.requiresDeposit
      shiftDepositMinPartySize = s.depositMinPartySize
      break
    }
  }

  return computeDepositAmount({
    noShowPolicy: restaurant.noShowPolicy,
    depositPerGuest: restaurant.depositPerGuest,
    shiftRequiresDeposit,
    shiftDepositMinPartySize,
    partySize,
    tableRequiresDeposit,
    tableDepositPerGuest,
  })
}

// ─── Deposit state transitions (idempotent). The app collects/captures/refunds
// via Stripe/Mollie + the @repo/data invoice cascade, then records the state
// here. ──────────────────────────────────────────────────────────────────────

/** Record that a reminder email was sent (idempotent — sets the timestamp). */
export async function markReminderSent(reservationId: string): Promise<ActionResult> {
  await prisma.tableReservation.update({
    where: { id: reservationId },
    data: { reminderSentAt: new Date() },
  })
  return { status: 'ok' }
}

/**
 * Mark a pending deposit as collected (held) and **confirm** the booking. Called
 * by the app once the deposit payment succeeds (provider webhook/poll or demo).
 * Idempotent in effect — re-running on a confirmed booking is harmless.
 */
export async function markDepositHeld(
  reservationId: string,
  paymentRef: string,
): Promise<ActionResult> {
  await prisma.tableReservation.update({
    where: { id: reservationId },
    data: {
      status: TABLE_RESERVATION_STATUS.CONFIRMED,
      depositStatus: DEPOSIT_STATUS.HELD,
      paymentRef,
    },
  })
  return { status: 'ok' }
}

/**
 * Reap stale PENDING_PAYMENT holds whose deposit was never collected (older than
 * `olderThanMinutes`), so abandoned checkouts stop blocking the slot. Returns the
 * number removed. Intended for a cleanup cron, mirroring reservations-cleanup.
 */
export async function cleanupStalePendingDeposits(
  olderThanMinutes = 20,
): Promise<{ removed: number }> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000)
  const res = await prisma.tableReservation.deleteMany({
    where: {
      status: TABLE_RESERVATION_STATUS.PENDING_PAYMENT,
      depositStatus: DEPOSIT_STATUS.PENDING,
      createdAt: { lt: cutoff },
    },
  })
  return { removed: res.count }
}

/** Charge a held deposit after a no-show. Idempotent — only held → charged. */
export async function chargeNoShowDeposit(
  reservationId: string,
  userId: string | null | undefined,
): Promise<ActionResult> {
  const r = await requireStaffOwner(reservationId, userId)
  if (!r.ok) return { status: 'error', errors: [r.error] }
  const existing = await prisma.tableReservation.findUnique({
    where: { id: reservationId },
    select: { depositStatus: true },
  })
  if (!existing) return { status: 'error', errors: ['Not found'] }
  if (existing.depositStatus !== DEPOSIT_STATUS.HELD) {
    return { status: 'ok' } // nothing to charge / already resolved
  }
  await prisma.tableReservation.update({
    where: { id: reservationId },
    data: { depositStatus: DEPOSIT_STATUS.CHARGED },
  })
  return { status: 'ok' }
}

/** Refund a held deposit (timely cancel). Idempotent — only held → refunded. */
export async function refundDeposit(reservationId: string): Promise<ActionResult> {
  const existing = await prisma.tableReservation.findUnique({
    where: { id: reservationId },
    select: { depositStatus: true },
  })
  if (!existing) return { status: 'error', errors: ['Not found'] }
  if (existing.depositStatus !== DEPOSIT_STATUS.HELD) return { status: 'ok' }
  await prisma.tableReservation.update({
    where: { id: reservationId },
    data: { depositStatus: DEPOSIT_STATUS.REFUNDED },
  })
  return { status: 'ok' }
}

/** Release a held deposit once the guest is seated (no charge). held → released. */
export async function releaseDeposit(reservationId: string): Promise<ActionResult> {
  const existing = await prisma.tableReservation.findUnique({
    where: { id: reservationId },
    select: { depositStatus: true },
  })
  if (!existing) return { status: 'error', errors: ['Not found'] }
  if (existing.depositStatus !== DEPOSIT_STATUS.HELD) return { status: 'ok' }
  await prisma.tableReservation.update({
    where: { id: reservationId },
    data: { depositStatus: DEPOSIT_STATUS.RELEASED },
  })
  return { status: 'ok' }
}

async function requireStaffOwner(
  reservationId: string,
  userId: string | null | undefined,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!userId) return { ok: false, error: 'Not authenticated' }
  const res = await prisma.tableReservation.findUnique({
    where: { id: reservationId },
    select: { restaurant: { select: { partnerAccountId: true } } },
  })
  if (!res) return { ok: false, error: 'Not found' }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { sudo: true } })
  if (user?.sudo) return { ok: true }
  if (res.restaurant.partnerAccountId !== userId) {
    return { ok: false, error: 'Not authorized' }
  }
  return { ok: true }
}
