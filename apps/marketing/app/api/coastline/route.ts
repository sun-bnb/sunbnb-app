/**
 * GET /api/coastline?lat=…&lng=… → { frame: ShoreFrame | null, shore: GeoPoint[][] }
 *
 * `shore` is the coastline within ~500 m, so the page can keep every bed on the sand
 * (`lib/land-fit.ts`) however the parcel is turned or moved.
 *
 * Nearest OpenStreetMap coastline to a beach, reduced to a waterline point + sea bearing
 * (lib/coastline.ts). Called by the mockup map AFTER it renders: the public Overpass API answered
 * in 0.8 s and in 12 s+ during testing, so it must never block the page — the map shows a
 * default layout and snaps to the shore only if this answers.
 *
 * Only coordinates leave us (no lead data). The coastline comes from our own PostGIS cache
 * (@repo/data/coastline-db), filled one ~10 km tile at a time from Overpass — so at ad traffic
 * Overpass sees a handful of tile requests, not one per visitor.
 */
import type { NextRequest } from 'next/server'
import { rateLimit } from '@repo/data/rate-limit'
import { nearestShoreFrame, trimShore, type GeoPoint } from '@/lib/coastline.ts'
import { clientIp } from '@/lib/places.ts'
import { fetchCoastTile } from '@/lib/overpass.ts'
import { coastlineNear, storeCoastTile, uncoveredCoastTiles } from '@repo/data/coastline-db'
import { coastTilesAround } from '@repo/data/coastline-tiles'

/** Google's beach point can sit in the dunes behind the sand; beyond this there is no beach to snap to. */
const SEARCH_RADIUS_M = 400
/** How much coastline the page gets back, to keep the beds on the sand (lib/land-fit.ts). */
const SHORE_RADIUS_M = 500

// A first visit to an uncached coast waits for one Overpass tile fetch (≤ 9 s).
export const maxDuration = 20

function coord(raw: string | null, max: number): number | null {
  if (raw === null || !/^-?\d{1,3}(\.\d{1,10})?$/.test(raw)) return null
  const n = Number(raw)
  return Math.abs(n) <= max ? Math.round(n * 1e4) / 1e4 : null
}

export async function GET(request: NextRequest) {
  const limit = rateLimit(`coastline:${clientIp(request.headers)}`, { maxAttempts: 30, windowMs: 60_000 })
  if (!limit.allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const lat = coord(request.nextUrl.searchParams.get('lat'), 90)
  const lng = coord(request.nextUrl.searchParams.get('lng'), 180)
  if (lat === null || lng === null) return Response.json({ error: 'invalid_coordinates' }, { status: 400 })

  try {
    // Read-through cache: fetch any tile around the beach that was never fetched (once per ~10 km
    // tile, ever — pre-seeded for campaign coasts by scripts/seed-coastline.ts), then answer from
    // our own PostGIS table. A tile Overpass couldn't deliver stays uncovered and is retried by
    // the next visitor; whatever is already cached still answers.
    const missing = await uncoveredCoastTiles(coastTilesAround(lat, lng, SHORE_RADIUS_M))
    await Promise.all(
      missing.map(async (key) => {
        const ways = await fetchCoastTile(key)
        if (ways) await storeCoastTile(key, ways)
      }),
    )
    const ways: GeoPoint[][] = (await coastlineNear(lat, lng, SHORE_RADIUS_M)).map((w) => w.points)
    const frame = nearestShoreFrame(ways, { lat, lng })
    if (!frame || frame.distanceM > SEARCH_RADIUS_M) return Response.json({ frame: null, shore: [] })
    return Response.json({ frame, shore: trimShore(ways, { lat, lng }, SHORE_RADIUS_M) })
  } catch (err) {
    console.error('[marketing] coastline lookup failed', err)
    // The visitor turns the beds by hand; the page never blocks on this.
    return Response.json({ frame: null, shore: [] })
  }
}
