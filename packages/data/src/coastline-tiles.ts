/**
 * The coastline cache's grid (track 027) — pure and client-safe (no prisma), so the marketing app
 * can reason about tiles without touching the DB layer. A tile is 0.1° × 0.1° (~11 × ≤11 km);
 * its key is "<floor(lat*10)>:<floor(lng*10)>".
 */
export const COAST_TILE_DEG = 0.1
const TILES_PER_DEG = 10
const M_PER_DEG_LAT = 111_320

/** Grid index of a coordinate. Multiply, never divide by 0.1: 2.3 / 0.1 = 22.999… in floating point. */
const index = (deg: number) => Math.floor(deg * TILES_PER_DEG + 1e-9)

export function coastTileKey(lat: number, lng: number): string {
  return `${index(lat)}:${index(lng)}`
}

export function coastTileBounds(key: string): { south: number; west: number; north: number; east: number } {
  const [i, j] = key.split(':').map(Number) as [number, number]
  const r = (n: number) => Math.round(n * 1e6) / 1e6
  return { south: r(i / TILES_PER_DEG), west: r(j / TILES_PER_DEG), north: r((i + 1) / TILES_PER_DEG), east: r((j + 1) / TILES_PER_DEG) }
}

/** Every tile a circle of `radiusM` around the point touches (1–4 for a few hundred metres). */
export function coastTilesAround(lat: number, lng: number, radiusM: number): string[] {
  const dLat = radiusM / M_PER_DEG_LAT
  const dLng = radiusM / (M_PER_DEG_LAT * Math.max(0.01, Math.cos((lat * Math.PI) / 180)))
  const keys = new Set<string>()
  for (const la of [lat - dLat, lat + dLat]) for (const ln of [lng - dLng, lng + dLng]) keys.add(coastTileKey(la, ln))
  return [...keys].sort()
}

/** Every tile covering a bounding box — for pre-seeding the coasts an ad campaign targets. */
export function coastTilesInBox(box: { south: number; west: number; north: number; east: number }): string[] {
  const keys: string[] = []
  for (let i = index(box.south); i < box.north * TILES_PER_DEG - 1e-9; i++) {
    for (let j = index(box.west); j < box.east * TILES_PER_DEG - 1e-9; j++) keys.push(`${i}:${j}`)
  }
  return keys
}
