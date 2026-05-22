import prisma from '@repo/data/PrismaCient'
import { WAITLIST_STATUS } from '../status'

export interface WaitlistEntryRecord {
  id: string
  restaurantId: string
  dateISO: string
  requestedTime: string | null
  partySize: number
  guestName: string
  guestEmail: string
  guestPhone: string | null
  status: string
  notifiedAt: Date | null
  userId: string | null
  anonId: string | null
  createdAt: Date
}

const waitlistSelect = {
  id: true,
  restaurantId: true,
  dateISO: true,
  requestedTime: true,
  partySize: true,
  guestName: true,
  guestEmail: true,
  guestPhone: true,
  status: true,
  notifiedAt: true,
  userId: true,
  anonId: true,
  createdAt: true,
} as const

export async function listWaitlistForRestaurant(
  restaurantId: string,
  dateISO?: string,
): Promise<WaitlistEntryRecord[]> {
  return prisma.tableWaitlistEntry.findMany({
    where: { restaurantId, ...(dateISO ? { dateISO } : {}) },
    orderBy: { createdAt: 'asc' },
    select: waitlistSelect,
  })
}

/**
 * Earliest-first waiting entries for a day whose party fits within `maxPartySize`
 * (the capacity that just freed up). Used to pick whom to auto-notify.
 */
export async function findWaitlistMatches(
  restaurantId: string,
  dateISO: string,
  maxPartySize: number,
): Promise<WaitlistEntryRecord[]> {
  return prisma.tableWaitlistEntry.findMany({
    where: {
      restaurantId,
      dateISO,
      status: WAITLIST_STATUS.WAITING,
      partySize: { lte: maxPartySize },
    },
    orderBy: { createdAt: 'asc' },
    select: waitlistSelect,
  })
}
