/**
 * Fetch + cache of the OpenStreetMap features around a site (track 030 `describe_site_area`). Server-only.
 *
 * Overpass is a best-effort public service: short timeout, mirrors raced (the same list the coastline cache
 * uses), an in-memory per-site cache (30 min) and a short negative cache so a flaky answer is not retried on
 * every tool call of one turn. The coastline tile cache (`coastline-db`) stores only coast ways, so it is not
 * reused here. Cached features are keyed by site id, so a `{osm: id}` can only resolve in the site it was listed for.
 */
import { OVERPASS_URLS } from '@repo/data/coastline-overpass'
import type { LatLng } from '../geo/frame'
import { buildOverpassQuery, parseOsmAnswer, type OsmFeature } from '../geo/osm'

const TTL_MS = 30 * 60_000
const FAIL_TTL_MS = 60_000
const MAX_SITES = 40
export const DEFAULT_FETCH_TIMEOUT_MS = 7000

interface Entry { at: number; origin: LatLng; radiusM: number; features: OsmFeature[]; failedAt?: number }
const cache = new Map<string, Entry>()

export function resetOsmCache() { cache.clear() }

const metresApart = (a: LatLng, b: LatLng) =>
  Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180))

export type OsmLoad = { ok: true; features: OsmFeature[]; cached: boolean } | { ok: false; reason: 'osm_unavailable' }

/** The features cached for this site (any radius), or null. Never fetches. */
export function cachedOsm(siteId: string): OsmFeature[] | null {
  const e = cache.get(siteId)
  return e && !e.failedAt && Date.now() - e.at < TTL_MS * 2 ? e.features : null
}

async function fetchOverpass(centre: LatLng, radiusM: number, timeoutMs: number): Promise<OsmFeature[] | null> {
  const body = `data=${encodeURIComponent(buildOverpassQuery(centre, radiusM))}`
  const ask = async (url: string) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Sunbnb-partner/0.1 (info@sunbnb.app)' },
      body,
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(String(res.status))
    const parsed = parseOsmAnswer((await res.json()) as Parameters<typeof parseOsmAnswer>[0])
    if (!parsed) throw new Error('incomplete')
    return parsed
  }
  try {
    return await Promise.any(OVERPASS_URLS.map(ask))
  } catch {
    return null
  }
}

export async function loadOsm(siteId: string, centre: LatLng, radiusM: number, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): Promise<OsmLoad> {
  const now = Date.now()
  const hit = cache.get(siteId)
  if (hit && metresApart(hit.origin, centre) < 50) {
    if (hit.failedAt && now - hit.failedAt < FAIL_TTL_MS) return { ok: false, reason: 'osm_unavailable' }
    if (!hit.failedAt && now - hit.at < TTL_MS && hit.radiusM >= radiusM) return { ok: true, features: hit.features, cached: true }
  }
  const features = await fetchOverpass(centre, radiusM, timeoutMs)
  if (cache.size >= MAX_SITES && !cache.has(siteId)) cache.delete(cache.keys().next().value as string)
  if (!features) {
    cache.set(siteId, { at: now, origin: centre, radiusM, features: hit?.features ?? [], failedAt: now })
    return { ok: false, reason: 'osm_unavailable' }
  }
  cache.set(siteId, { at: now, origin: centre, radiusM, features })
  return { ok: true, features, cached: false }
}
