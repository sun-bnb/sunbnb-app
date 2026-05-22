import prisma from '@repo/data/PrismaCient'

const tableSelect = {
  id: true,
  restaurantId: true,
  number: true,
  label: true,
  capacity: true,
  minPartySize: true,
  maxPartySize: true,
  shape: true,
  width: true,
  height: true,
  schematicX: true,
  schematicY: true,
  rotation: true,
  status: true,
  zone: true,
  staffNote: true,
  onlineBookable: true,
  combinable: true,
  features: true,
  turnTimeMinutes: true,
  locked: true,
  seatsTop: true,
  seatsRight: true,
  seatsBottom: true,
  seatsLeft: true,
} as const

export interface TableRecord {
  id: string
  restaurantId: string
  number: number
  label: string | null
  capacity: number
  minPartySize: number
  maxPartySize: number | null
  shape: string
  width: number
  height: number
  schematicX: number | null
  schematicY: number | null
  rotation: number
  status: string
  zone: string | null
  staffNote: string | null
  onlineBookable: boolean
  combinable: boolean
  features: string[]
  turnTimeMinutes: number | null
  locked: boolean
  seatsTop: number | null
  seatsRight: number | null
  seatsBottom: number | null
  seatsLeft: number | null
}

export async function listTablesForRestaurant(
  restaurantId: string,
): Promise<TableRecord[]> {
  return prisma.table.findMany({
    where: { restaurantId },
    orderBy: { number: 'asc' },
    select: tableSelect,
  })
}

export async function getTableById(id: string): Promise<TableRecord | null> {
  return prisma.table.findUnique({ where: { id }, select: tableSelect })
}
