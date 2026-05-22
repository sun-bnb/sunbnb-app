import prisma from '@repo/data/PrismaCient'
import type { ActionResult, RestaurantShiftInput } from '../types'
import { requireRestaurantOwner } from '../ownership'

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function validateShifts(shifts: RestaurantShiftInput[]): string[] {
  const errors: string[] = []
  for (const s of shifts) {
    if (!s.name || s.name.trim().length === 0) errors.push('Shift name is required')
    if (s.name && s.name.length > 80) errors.push('Shift name too long (max 80)')
    if (!Number.isInteger(s.day) || s.day < 0 || s.day > 6) errors.push(`Invalid day: ${s.day}`)
    if (!TIME_RE.test(s.startTime)) errors.push(`Invalid startTime: ${s.startTime}`)
    if (!TIME_RE.test(s.endTime)) errors.push(`Invalid endTime: ${s.endTime}`)
    if (TIME_RE.test(s.startTime) && TIME_RE.test(s.endTime) && s.startTime >= s.endTime) {
      errors.push(`startTime must be before endTime (${s.name})`)
    }
    if (
      s.pacingCovers !== undefined && s.pacingCovers !== null &&
      (!Number.isInteger(s.pacingCovers) || s.pacingCovers < 1)
    ) {
      errors.push('pacingCovers must be a positive integer or empty')
    }
    if (
      s.pacingWindowMinutes !== undefined &&
      (!Number.isInteger(s.pacingWindowMinutes) || s.pacingWindowMinutes < 5 || s.pacingWindowMinutes > 240)
    ) {
      errors.push('pacingWindowMinutes must be 5–240')
    }
    if (
      s.lastSeatingOffsetMinutes !== undefined && s.lastSeatingOffsetMinutes !== null &&
      (!Number.isInteger(s.lastSeatingOffsetMinutes) || s.lastSeatingOffsetMinutes < 0 || s.lastSeatingOffsetMinutes > 360)
    ) {
      errors.push('lastSeatingOffsetMinutes must be 0–360')
    }
    if (
      s.depositMinPartySize !== undefined && s.depositMinPartySize !== null &&
      (!Number.isInteger(s.depositMinPartySize) || s.depositMinPartySize < 1)
    ) {
      errors.push('depositMinPartySize must be a positive integer or empty')
    }
  }
  return errors
}

/**
 * Replace the entire set of shifts for a restaurant. Replace-all (like
 * `setRestaurantHours`) — simpler than diff-and-patch for a small set.
 */
export async function setRestaurantShifts(
  restaurantId: string,
  shifts: RestaurantShiftInput[],
  userId: string | null | undefined,
): Promise<ActionResult> {
  const { error } = await requireRestaurantOwner(restaurantId, userId)
  if (error) return { status: 'error', errors: [error] }

  const errors = validateShifts(shifts)
  if (errors.length > 0) return { status: 'error', errors }

  await prisma.$transaction([
    prisma.restaurantShift.deleteMany({ where: { restaurantId } }),
    ...(shifts.length > 0
      ? [
          prisma.restaurantShift.createMany({
            data: shifts.map((s) => ({
              restaurantId,
              name: s.name.trim(),
              day: s.day,
              startTime: s.startTime,
              endTime: s.endTime,
              pacingCovers: s.pacingCovers ?? null,
              pacingWindowMinutes: s.pacingWindowMinutes ?? 15,
              lastSeatingOffsetMinutes: s.lastSeatingOffsetMinutes ?? null,
              requiresDeposit: s.requiresDeposit ?? false,
              depositMinPartySize: s.depositMinPartySize ?? null,
            })),
          }),
        ]
      : []),
  ])

  return { status: 'ok' }
}
