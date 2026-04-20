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
