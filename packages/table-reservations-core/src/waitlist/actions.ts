import prisma from '@repo/data/PrismaCient'
import type { ActionResult, WaitlistEntryInput } from '../types'
import { WAITLIST_STATUS } from '../status'
import { DEFAULT_TIME_ZONE, getZonedParts, parseCivilDate } from '../tz'
import { requireRestaurantOwner } from '../ownership'
import {
  type CustomerIdentity,
  reservationOwnedBy,
} from '../reservations/queries'
import {
  listWaitlistForRestaurant,
  findWaitlistMatches,
  type WaitlistEntryRecord,
} from './queries'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function validate(input: WaitlistEntryInput): string[] {
  const errors: string[] = []
  if (!input.restaurantId) errors.push('restaurantId is required')
  if (!parseCivilDate(input.dateISO)) errors.push('Invalid date')
  if (input.requestedTime && !TIME_RE.test(input.requestedTime)) errors.push('Invalid requested time')
  if (!Number.isInteger(input.partySize) || input.partySize < 1 || input.partySize > 50) {
    errors.push('Party size must be 1–50')
  }
  if (!input.guestName || input.guestName.trim().length === 0) errors.push('Guest name is required')
  if (!input.guestEmail || !EMAIL_RE.test(input.guestEmail)) errors.push('Valid guest email is required')
  if (!input.userId && !input.anonId) errors.push('Identity is required (userId or anonId)')
  return errors
}

export async function joinWaitlist(
  input: WaitlistEntryInput,
): Promise<ActionResult & { entry?: WaitlistEntryRecord }> {
  const errors = validate(input)
  if (errors.length > 0) return { status: 'error', errors }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: input.restaurantId },
    select: { id: true },
  })
  if (!restaurant) return { status: 'error', errors: ['Restaurant not found'] }

  const created = await prisma.tableWaitlistEntry.create({
    data: {
      restaurantId: input.restaurantId,
      dateISO: input.dateISO,
      requestedTime: input.requestedTime ?? null,
      partySize: input.partySize,
      guestName: input.guestName.trim(),
      guestEmail: input.guestEmail.trim().toLowerCase(),
      guestPhone: input.guestPhone?.trim() || null,
      status: WAITLIST_STATUS.WAITING,
      userId: input.userId ?? null,
      anonId: input.anonId ?? null,
    },
    select: { id: true },
  })
  const all = await listWaitlistForRestaurant(input.restaurantId, input.dateISO)
  const entry = all.find((e) => e.id === created.id)
  return { status: 'ok', ...(entry ? { entry } : {}) }
}

/** Customer leaves the waitlist. Ownership by userId/anonId. */
export async function leaveWaitlist(
  entryId: string,
  identity: CustomerIdentity,
): Promise<ActionResult> {
  const entry = await prisma.tableWaitlistEntry.findUnique({
    where: { id: entryId },
    select: { userId: true, anonId: true },
  })
  if (!entry) return { status: 'error', errors: ['Not found'] }
  if (!reservationOwnedBy(entry, identity)) return { status: 'error', errors: ['Not authorized'] }
  await prisma.tableWaitlistEntry.delete({ where: { id: entryId } })
  return { status: 'ok' }
}

export async function markWaitlistNotified(entryId: string): Promise<ActionResult> {
  await prisma.tableWaitlistEntry.update({
    where: { id: entryId },
    data: { status: WAITLIST_STATUS.NOTIFIED, notifiedAt: new Date() },
  })
  return { status: 'ok' }
}

export async function markWaitlistConverted(entryId: string): Promise<ActionResult> {
  await prisma.tableWaitlistEntry.update({
    where: { id: entryId },
    data: { status: WAITLIST_STATUS.CONVERTED },
  })
  return { status: 'ok' }
}

/**
 * Given a reservation that was just canceled/freed, return the earliest waiting
 * entry that could take its place (same venue day, party fits the freed table),
 * or null. The caller sends the notify email and calls markWaitlistNotified.
 */
export async function findWaitlistCandidateForFreedReservation(
  reservationId: string,
): Promise<WaitlistEntryRecord | null> {
  const res = await prisma.tableReservation.findUnique({
    where: { id: reservationId },
    select: {
      restaurantId: true,
      from: true,
      partySize: true,
      table: { select: { capacity: true } },
      restaurant: { select: { timeZone: true } },
    },
  })
  if (!res) return null
  const tz = res.restaurant.timeZone ?? DEFAULT_TIME_ZONE
  const p = getZonedParts(res.from, tz)
  const dateISO = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
  const capacity = res.table?.capacity ?? res.partySize
  const matches = await findWaitlistMatches(res.restaurantId, dateISO, capacity)
  return matches[0] ?? null
}

/** Staff removes/clears a waitlist entry. Ownership via the restaurant. */
export async function removeWaitlistEntryAsStaff(
  entryId: string,
  userId: string | null | undefined,
): Promise<ActionResult> {
  const entry = await prisma.tableWaitlistEntry.findUnique({
    where: { id: entryId },
    select: { restaurantId: true },
  })
  if (!entry) return { status: 'error', errors: ['Not found'] }
  const { error } = await requireRestaurantOwner(entry.restaurantId, userId)
  if (error) return { status: 'error', errors: [error] }
  await prisma.tableWaitlistEntry.delete({ where: { id: entryId } })
  return { status: 'ok' }
}
