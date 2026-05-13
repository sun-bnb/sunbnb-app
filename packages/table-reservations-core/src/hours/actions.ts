import prisma from '@repo/data/PrismaCient'
import type { ActionResult, RestaurantHoursInput } from '../types'
import { requireRestaurantOwner } from '../ownership'

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function validateHours(hours: RestaurantHoursInput[]): string[] {
  const errors: string[] = []
  for (const h of hours) {
    if (!Number.isInteger(h.day) || h.day < 0 || h.day > 6) {
      errors.push(`Invalid day: ${h.day}`)
    }
    if (!TIME_RE.test(h.openTime)) errors.push(`Invalid openTime: ${h.openTime}`)
    if (!TIME_RE.test(h.closeTime)) errors.push(`Invalid closeTime: ${h.closeTime}`)
    if (TIME_RE.test(h.openTime) && TIME_RE.test(h.closeTime) && h.openTime >= h.closeTime) {
      errors.push(`openTime must be before closeTime on day ${h.day}`)
    }
  }
  return errors
}

/**
 * Replace the entire set of RestaurantHours rows for a restaurant.
 * Simpler than diff-and-patch, fine for a small 0–14 row set.
 */
export async function setRestaurantHours(
  restaurantId: string,
  hours: RestaurantHoursInput[],
  userId: string | null | undefined,
): Promise<ActionResult> {
  const { error } = await requireRestaurantOwner(restaurantId, userId)
  if (error) return { status: 'error', errors: [error] }

  const errors = validateHours(hours)
  if (errors.length > 0) return { status: 'error', errors }

  await prisma.$transaction([
    prisma.restaurantHours.deleteMany({ where: { restaurantId } }),
    ...(hours.length > 0
      ? [prisma.restaurantHours.createMany({
          data: hours.map((h) => ({
            restaurantId,
            day: h.day,
            openTime: h.openTime,
            closeTime: h.closeTime,
          })),
        })]
      : []),
  ])

  return { status: 'ok' }
}
