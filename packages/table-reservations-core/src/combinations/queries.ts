import prisma from '@repo/data/PrismaCient'

export interface TableCombinationRecord {
  id: string
  restaurantId: string
  name: string | null
  capacity: number
  tableIds: string[]
}

const combinationSelect = {
  id: true,
  restaurantId: true,
  name: true,
  capacity: true,
  tableIds: true,
} as const

export async function listCombinationsForRestaurant(
  restaurantId: string,
): Promise<TableCombinationRecord[]> {
  return prisma.tableCombination.findMany({
    where: { restaurantId },
    orderBy: { createdAt: 'asc' },
    select: combinationSelect,
  })
}

export async function getCombinationById(
  id: string,
): Promise<TableCombinationRecord | null> {
  return prisma.tableCombination.findUnique({ where: { id }, select: combinationSelect })
}
