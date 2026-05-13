import prisma from '@repo/data/PrismaCient'
import type { ActionResult } from '../types'
import {
  BLOCKING_TABLE_RESERVATION_STATUSES,
  BLOCKING_TABLE_RESERVATION_OP_STATUSES,
  TABLE_RESERVATION_STATUS,
  TABLE_RESERVATION_OP_STATUS,
} from '../status'
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

  // Availability re-check inside transaction. If the overlap count is > 0
  // after the insert, we've hit a race and should roll back.
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
    return tx.tableReservation.create({
      data: {
        restaurantId: input.restaurantId,
        tableId: input.tableId,
        userId: input.userId ?? null,
        anonId: input.anonId ?? null,
        from: input.from,
        to: input.to,
        partySize: input.partySize,
        status: TABLE_RESERVATION_STATUS.CONFIRMED,
        operationalStatus: TABLE_RESERVATION_OP_STATUS.EXPECTED,
        guestName: input.guestName.trim(),
        guestEmail: input.guestEmail.trim().toLowerCase(),
        guestPhone: input.guestPhone?.trim() || null,
        specialRequests: input.specialRequests?.trim() || null,
      },
      select: { id: true },
    })
  }).catch((err: unknown) => {
    if (err instanceof Error && err.message === 'SLOT_TAKEN') {
      return null
    }
    throw err
  })

  if (!reservation) {
    return { status: 'error', errors: ['Slot no longer available'] }
  }
  const full = await getTableReservationById(reservation.id)
  return { status: 'ok', ...(full ? { reservation: full } : {}) }
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
  await prisma.tableReservation.update({
    where: { id },
    data: { status: TABLE_RESERVATION_STATUS.CANCELED },
  })
  const full = await getTableReservationById(id)
  return { status: 'ok', ...(full ? { reservation: full } : {}) }
}

// ─── Partner-side operational transitions (exposed for MVP-5, but simple
// enough to ship alongside the customer actions). ───────────────────────────

export async function markSeated(
  reservationId: string,
  userId: string | null | undefined,
): Promise<ActionResult> {
  const r = await requireStaffOwner(reservationId, userId)
  if (!r.ok) return { status: "error", errors: [r.error] }
  await prisma.tableReservation.update({
    where: { id: reservationId },
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
  await prisma.tableReservation.update({
    where: { id: reservationId },
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
  await prisma.tableReservation.update({
    where: { id: reservationId },
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

  await prisma.tableReservation.update({
    where: { id: reservationId },
    data: { status: TABLE_RESERVATION_STATUS.CANCELED },
  })
  const full = await getTableReservationById(reservationId)
  return { status: 'ok', ...(full ? { reservation: full } : {}) }
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
