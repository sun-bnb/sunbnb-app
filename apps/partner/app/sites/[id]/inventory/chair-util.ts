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
  const {
    baseLat,
    baseLng,
    group,
    rotation,
    rows,
    seatsPerRow,
    horizontalGap,
    verticalGap,
    intraPairGap,
    pairSeats,
  } = config

  const items: ChairDefinition[] = []
  const degToRad = (deg: number) => deg * (Math.PI / 180)
  const rad = degToRad(rotation)
  const metersPerLat = 111320
  const metersPerLng = 111320 * Math.cos(baseLat * Math.PI / 180)

  for (let r = 0; r < rows; r++) {
    let c = 0
    while (c < seatsPerRow) {
      const isPair = pairSeats && c + 1 < seatsPerRow
      const rowNum = (r + 1).toString().padStart(2, '0')
      const seatNum1 = (c + 1).toString().padStart(2, '0')
      const seatNum2 = (c + 2).toString().padStart(2, '0')

      // Calculate left-edge x offset of first chair in the current unit (chair or pair)
      const unitIndex = pairSeats ? Math.floor(c / 2) : c
      const dx1 = unitIndex * (pairSeats
        ? (intraPairGap + horizontalGap) // full pair width: inner gap + gap to next pair
        : horizontalGap)

      const dy1 = r * verticalGap
      const offsetLat1 = (dy1 * Math.cos(rad) - dx1 * Math.sin(rad)) / metersPerLat
      const offsetLng1 = (dy1 * Math.sin(rad) + dx1 * Math.cos(rad)) / metersPerLng

      const tempIdA = `${group}-R${rowNum}C${seatNum1}`
      const tempIdB = `${group}-R${rowNum}C${seatNum2}`

      const seatA: ChairDefinition = {
        tempId: tempIdA,
        ...(isPair ? { pairTempId: tempIdB } : {}),
        locationLat: (baseLat + offsetLat1).toString(),
        locationLng: (baseLng + offsetLng1).toString(),
        rotation,
        group,
        number: Number(`${group}${rowNum}${seatNum1}`),
        isPrimary: true,
      }

      items.push(seatA)

      if (isPair) {
        // Second chair in pair: intra-pair gap only (no horizontalGap)
        const dx2 = dx1 + intraPairGap
        const offsetLat2 = (dy1 * Math.cos(rad) - dx2 * Math.sin(rad)) / metersPerLat
        const offsetLng2 = (dy1 * Math.sin(rad) + dx2 * Math.cos(rad)) / metersPerLng

        const seatB: ChairDefinition = {
          tempId: tempIdB,
          pairTempId: tempIdA,
          locationLat: (baseLat + offsetLat2).toString(),
          locationLng: (baseLng + offsetLng2).toString(),
          rotation,
          group,
          number: Number(`${group}${rowNum}${seatNum2}`),
          isPrimary: false,
        }

        items.push(seatB)
        c += 2
      } else {
        c += 1
      }
    }
  }

  return items
}
