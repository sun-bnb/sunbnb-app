import prisma from '@repo/data/PrismaCient'

export interface RestaurantShiftRecord {
  id: string
  restaurantId: string
  name: string
  day: number
  startTime: string
  endTime: string
  pacingCovers: number | null
  pacingWindowMinutes: number
  lastSeatingOffsetMinutes: number | null
  requiresDeposit: boolean
  depositMinPartySize: number | null
}

const shiftSelect = {
  id: true,
  restaurantId: true,
  name: true,
  day: true,
  startTime: true,
  endTime: true,
  pacingCovers: true,
  pacingWindowMinutes: true,
  lastSeatingOffsetMinutes: true,
  requiresDeposit: true,
  depositMinPartySize: true,
} as const

export async function listShiftsForRestaurant(
  restaurantId: string,
): Promise<RestaurantShiftRecord[]> {
  return prisma.restaurantShift.findMany({
    where: { restaurantId },
    orderBy: [{ day: 'asc' }, { startTime: 'asc' }],
    select: shiftSelect,
  })
}
