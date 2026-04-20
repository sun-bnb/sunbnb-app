import { generateChairGrid, SUNBED_HEIGHT, SUNBED_WIDTH } from '@repo/schematic/grid'

export { SUNBED_HEIGHT, SUNBED_WIDTH }

export interface ChairConfig {
  itemGroupId?: string
  baseLat: number
  baseLng: number
  group: number
  rotation: number
  rows: number
  seatsPerRow: number
  horizontalGap: number
  verticalGap: number
  intraPairGap: number
  pairSeats: boolean
  category?: string
  price?: number
}

export interface ChairDefinition {
  tempId: string
  pairTempId?: string
  locationLat: string
  locationLng: string
  rotation: number
  group: number
  number: number
  isPrimary?: boolean
}

export function generateChairs(config: ChairConfig): ChairDefinition[] {
  const { baseLat, baseLng } = config
  const metersPerLat = 111320
  const metersPerLng = 111320 * Math.cos((baseLat * Math.PI) / 180)

  const cells = generateChairGrid({
    group: config.group,
    rotation: config.rotation,
    rows: config.rows,
    seatsPerRow: config.seatsPerRow,
    horizontalGap: config.horizontalGap,
    verticalGap: config.verticalGap,
    intraPairGap: config.intraPairGap,
    pairSeats: config.pairSeats,
  })

  return cells.map((cell) => ({
    tempId: cell.tempId,
    ...(cell.pairTempId ? { pairTempId: cell.pairTempId } : {}),
    locationLat: (baseLat + cell.dy / metersPerLat).toString(),
    locationLng: (baseLng + cell.dx / metersPerLng).toString(),
    rotation: cell.rotation,
    group: cell.group,
    number: cell.number,
    isPrimary: cell.isPrimary,
  }))
}

export interface SchematicChairConfig {
  itemGroupId?: string
  baseX: number
  baseY: number
  group: number
  rotation: number
  rows: number
  seatsPerRow: number
  horizontalGap: number
  verticalGap: number
  intraPairGap: number
  pairSeats: boolean
  category?: string
  price?: number
}

export interface SchematicChairDefinition {
  tempId: string
  pairTempId?: string
  schematicX: number
  schematicY: number
  rotation: number
  group: number
  number: number
  isPrimary?: boolean
}

export function generateChairsSchematic(config: SchematicChairConfig): SchematicChairDefinition[] {
  const { baseX, baseY } = config
  // The grid math is written for Y-up (geographic) coordinates: a cell's `dy`
  // points toward higher latitude = NORTH = UP on screen on a map. SVG schematic
  // coordinates are Y-down (+y = DOWN on screen). To make a "+rotation" delta
  // visually rotate the parcel CW on the schematic — matching how it rotates CW
  // on the map editor — we generate the layout with the inverse angle, then apply
  // the original rotation to each individual seat.
  const cells = generateChairGrid({
    group: config.group,
    rotation: -config.rotation,
    rows: config.rows,
    seatsPerRow: config.seatsPerRow,
    horizontalGap: config.horizontalGap,
    verticalGap: config.verticalGap,
    intraPairGap: config.intraPairGap,
    pairSeats: config.pairSeats,
  })

  return cells.map((cell) => ({
    tempId: cell.tempId,
    ...(cell.pairTempId ? { pairTempId: cell.pairTempId } : {}),
    schematicX: baseX + cell.dx,
    schematicY: baseY + cell.dy,
    rotation: config.rotation,
    group: cell.group,
    number: cell.number,
    isPrimary: cell.isPrimary,
  }))
}

export const PARCEL_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
]

export function getParcelColor(group: number): string | undefined {
  if (!group || group <= 0) return undefined
  return PARCEL_COLORS[(group - 1) % PARCEL_COLORS.length]
}
