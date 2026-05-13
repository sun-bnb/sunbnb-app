export interface GridConfig {
  group: number
  rotation: number
  rows: number
  seatsPerRow: number
  horizontalGap: number
  verticalGap: number
  intraPairGap: number
  pairSeats: boolean
}

export interface GridCell {
  tempId: string
  pairTempId?: string
  dx: number
  dy: number
  rotation: number
  group: number
  number: number
  isPrimary?: boolean
}

export const SUNBED_HEIGHT = 2.1
export const SUNBED_WIDTH = 2.1 / 2.5

// ─── Restaurant tables ────────────────────────────────────────────────────
// Defaults cover a square 4-seater (≈1.2m per side), a round 4-seater
// (≈1.2m diameter), and a 2-seater rectangular (≈0.8m × 1.2m). Consumers
// of the grid pass in the exact size they want.

export type TableShape = 'square' | 'round' | 'rect' | 'oval' | 'booth' | 'bar'

export const TABLE_SHAPE_DEFAULTS: Record<
  TableShape,
  { width: number; height: number; capacity: number }
> = {
  square: { width: 1.2, height: 1.2, capacity: 4 },
  round: { width: 1.2, height: 1.2, capacity: 4 },
  rect: { width: 0.8, height: 1.2, capacity: 2 },
  oval: { width: 1.6, height: 1.0, capacity: 6 },
  booth: { width: 1.6, height: 0.9, capacity: 4 },
  bar: { width: 0.6, height: 0.6, capacity: 1 },
}

export interface TableGridConfig {
  rows: number
  tablesPerRow: number
  horizontalGap: number   // meters between adjacent tables in a row (centre-to-centre adjustment applied inside)
  verticalGap: number     // meters between rows
  tableWidth: number      // meters, along x before rotation
  tableHeight: number     // meters, along y before rotation
  capacity: number
  shape: TableShape
  rotation: number        // parcel-level rotation in degrees (CW in SVG Y-down)
}

export interface TableGridCell {
  tempId: string
  dx: number              // meters from origin
  dy: number
  rotation: number        // facing of this table, matches config.rotation
  number: number          // 1-based, row-major
  capacity: number
  shape: TableShape
}

/**
 * Generate a rectangular grid of tables. Pure geometry — no DB, no IO.
 * Mirrors the convention of {@link generateChairGrid}: the caller decides
 * what to do with the `dx, dy` deltas (apply metersPerLat/Lng for map
 * coordinates, or use them directly as SVG schematic coordinates).
 */
export function generateTableGrid(config: TableGridConfig): TableGridCell[] {
  const {
    rows,
    tablesPerRow,
    horizontalGap,
    verticalGap,
    tableWidth,
    tableHeight,
    capacity,
    shape,
    rotation,
  } = config

  const rad = rotation * (Math.PI / 180)
  const hGapCTC = horizontalGap + tableWidth   // centre-to-centre stride
  const vGapCTC = verticalGap + tableHeight

  const cells: TableGridCell[] = []

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < tablesPerRow; c++) {
      const localX = c * hGapCTC
      const localY = r * vGapCTC
      const dx = localY * Math.sin(rad) + localX * Math.cos(rad)
      const dy = localY * Math.cos(rad) - localX * Math.sin(rad)
      const rowNum = (r + 1).toString().padStart(2, '0')
      const colNum = (c + 1).toString().padStart(2, '0')
      cells.push({
        tempId: `T-R${rowNum}C${colNum}`,
        dx,
        dy,
        rotation,
        number: r * tablesPerRow + c + 1,
        capacity,
        shape,
      })
    }
  }

  return cells
}

export function generateChairGrid(config: GridConfig): GridCell[] {
  const {
    group,
    rotation,
    rows,
    seatsPerRow,
    horizontalGap,
    verticalGap,
    intraPairGap,
    pairSeats,
  } = config

  const rad = rotation * (Math.PI / 180)
  const cells: GridCell[] = []

  const pairCTC = intraPairGap + SUNBED_WIDTH
  const hGapCTC = horizontalGap + SUNBED_WIDTH
  const vGapCTC = verticalGap + SUNBED_HEIGHT

  for (let r = 0; r < rows; r++) {
    let c = 0
    while (c < seatsPerRow) {
      const isPair = pairSeats && c + 1 < seatsPerRow
      const rowNum = (r + 1).toString().padStart(2, '0')
      const seatNum1 = (c + 1).toString().padStart(2, '0')
      const seatNum2 = (c + 2).toString().padStart(2, '0')

      const unitIndex = pairSeats ? Math.floor(c / 2) : c
      const localX1 = unitIndex * (pairSeats ? pairCTC + hGapCTC : hGapCTC)
      const localY = r * vGapCTC

      const dx1 = localY * Math.sin(rad) + localX1 * Math.cos(rad)
      const dy1 = localY * Math.cos(rad) - localX1 * Math.sin(rad)

      const tempIdA = `${group}-R${rowNum}C${seatNum1}`
      const tempIdB = `${group}-R${rowNum}C${seatNum2}`

      cells.push({
        tempId: tempIdA,
        ...(isPair ? { pairTempId: tempIdB } : {}),
        dx: dx1,
        dy: dy1,
        rotation,
        group,
        number: Number(`${group}${rowNum}${seatNum1}`),
        isPrimary: true,
      })

      if (isPair) {
        const localX2 = localX1 + pairCTC
        const dx2 = localY * Math.sin(rad) + localX2 * Math.cos(rad)
        const dy2 = localY * Math.cos(rad) - localX2 * Math.sin(rad)

        cells.push({
          tempId: tempIdB,
          pairTempId: tempIdA,
          dx: dx2,
          dy: dy2,
          rotation,
          group,
          number: Number(`${group}${rowNum}${seatNum2}`),
          isPrimary: false,
        })
        c += 2
      } else {
        c += 1
      }
    }
  }

  return cells
}
