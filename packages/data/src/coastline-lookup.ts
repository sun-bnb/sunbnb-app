/**
 * Shoreline around a point — the DB-then-Overpass lookup behind the marketing `/api/coastline`
 * route, shared so the partner assistant (track 030 S7) reads the same shore. Server-only; needs
 * `COASTLINE_POSTGRES_URL` (every call throws without it — callers fall back to no shore).
 *
 * Returns raw geometry only; reducing it to a shore frame is `@repo/agent/geo/coastline`.
 */
import { coastlineNear, inlandShoreNear, storeCoastTile, uncoveredCoastTiles, waterNear, type CoastPoint } from './coastline-db'
import { fetchCoastTile } from './coastline-overpass'
import { coastTilesAround } from './coastline-tiles'

/** Water polygons are read this much wider than the shore, so a frame near the edge still verifies. */
const WATER_MARGIN_M = 200

export interface ShoreAround {
  /** Shore polylines (sea coastline, then lake/river shores), water on the right. */
  ways: CoastPoint[][]
  /** Water polygon rings (imported regions only); empty elsewhere. */
  water: CoastPoint[][]
}

export async function shoreAround(lat: number, lng: number, radiusM: number): Promise<ShoreAround> {
  // 1. Bulk-imported regions (scripts/import-coastline.ts — OSM coastlines + water polygons):
  //    answered from our own tables, never touching Overpass. Recognised by the imported rows
  //    themselves (negative ids), so a world import needs no per-tile bookkeeping.
  // Lakes, reservoirs and rivers (P15) come only from imported regions; read them alongside.
  let [found, inland] = await Promise.all([coastlineNear(lat, lng, radiusM), inlandShoreNear(lat, lng, radiusM)])
  let imported = found.filter((w) => w.id < 0)
  if (!imported.length) {
    // 2. Elsewhere: read-through cache, one Overpass request per never-fetched ~10 km tile.
    //    A tile Overpass couldn't deliver stays uncovered and is retried by the next caller.
    const missing = await uncoveredCoastTiles(coastTilesAround(lat, lng, radiusM))
    await Promise.all(
      missing.map(async (key) => {
        const ways = await fetchCoastTile(key)
        if (ways) await storeCoastTile(key, ways)
      }),
    )
    if (missing.length) found = await coastlineNear(lat, lng, radiusM)
    imported = found.filter((w) => w.id < 0)
  }
  // Imported and Overpass copies of the same shore can coexist; prefer one consistent source.
  // Lake and river shores follow the same water-on-the-right convention, so the nearest shore
  // wins whichever water it borders.
  const ways: CoastPoint[][] = [...(imported.length ? imported : found).map((w) => w.points), ...inland]
  const water = imported.length || inland.length ? await waterNear(lat, lng, radiusM + WATER_MARGIN_M) : []
  return { ways, water }
}
