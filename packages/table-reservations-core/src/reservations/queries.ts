import prisma from '@repo/data/PrismaCient'

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
 * Day view — list reservations that overlap the given local-day window.
 * `date` is interpreted as local midnight; the window runs up to the next
 * local midnight.
 */
export async function listReservationsForDay(
  restaurantId: string,
  date: Date,
): Promise<TableReservationListItem[]> {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
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
