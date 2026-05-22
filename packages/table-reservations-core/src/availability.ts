import prisma from '@repo/data/PrismaCient'
import type { AvailabilitySlot } from './types'
import {
  BLOCKING_TABLE_RESERVATION_STATUSES,
  BLOCKING_TABLE_RESERVATION_OP_STATUSES,
} from './status'
import {
  DEFAULT_TIME_ZONE,
  zonedWallClockToUtc,
  getZonedParts,
  civilDayOfWeek,
  parseCivilDate,
} from './tz'
import {
  pacingWindowStartMs,
  coversStartingInWindow,
  wouldExceedPacing,
} from './pacing'

const SLOT_STEP_MINUTES = 30

/** Parse "HH:mm" into numeric hour/minute. */
function parseHHMM(hhmm: string): { hour: number; minute: number } {
  const [h = 0, m = 0] = hhmm.split(':').map((s) => Number(s))
  return { hour: h, minute: m }
}

export interface GetAvailabilityInput {
  restaurantId: string
  /** Venue civil date "YYYY-MM-DD" — interpreted in the restaurant's timezone. */
  dateISO: string
  partySize: number
  /** Restrict to a single section (Table.zone). */
  sectionPreference?: string | null
  /** Require every listed feature (Table.features ⊇ requirements). */
  featureRequirements?: string[]
}

export interface GetAvailabilityResult {
  slots: AvailabilitySlot[]
  mealDurationMinutes: number
}

/**
 * Compute which time-slots on the venue's civil `dateISO` have at least one
 * suitable table free for a party of `partySize`. Slots are at
 * SLOT_STEP_MINUTES granularity (default 30 min) from open → close-duration.
 *
 * All wall-clock math runs in the **restaurant's timezone** (`timeZone`, default
 * `Europe/Madrid`), never the server process TZ — see `tz.ts`. A reservation
 * blocks a table whenever `from < slotEnd AND to > slotStart`, restricted to the
 * blocking status groups (same overlap pattern as RentalBooking).
 */
export async function getRestaurantAvailability(
  input: GetAvailabilityInput,
): Promise<GetAvailabilityResult> {
  if (!input.restaurantId) return { slots: [], mealDurationMinutes: 0 }
  if (!Number.isInteger(input.partySize) || input.partySize < 1) {
    return { slots: [], mealDurationMinutes: 0 }
  }
  const civil = parseCivilDate(input.dateISO)
  if (!civil) return { slots: [], mealDurationMinutes: 0 }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: input.restaurantId },
    select: {
      averageMealDuration: true,
      reservationWindow: true,
      timeZone: true,
      workingHours: { select: { day: true, openTime: true, closeTime: true } },
      shifts: {
        select: {
          day: true,
          startTime: true,
          endTime: true,
          pacingCovers: true,
          pacingWindowMinutes: true,
          lastSeatingOffsetMinutes: true,
        },
      },
    },
  })
  if (!restaurant) return { slots: [], mealDurationMinutes: 0 }

  const timeZone = restaurant.timeZone ?? DEFAULT_TIME_ZONE
  const mealDurationMinutes = restaurant.averageMealDuration

  // Enforce the reservation window: compare the requested civil date with
  // "today" in the venue's zone (not the server's).
  const now = new Date()
  const today = getZonedParts(now, timeZone)
  const msPerDay = 24 * 60 * 60 * 1000
  const reqMidUtc = Date.UTC(civil.year, civil.month - 1, civil.day)
  const todayMidUtc = Date.UTC(today.year, today.month - 1, today.day)
  const daysAhead = Math.round((reqMidUtc - todayMidUtc) / msPerDay)
  if (daysAhead < 0 || daysAhead > restaurant.reservationWindow) {
    return { slots: [], mealDurationMinutes }
  }

  const weekday = civilDayOfWeek(civil.year, civil.month, civil.day)
  // Shifts take precedence when defined for this weekday; otherwise fall back to
  // plain RestaurantHours (which carry no pacing).
  const shiftsForDay = restaurant.shifts.filter((s) => s.day === weekday)
  const hoursForDay = restaurant.workingHours.filter((h) => h.day === weekday)
  if (shiftsForDay.length === 0 && hoursForDay.length === 0) {
    return { slots: [], mealDurationMinutes }
  }

  // Eligible tables: active, online-bookable, capacity ≥ partySize AND
  // minPartySize ≤ partySize. `maxPartySize` (when set) further caps party size
  // even though physical `capacity` could fit more — a soft preference the
  // operator uses to steer big groups toward bigger tables.
  const where: Record<string, unknown> = {
    restaurantId: input.restaurantId,
    status: 'active',
    onlineBookable: true,
    capacity: { gte: input.partySize },
    minPartySize: { lte: input.partySize },
    OR: [{ maxPartySize: null }, { maxPartySize: { gte: input.partySize } }],
  }
  if (input.sectionPreference) where.zone = input.sectionPreference
  if (input.featureRequirements && input.featureRequirements.length > 0) {
    where.features = { hasEvery: input.featureRequirements }
  }
  const tables = await prisma.table.findMany({ where, select: { id: true } })
  if (tables.length === 0) return { slots: [], mealDurationMinutes }

  const tableIds = tables.map((t) => t.id)

  // The venue-local day window converted to UTC instants, for prefetching
  // reservations that overlap the day; intersect with each slot in-memory below.
  const dayStart = zonedWallClockToUtc(civil.year, civil.month, civil.day, 0, 0, timeZone)
  const dayEnd = new Date(dayStart.getTime() + msPerDay)

  // Restaurant-wide blocking reservations: per-table overlap is filtered by
  // tableId below; pacing sums party sizes across *all* tables.
  const reservations = await prisma.tableReservation.findMany({
    where: {
      restaurantId: input.restaurantId,
      status: { in: BLOCKING_TABLE_RESERVATION_STATUSES as string[] },
      operationalStatus: { in: BLOCKING_TABLE_RESERVATION_OP_STATUSES as string[] },
      from: { lt: dayEnd },
      to: { gt: dayStart },
    },
    select: { tableId: true, from: true, to: true, partySize: true, bookingGroupId: true },
  })
  // Pacing covers count each booking group once (a combination books N rows).
  const seenGroups = new Set<string>()
  const coverStarts: { fromMs: number; partySize: number }[] = []
  for (const r of reservations) {
    if (r.bookingGroupId) {
      if (seenGroups.has(r.bookingGroupId)) continue
      seenGroups.add(r.bookingGroupId)
    }
    coverStarts.push({ fromMs: r.from.getTime(), partySize: r.partySize })
  }

  // Predefined combinations are offered as a fallback when no single table fits
  // (only when no section/feature filter is active, since combos carry neither).
  const allowCombos =
    !input.sectionPreference && !(input.featureRequirements && input.featureRequirements.length > 0)
  const combinations = allowCombos
    ? await prisma.tableCombination.findMany({
        where: { restaurantId: input.restaurantId, capacity: { gte: input.partySize } },
        select: { id: true, tableIds: true },
      })
    : []

  const durationMs = mealDurationMinutes * 60 * 1000
  const toUtcMs = (hhmm: string): number => {
    const { hour, minute } = parseHHMM(hhmm)
    return zonedWallClockToUtc(civil.year, civil.month, civil.day, hour, minute, timeZone).getTime()
  }

  interface BookingWindow {
    startMs: number
    endMs: number
    pacingCovers: number | null
    pacingWindowMinutes: number
    lastSeatingOffsetMinutes: number | null
  }
  const windows: BookingWindow[] =
    shiftsForDay.length > 0
      ? shiftsForDay.map((s) => ({
          startMs: toUtcMs(s.startTime),
          endMs: toUtcMs(s.endTime),
          pacingCovers: s.pacingCovers,
          pacingWindowMinutes: s.pacingWindowMinutes,
          lastSeatingOffsetMinutes: s.lastSeatingOffsetMinutes,
        }))
      : hoursForDay.map((h) => ({
          startMs: toUtcMs(h.openTime),
          endMs: toUtcMs(h.closeTime),
          pacingCovers: null,
          pacingWindowMinutes: 15,
          lastSeatingOffsetMinutes: null,
        }))

  const slots: AvailabilitySlot[] = []
  const stepMs = SLOT_STEP_MINUTES * 60 * 1000

  for (const w of windows) {
    // Last viable start: the meal must end by window end, and not start later
    // than the last-seating cutoff (end − offset) when one is set.
    const offsetMs = w.lastSeatingOffsetMinutes != null ? w.lastSeatingOffsetMinutes * 60000 : 0
    const lastStart = w.endMs - Math.max(durationMs, offsetMs)
    for (let t = w.startMs; t <= lastStart; t += stepMs) {
      const slotFrom = new Date(t)
      const slotTo = new Date(t + durationMs)
      // Slots that end before "now" are not bookable.
      if (slotTo <= now) continue
      const isFree = (id: string) =>
        !reservations.some((r) => r.tableId === id && r.from < slotTo && r.to > slotFrom)
      const availableTableIds = tableIds.filter(isFree)
      // Offer combinations only when no single table fits this slot.
      const availableCombinationIds =
        availableTableIds.length === 0
          ? combinations.filter((c) => c.tableIds.every(isFree)).map((c) => c.id)
          : []
      if (availableTableIds.length === 0 && availableCombinationIds.length === 0) continue
      // Pacing: cap covers starting in this slot's pacing window.
      if (w.pacingCovers != null) {
        const windowStart = pacingWindowStartMs(t, w.pacingWindowMinutes)
        const existing = coversStartingInWindow(coverStarts, windowStart, w.pacingWindowMinutes)
        if (wouldExceedPacing(existing, input.partySize, w.pacingCovers)) continue
      }
      slots.push({
        from: slotFrom,
        to: slotTo,
        availableTableIds,
        ...(availableCombinationIds.length > 0 ? { availableCombinationIds } : {}),
      })
    }
  }

  return { slots, mealDurationMinutes }
}
