export interface ChairConfig {
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
}

export interface ChairDefinition {
  tempId: string
  pairTempId?: string
  locationLat: string
  locationLng: string
  rotation: number
  group: number
  number: number
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

  let globalCounter = 1

  for (let r = 0; r < rows; r++) {
    let c = 0
    while (c < seatsPerRow) {
      const isPair = pairSeats && c + 1 < seatsPerRow
      const dx1 = c * (pairSeats ? intraPairGap + horizontalGap : horizontalGap)
      const dy1 = r * verticalGap

      const offsetLat1 = (dy1 * Math.cos(rad) - dx1 * Math.sin(rad)) / metersPerLat
      const offsetLng1 = (dy1 * Math.sin(rad) + dx1 * Math.cos(rad)) / metersPerLng

      const tempIdA = `T${group}-${globalCounter}`
      const seatA: ChairDefinition = {
        tempId: tempIdA,
        ...(isPair ? { pairTempId: `T${group}-${globalCounter + 1}` } : {}),
        locationLat: (baseLat + offsetLat1).toString(),
        locationLng: (baseLng + offsetLng1).toString(),
        rotation,
        group,
        number: group * 1000 + globalCounter,
      }

      items.push(seatA)
      globalCounter++

      if (isPair) {
        const dx2 = dx1 + intraPairGap
        const offsetLat2 = (dy1 * Math.cos(rad) - dx2 * Math.sin(rad)) / metersPerLat
        const offsetLng2 = (dy1 * Math.sin(rad) + dx2 * Math.cos(rad)) / metersPerLng

        const seatB: ChairDefinition = {
          tempId: `T${group}-${globalCounter}`,
          pairTempId: tempIdA,
          locationLat: (baseLat + offsetLat2).toString(),
          locationLng: (baseLng + offsetLng2).toString(),
          rotation,
          group,
          number: group * 1000 + globalCounter,
        }

        items.push(seatB)
        globalCounter++
        c += 2
      } else {
        c += 1
      }
    }
  }

  return items
}
