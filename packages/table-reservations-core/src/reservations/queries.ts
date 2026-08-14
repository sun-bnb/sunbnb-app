import prisma from '@repo/data/PrismaCient'
import { DEFAULT_TIME_ZONE, parseCivilDate, zonedDayBounds } from '../tz'

const reservationSelect = {
  id: true,
  restaurantId: true,
  tableId: true,
  userId: true,
  anonId: true,
  from: true,
  to: true,
  partySize: true,
  status: true,
  operationalStatus: true,
  guestName: true,
  guestEmail: true,
  guestPhone: true,
  specialRequests: true,
  internalNotes: true,
  seatedAt: true,
  departedAt: true,
  depositAmount: true,
  depositStatus: true,
  paymentRef: true,
  createdAt: true,
} as const

export interface TableReservationRecord {
  id: string
  restaurantId: string
  tableId: string | null
  userId: string | null
  anonId: string | null
  from: Date
  to: Date
  partySize: number
  status: string
  operationalStatus: string
  guestName: string
  guestEmail: string
  guestPhone: string | null
  specialRequests: string | null
  internalNotes: string | null
  seatedAt: Date | null
  departedAt: Date | null
  depositAmount: number | null
  depositStatus: string | null
  paymentRef: string | null
  createdAt: Date
}

export async function getTableReservationById(
  id: string,
): Promise<TableReservationRecord | null> {
  return prisma.tableReservation.findUnique({
    where: { id },
    select: reservationSelect,
  })
}

export interface TableReservationListItem extends TableReservationRecord {
  table: {
    id: string
    number: number
    label: string | null
    capacity: number
  } | null
}

const listSelect = {
  ...reservationSelect,
  table: {
    select: { id: true, number: true, label: true, capacity: true },
  },
} as const

export interface ListReservationsOpts {
  from?: Date
  to?: Date
  statuses?: readonly string[]
  operationalStatuses?: readonly string[]
}

export async function listReservationsForRestaurant(
  restaurantId: string,
  opts: ListReservationsOpts = {},
): Promise<TableReservationListItem[]> {
  const where: Record<string, unknown> = { restaurantId }
  if (opts.from) {
    where.to = { gt: opts.from }
  }
  if (opts.to) {
    where.from = { lt: opts.to }
  }
  if (opts.statuses) where.status = { in: [...opts.statuses] }
  if (opts.operationalStatuses) where.operationalStatus = { in: [...opts.operationalStatuses] }

  return prisma.tableReservation.findMany({
    where,
    orderBy: [{ from: 'asc' }],
    select: listSelect,
  })
}

/**
 * Day view — list reservations overlapping the venue's civil `dateISO`
 * ("YYYY-MM-DD"). The day window is computed in the **restaurant's timezone**
 * (default `Europe/Madrid`), not the server process TZ.
 */
export async function listReservationsForDay(
  restaurantId: string,
  dateISO: string,
): Promise<TableReservationListItem[]> {
  const civil = parseCivilDate(dateISO)
  if (!civil) return []
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { timeZone: true },
  })
  const timeZone = restaurant?.timeZone ?? DEFAULT_TIME_ZONE
  // DST-safe venue day window (not `start + 24h`, which is wrong on transition days).
  const { start, end } = zonedDayBounds(civil.year, civil.month, civil.day, timeZone)
  return listReservationsForRestaurant(restaurantId, { from: start, to: end })
}

/**
 * Identity for an anonymous-or-authenticated customer. The caller decides
 * whether `userId` or `anonId` comes from the session/localStorage; this
 * helper enforces ownership either way.
 */
export interface CustomerIdentity {
  userId?: string | null
  anonId?: string | null
}

export function reservationOwnedBy(
  reservation: Pick<TableReservationRecord, 'userId' | 'anonId'>,
  identity: CustomerIdentity,
): boolean {
  if (reservation.userId && identity.userId && reservation.userId === identity.userId) return true
  if (reservation.anonId && identity.anonId && reservation.anonId === identity.anonId) return true
  return false
}

export interface ReminderDue {
  id: string
  from: Date
  to: Date
  partySize: number
  guestName: string
  guestEmail: string
  restaurant: { name: string; slug: string; tagline: string | null }
}

/**
 * Confirmed, still-expected reservations starting within `withinHours` that have
 * not had a reminder sent. Used by the daily reminder cron (app-orchestrated).
 */
export async function listReservationsNeedingReminder(
  withinHours: number,
): Promise<ReminderDue[]> {
  const now = new Date()
  const until = new Date(now.getTime() + withinHours * 60 * 60 * 1000)
  return prisma.tableReservation.findMany({
    where: {
      status: 'confirmed',
      operationalStatus: 'expected',
      reminderSentAt: null,
      from: { gte: now, lte: until },
    },
    select: {
      id: true,
      from: true,
      to: true,
      partySize: true,
      guestName: true,
      guestEmail: true,
      restaurant: { select: { name: true, slug: true, tagline: true } },
    },
  })
}
