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
 * Only coordinates leave us (no lead data). Responses are cached per ~10 m cell for 30 days to
 * stay within Overpass's fair-use policy at ad traffic.
 */
import type { NextRequest } from 'next/server'
import { rateLimit } from '@repo/data/rate-limit'
import { nearestShoreFrame, trimShore, type GeoPoint } from '@/lib/coastline.ts'
import { clientIp } from '@/lib/places.ts'

/**
 * Public Overpass instances, raced: the main one returned 504 after ~8 s under load
 * (2026-10-05) while a mirror still answered — one overloaded server must not decide whether a
 * prospect's beach faces the sea. First non-empty answer wins.
 */
const OVERPASS_URLS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']
/** Google's beach point can sit in the dunes behind the sand; beyond this there is no beach to snap to. */
const SEARCH_RADIUS_M = 400
const TIMEOUT_MS = 7000

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

  const query = `[out:json][timeout:5];way["natural"="coastline"](around:${SEARCH_RADIUS_M},${lat},${lng});out geom;`
  const ask = async (url: string) => {
    const res = await fetch(`${url}?data=${encodeURIComponent(query)}`, {
      headers: { 'user-agent': 'Sunbnb-marketing/0.1 (info@sunbnb.app)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: 60 * 60 * 24 * 30 },
    })
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as { elements?: { geometry?: { lat: number; lon: number }[] }[] }
    const ways: GeoPoint[][] = (data.elements ?? []).map((w) => (w.geometry ?? []).map((g) => ({ lat: g.lat, lng: g.lon })))
    const frame = nearestShoreFrame(ways, { lat, lng })
    return frame ? { frame, shore: trimShore(ways, { lat, lng }, 500) } : null
  }
  try {
    // An instance that answers "no coastline here" is a valid answer too — but only trust it once
    // every instance has had its say, so a fast empty mirror can't beat a slower correct one.
    const results = OVERPASS_URLS.map((u) => ask(u))
    const found = await Promise.any(results.map((r) => r.then((f) => f ?? Promise.reject(new Error('empty')))))
    return Response.json(found)
  } catch {
    // Timeout, every instance down, or truly no coastline: the visitor turns the beds by hand.
    return Response.json({ frame: null, shore: [] })
  }
}
