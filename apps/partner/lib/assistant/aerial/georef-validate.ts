/**
 * Shape + range check of a client-supplied `Georef` (track 030 S7) before it is stored. Pure.
 * Only `similarity` is accepted in the MVP (nothing produces a homography yet). The anchor must sit
 * within MAX_DISTANCE_FROM_SITE_M of the site's location: an alignment elsewhere is a mistake.
 */
import { latLngToEnu, normDeg, type LatLng, type SimilarityGeoref } from '@repo/agent/geo/georef'

export const MAX_DISTANCE_FROM_SITE_M = 5000
/** Plausible ground resolution of a beach photo, metres per (2000 px-frame) pixel. */
export const METERS_PER_PX_RANGE = [0.001, 5] as const
const MAX_PX = 100_000

export type GeorefValidation = { ok: true; georef: SimilarityGeoref } | { ok: false; errors: string[] }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function validateGeoref(value: unknown, siteCentre: LatLng | null): GeorefValidation {
  const bad = (msg: string): GeorefValidation => ({ ok: false, errors: [msg] })
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('georef must be an object')
  const g = value as Record<string, unknown>
  if (g.kind !== 'similarity') return bad('georef.kind must be "similarity"')
  const allowed = new Set(['kind', 'anchorPx', 'anchor', 'metersPerPx', 'rotationDeg'])
  if (Object.keys(g).some((k) => !allowed.has(k))) return bad('georef has unknown fields')
  const px = g.anchorPx as Record<string, unknown> | null
  if (!px || typeof px !== 'object' || !finite(px.x) || !finite(px.y) || Math.abs(px.x) > MAX_PX || Math.abs(px.y) > MAX_PX) return bad('georef.anchorPx must be finite pixel coordinates')
  const a = g.anchor as Record<string, unknown> | null
  if (!a || typeof a !== 'object' || !finite(a.lat) || !finite(a.lng) || Math.abs(a.lat) > 90 || Math.abs(a.lng) > 180) return bad('georef.anchor must be a valid lat/lng')
  if (!finite(g.metersPerPx) || g.metersPerPx < METERS_PER_PX_RANGE[0] || g.metersPerPx > METERS_PER_PX_RANGE[1]) return bad(`georef.metersPerPx must be within ${METERS_PER_PX_RANGE[0]}..${METERS_PER_PX_RANGE[1]}`)
  if (!finite(g.rotationDeg)) return bad('georef.rotationDeg must be a number')
  const anchor = { lat: a.lat, lng: a.lng }
  if (siteCentre) {
    const d = latLngToEnu(siteCentre, anchor)
    if (Math.hypot(d.e, d.n) > MAX_DISTANCE_FROM_SITE_M) return bad('The aligned photo is too far from the site location')
  }
  return {
    ok: true,
    georef: { kind: 'similarity', anchorPx: { x: px.x, y: px.y }, anchor, metersPerPx: g.metersPerPx, rotationDeg: normDeg(g.rotationDeg) },
  }
}
