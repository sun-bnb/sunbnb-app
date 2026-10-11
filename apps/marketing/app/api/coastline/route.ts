/**
 * GET /api/coastline?lat=…&lng=… → { frame: ShoreFrame | null, shore: GeoPoint[][], water: GeoPoint[][] }
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
 * (@repo/data/coastline-lookup `shoreAround`), filled one ~10 km tile at a time from Overpass — so
 * at ad traffic Overpass sees a handful of tile requests, not one per visitor.
 */
import type { NextRequest } from 'next/server'
import { allow } from '@/lib/limits.ts'
import { nearestShoreFrame, trimShore, verifyShoreFrame } from '@/lib/coastline.ts'
import { clientIp } from '@/lib/places.ts'
import { shoreAround } from '@repo/data/coastline-lookup'

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
  if (!(await allow('coastline', clientIp(request.headers)))) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const lat = coord(request.nextUrl.searchParams.get('lat'), 90)
  const lng = coord(request.nextUrl.searchParams.get('lng'), 180)
  if (lat === null || lng === null) return Response.json({ error: 'invalid_coordinates' }, { status: 400 })

  try {
    const { ways, water } = await shoreAround(lat, lng, SHORE_RADIUS_M)
    const raw = nearestShoreFrame(ways, { lat, lng })
    if (!raw || raw.distanceM > SEARCH_RADIUS_M) return Response.json({ frame: null, shore: [], water: [] })
    const frame = verifyShoreFrame(raw, water)
    return Response.json({ frame, shore: trimShore(ways, { lat, lng }, SHORE_RADIUS_M), water })
  } catch (err) {
    console.error('[marketing] coastline lookup failed', err)
    // The visitor turns the beds by hand; the page never blocks on this.
    return Response.json({ frame: null, shore: [], water: [] })
  }
}
