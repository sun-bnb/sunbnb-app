import prisma from '@repo/data/PrismaCient'
import type { AvailabilitySlot } from './types'
import {
  BLOCKING_TABLE_RESERVATION_STATUSES,
  BLOCKING_TABLE_RESERVATION_OP_STATUSES,
} from './status'

const SLOT_STEP_MINUTES = 30

/** Parse "HH:mm" into a Date on the given calendar day (local time). */
function timeOnDate(day: Date, hhmm: string): Date {
  const [hh = 0, mm = 0] = hhmm.split(':').map((s) => Number(s))
  const d = new Date(day)
  d.setHours(hh, mm, 0, 0)
  return d
}

/** Day-of-week in JS convention: 0 = Sunday .. 6 = Saturday. */
function dayOfWeek(date: Date): number {
  return date.getDay()
}

export interface GetAvailabilityInput {
  restaurantId: string
  date: Date
  partySize: number
}

export interface GetAvailabilityResult {
  slots: AvailabilitySlot[]
  mealDurationMinutes: number
}

/**
 * Compute which time-slots on `date` have at least one suitable table free
 * for a party of `partySize`. Slots are at SLOT_STEP_MINUTES granularity
 * (default 30 min) from open → close-duration.
 *
 * Uses the same time-overlap pattern as RentalBooking: a reservation blocks
 * a table whenever `from < slotEnd AND to > slotStart`, restricted to the
 * blocking status groups.
 */
export async function getRestaurantAvailability(
  input: GetAvailabilityInput,
): Promise<GetAvailabilityResult> {
  if (!input.restaurantId) return { slots: [], mealDurationMinutes: 0 }
  if (!Number.isInteger(input.partySize) || input.partySize < 1) {
    return { slots: [], mealDurationMinutes: 0 }
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: input.restaurantId },
    select: {
      averageMealDuration: true,
      reservationWindow: true,
      workingHours: { select: { day: true, openTime: true, closeTime: true } },
    },
  })
  if (!restaurant) return { slots: [], mealDurationMinutes: 0 }

  // Enforce reservation window (days ahead).
  const now = new Date()
  const msPerDay = 24 * 60 * 60 * 1000
  const daysAhead = Math.floor((input.date.getTime() - startOfDay(now).getTime()) / msPerDay)
  if (daysAhead < 0 || daysAhead > restaurant.reservationWindow) {
    return { slots: [], mealDurationMinutes: restaurant.averageMealDuration }
  }

  const hoursForDay = restaurant.workingHours.filter(
    (h) => h.day === dayOfWeek(input.date),
  )
  if (hoursForDay.length === 0) {
    return { slots: [], mealDurationMinutes: restaurant.averageMealDuration }
  }

  // Eligible tables: active, online-bookable, capacity ≥ partySize AND
  // minPartySize ≤ partySize. `maxPartySize` (when set) further caps party size
  // even though physical `capacity` could fit more — it's a soft preference
  // the operator uses to steer big groups toward bigger tables.
  const tables = await prisma.table.findMany({
    where: {
      restaurantId: input.restaurantId,
      status: 'active',
      onlineBookable: true,
      capacity: { gte: input.partySize },
      minPartySize: { lte: input.partySize },
      OR: [
        { maxPartySize: null },
        { maxPartySize: { gte: input.partySize } },
      ],
    },
    select: { id: true, capacity: true },
  })
  if (tables.length === 0) {
    return { slots: [], mealDurationMinutes: restaurant.averageMealDuration }
  }

  const tableIds = tables.map((t) => t.id)
  const dayStart = startOfDay(input.date)
  const dayEnd = new Date(dayStart.getTime() + msPerDay)

  // Pre-fetch all blocking reservations for these tables overlapping the day
  // window; intersect with each slot in-memory below.
  const reservations = await prisma.tableReservation.findMany({
    where: {
      tableId: { in: tableIds },
      status: { in: BLOCKING_TABLE_RESERVATION_STATUSES as string[] },
      operationalStatus: { in: BLOCKING_TABLE_RESERVATION_OP_STATUSES as string[] },
      from: { lt: dayEnd },
      to: { gt: dayStart },
    },
    select: { tableId: true, from: true, to: true },
  })

  const slots: AvailabilitySlot[] = []
  const duration = restaurant.averageMealDuration * 60 * 1000

  // For each open window on this day, walk in SLOT_STEP_MINUTES increments.
  for (const h of hoursForDay) {
    const open = timeOnDate(input.date, h.openTime)
    const close = timeOnDate(input.date, h.closeTime)
    // Last viable start so the meal ends by close.
    const lastStart = new Date(close.getTime() - duration)
    for (
      let t = open.getTime();
      t <= lastStart.getTime();
      t += SLOT_STEP_MINUTES * 60 * 1000
    ) {
      const slotFrom = new Date(t)
      const slotTo = new Date(t + duration)
      // Slots that end before "now" are not bookable.
      if (slotTo <= now) continue
      const availableTableIds = tableIds.filter((tableId) => {
        return !reservations.some(
          (r) =>
            r.tableId === tableId &&
            r.from < slotTo &&
            r.to > slotFrom,
        )
      })
      if (availableTableIds.length === 0) continue
      slots.push({
        from: slotFrom,
        to: slotTo,
        availableTableIds,
      })
    }
  }

  return { slots, mealDurationMinutes: restaurant.averageMealDuration }
}

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}
