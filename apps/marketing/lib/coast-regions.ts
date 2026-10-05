/**
 * Named coastline regions (track 027): what the bulk import and the Overpass seeding cover.
 * Boxes are generous — inland area costs nothing (no coastline rows; tiles marked "no coast").
 * Add a country by adding its boxes here; `world` covers everything.
 */
export interface Box {
  south: number
  west: number
  north: number
  east: number
}

export const COAST_REGIONS: Record<string, Box[]> = {
  // All of Spain: mainland (incl. Portugal's and southern France's edges — harmless), Balearics,
  // Canaries, Ceuta and Melilla.
  spain: [
    { south: 35.8, west: -9.6, north: 43.9, east: 3.45 },
    { south: 38.6, west: 1.1, north: 40.15, east: 4.4 },
    { south: 27.5, west: -18.3, north: 29.5, east: -13.3 },
    { south: 35.2, west: -5.45, north: 35.95, east: -2.9 },
  ],
  balearics: [{ south: 38.6, west: 1.1, north: 40.15, east: 4.4 }],
  mallorca: [{ south: 39.25, west: 2.3, north: 39.97, east: 3.48 }],
  menorca: [{ south: 39.8, west: 3.78, north: 40.1, east: 4.33 }],
  ibiza: [{ south: 38.63, west: 1.15, north: 39.13, east: 1.62 }],
  'costa-del-sol': [{ south: 36.4, west: -5.4, north: 36.8, east: -4.2 }],
  'costa-blanca': [{ south: 37.85, west: -0.8, north: 38.85, east: 0.25 }],
  'costa-brava': [{ south: 41.65, west: 2.75, north: 42.45, east: 3.35 }],
  world: [{ south: -90, west: -180, north: 90, east: 180 }],
}

export function regionBoxes(names: string[]): [string, Box][] {
  return names.flatMap((name) => {
    const boxes = COAST_REGIONS[name]
    if (!boxes) throw new Error(`unknown region "${name}" — one of: ${Object.keys(COAST_REGIONS).join(', ')}`)
    return boxes.map((b): [string, Box] => [name, b])
  })
}
