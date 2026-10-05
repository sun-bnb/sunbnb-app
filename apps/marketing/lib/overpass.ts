/**
 * Fetch one coastline-cache tile from the public Overpass API (track 027). Server-only.
 *
 * Instances are raced: the main one returned 504 after ~8 s under load (2026-10-05) while a
 * mirror still answered. An answer counts only if it is complete — Overpass reports its own
 * timeouts as HTTP 200 with a `remark`, which would otherwise be cached as "no coast here".
 */
import type { CoastWay } from '@repo/data/coastline-db'
import { coastTileBounds } from '@repo/data/coastline-tiles'

export const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

interface OverpassAnswer {
  remark?: string
  elements?: { type: string; id: number; geometry?: { lat: number; lon: number }[] }[]
}

/** Parse an Overpass answer into coastline ways; null when the answer is incomplete. Pure. */
export function parseCoastAnswer(data: OverpassAnswer): CoastWay[] | null {
  if (data.remark && /error|timed out|runtime/i.test(data.remark)) return null
  if (!Array.isArray(data.elements)) return null
  return data.elements
    .filter((e) => e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length >= 2)
    .map((e) => ({ id: e.id, points: e.geometry!.map((g) => ({ lat: g.lat, lng: g.lon })) }))
}

export async function fetchCoastTile(key: string, timeoutMs = 9000): Promise<CoastWay[] | null> {
  const b = coastTileBounds(key)
  const query = `[out:json][timeout:25];way["natural"="coastline"](${b.south},${b.west},${b.north},${b.east});out geom;`
  const ask = async (url: string) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Sunbnb-marketing/0.1 (info@sunbnb.app)' },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(String(res.status))
    const ways = parseCoastAnswer((await res.json()) as OverpassAnswer)
    if (!ways) throw new Error('incomplete')
    return ways
  }
  try {
    return await Promise.any(OVERPASS_URLS.map(ask))
  } catch {
    return null
  }
}
