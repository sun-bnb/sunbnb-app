import { randomUUID } from 'crypto'
import prisma from '@repo/data/PrismaCient'
import type { ActionResult, TableCombinationInput } from '../types'
import {
  BLOCKING_TABLE_RESERVATION_STATUSES,
  BLOCKING_TABLE_RESERVATION_OP_STATUSES,
  TABLE_RESERVATION_STATUS,
  TABLE_RESERVATION_OP_STATUS,
} from '../status'
import { requireRestaurantOwner } from '../ownership'
import { getCombinationById, type TableCombinationRecord } from './queries'
import {
  getTableReservationById,
  type TableReservationRecord,
} from '../reservations/queries'
import { resolvePacingForInstant } from '../reservations/actions'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validateCombinationInput(input: Partial<TableCombinationInput>): string[] {
  const errors: string[] = []
  if (input.name !== undefined && input.name !== null && input.name.length > 80) {
    errors.push('Name too long (max 80)')
  }
  if (input.capacity !== undefined) {
    if (!Number.isInteger(input.capacity) || input.capacity < 2 || input.capacity > 100) {
      errors.push('Capacity must be 2–100')
    }
  }
  if (input.tableIds !== undefined) {
    if (!Array.isArray(input.tableIds) || input.tableIds.length < 2) {
      errors.push('A combination needs at least 2 tables')
    } else if (new Set(input.tableIds).size !== input.tableIds.length) {
      errors.push('Duplicate tables in combination')
    }
  }
  return errors
}

/** Verify member tables exist, belong to the restaurant, and are combinable. */
async function assertValidMembers(restaurantId: string, tableIds: string[]): Promise<string | null> {
  const members = await prisma.table.findMany({
    where: { id: { in: tableIds } },
    select: { id: true, restaurantId: true, combinable: true },
  })
  if (members.length !== tableIds.length) return 'Some tables were not found'
  for (const m of members) {
    if (m.restaurantId !== restaurantId) return 'Table does not belong to this restaurant'
    if (!m.combinable) return 'All member tables must be marked combinable'
  }
  return null
}

export async function createCombination(
  restaurantId: string,
  input: TableCombinationInput,
  userId: string | null | undefined,
): Promise<ActionResult & { combination?: TableCombinationRecord }> {
  const { error } = await requireRestaurantOwner(restaurantId, userId)
  if (error) return { status: 'error', errors: [error] }

  const errors = validateCombinationInput(input)
  if (errors.length > 0) return { status: 'error', errors }

  const memberError = await assertValidMembers(restaurantId, input.tableIds)
  if (memberError) return { status: 'error', errors: [memberError] }

  const created = await prisma.tableCombination.create({
    data: {
      restaurantId,
      name: input.name ?? null,
      capacity: input.capacity,
      tableIds: input.tableIds,
    },
    select: { id: true },
  })
  const combination = await getCombinationById(created.id)
  return { status: 'ok', ...(combination ? { combination } : {}) }
}

export async function updateCombination(
  combinationId: string,
  patch: Partial<TableCombinationInput>,
  userId: string | null | undefined,
): Promise<ActionResult & { combination?: TableCombinationRecord }> {
  const existing = await prisma.tableCombination.findUnique({
    where: { id: combinationId },
    select: { id: true, restaurantId: true },
  })
  if (!existing) return { status: 'error', errors: ['Not found'] }

  const { error } = await requireRestaurantOwner(existing.restaurantId, userId)
  if (error) return { status: 'error', errors: [error] }

  const errors = validateCombinationInput(patch)
  if (errors.length > 0) return { status: 'error', errors }

  if (patch.tableIds !== undefined) {
    const memberError = await assertValidMembers(existing.restaurantId, patch.tableIds)
    if (memberError) return { status: 'error', errors: [memberError] }
  }

  const data: Record<string, unknown> = {}
  if (patch.name !== undefined) data.name = patch.name
  if (patch.capacity !== undefined) data.capacity = patch.capacity
  if (patch.tableIds !== undefined) data.tableIds = patch.tableIds

  await prisma.tableCombination.update({ where: { id: combinationId }, data })
  const combination = await getCombinationById(combinationId)
  return { status: 'ok', ...(combination ? { combination } : {}) }
}

export async function deleteCombination(
  combinationId: string,
  userId: string | null | undefined,
): Promise<ActionResult> {
  const existing = await prisma.tableCombination.findUnique({
    where: { id: combinationId },
    select: { restaurantId: true },
  })
  if (!existing) return { status: 'error', errors: ['Not found'] }

  const { error } = await requireRestaurantOwner(existing.restaurantId, userId)
  if (error) return { status: 'error', errors: [error] }

  await prisma.tableCombination.delete({ where: { id: combinationId } })
  return { status: 'ok' }
}

export interface CreateCombinationReservationInput {
  restaurantId: string
  combinationId: string
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

/**
 * Book a predefined combination for a large party. Creates one TableReservation
 * per member table sharing a `bookingGroupId`; each row blocks its own table via
 * the existing per-table overlap mechanism. Availability + pacing are re-checked
 * inside the transaction. Pacing counts the party once (dedup by group).
 */
export async function createCombinationReservation(
  input: CreateCombinationReservationInput,
): Promise<ActionResult & { reservation?: TableReservationRecord }> {
  const errors: string[] = []
  if (!(input.from instanceof Date) || Number.isNaN(input.from.getTime())) errors.push('Invalid from')
  if (!(input.to instanceof Date) || Number.isNaN(input.to.getTime())) errors.push('Invalid to')
  if (input.from && input.to && input.from >= input.to) errors.push('from must be before to')
  if (!Number.isInteger(input.partySize) || input.partySize < 1 || input.partySize > 50) {
    errors.push('Party size must be 1–50')
  }
  if (!input.guestName || input.guestName.trim().length === 0) errors.push('Guest name is required')
  if (!input.guestEmail || !EMAIL_RE.test(input.guestEmail)) errors.push('Valid guest email is required')
  if (!input.userId && !input.anonId) errors.push('Identity is required (userId or anonId)')
  if (input.from && input.from.getTime() < Date.now() - 60 * 1000) errors.push('Cannot book in the past')
  if (errors.length > 0) return { status: 'error', errors }

  const combination = await getCombinationById(input.combinationId)
  if (!combination) return { status: 'error', errors: ['Combination not found'] }
  if (combination.restaurantId !== input.restaurantId) {
    return { status: 'error', errors: ['Combination does not belong to this restaurant'] }
  }
  if (combination.capacity < input.partySize) {
    return { status: 'error', errors: ['Combination capacity is below the party size'] }
  }

  const pacing = await resolvePacingForInstant(input.restaurantId, input.from)
  const bookingGroupId = randomUUID()

  let failReason: 'SLOT_TAKEN' | 'PACING_FULL' | null = null
  const ok = await prisma
    .$transaction(async (tx) => {
      // Every member table must be free for the window.
      const overlap = await tx.tableReservation.count({
        where: {
          tableId: { in: combination.tableIds },
          status: { in: BLOCKING_TABLE_RESERVATION_STATUSES as string[] },
          operationalStatus: { in: BLOCKING_TABLE_RESERVATION_OP_STATUSES as string[] },
          from: { lt: input.to },
          to: { gt: input.from },
        },
      })
      if (overlap > 0) throw new Error('SLOT_TAKEN')

      if (pacing) {
        const windowEnd = new Date(pacing.windowStartMs + pacing.windowMinutes * 60000)
        const others = await tx.tableReservation.findMany({
          where: {
            restaurantId: input.restaurantId,
            status: { in: BLOCKING_TABLE_RESERVATION_STATUSES as string[] },
            operationalStatus: { in: BLOCKING_TABLE_RESERVATION_OP_STATUSES as string[] },
            from: { gte: new Date(pacing.windowStartMs), lt: windowEnd },
          },
          select: { partySize: true, bookingGroupId: true },
        })
        const existing = dedupCovers(others)
        if (existing + input.partySize > pacing.cap) throw new Error('PACING_FULL')
      }

      await tx.tableReservation.createMany({
        data: combination.tableIds.map((tableId) => ({
          restaurantId: input.restaurantId,
          tableId,
          bookingGroupId,
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
        })),
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

  const primary = await prisma.tableReservation.findFirst({
    where: { bookingGroupId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  const full = primary ? await getTableReservationById(primary.id) : null
  return { status: 'ok', ...(full ? { reservation: full } : {}) }
}

/** Sum party sizes, counting each booking group once. */
function dedupCovers(rows: Array<{ partySize: number; bookingGroupId: string | null }>): number {
  const seen = new Set<string>()
  let sum = 0
  for (const r of rows) {
    if (r.bookingGroupId) {
      if (seen.has(r.bookingGroupId)) continue
      seen.add(r.bookingGroupId)
    }
    sum += r.partySize
  }
  return sum
}
