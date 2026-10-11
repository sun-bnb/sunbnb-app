/**
 * The assistant's one local metric frame (track 030). Pure, no IO.
 *
 * Every spatial tool talks in this frame: x = metres EAST, y = metres NORTH of an origin, so a
 * `by_m` { dx, dy } from any tool is directly usable by `propose_move`.
 *
 *  - Map ('geo') sites: origin = a fixed lat/lng (the site location), equirectangular projection
 *    (111320 m per degree of latitude; longitude scaled by cos(origin latitude)) -- the same rule as
 *    chair-util / the parcel footprint code.
 *  - Schematic sites are already metres from the canvas' top-left corner, but their y grows DOWN.
 *    The frame is the canvas corner with y negated: schematic (sx, sy) <-> local (sx, -sy). Local y is
 *    therefore <= 0 for everything on the canvas. The tools say so in their output.
 */
export type LayoutMode = 'geo' | 'schematic'
export interface Pt { x: number; y: number }
export interface LatLng { lat: number; lng: number }
export type SitePoint = LatLng | Pt

export const M_PER_DEG = 111320

export type Frame = { mode: 'geo'; origin: LatLng; perLng: number } | { mode: 'schematic' }

export const geoFrame = (origin: LatLng): Frame => ({ mode: 'geo', origin, perLng: M_PER_DEG * Math.cos((origin.lat * Math.PI) / 180) })
export const schematicFrame = (): Frame => ({ mode: 'schematic' })

/** A point in the site's own coordinates (lat/lng on a map, x/y metres on a schematic) -> local metres. Null on a mode mismatch. */
export function toLocal(frame: Frame, p: SitePoint): Pt | null {
  if (frame.mode === 'geo') {
    if (!('lat' in p)) return null
    return { x: (p.lng - frame.origin.lng) * frame.perLng, y: (p.lat - frame.origin.lat) * M_PER_DEG }
  }
  if (!('x' in p)) return null
  return { x: p.x, y: -p.y }
}

/** Local metres -> the site's own coordinates. */
export function toSite(frame: Frame, p: Pt): SitePoint {
  if (frame.mode === 'geo') return { lat: frame.origin.lat + p.y / M_PER_DEG, lng: frame.origin.lng + p.x / frame.perLng }
  return { x: p.x, y: -p.y }
}

/** The frame as shown to the model, so it never has to guess the axes. */
export function describeFrame(frame: Frame) {
  if (frame.mode === 'geo') {
    return {
      mode: 'geo' as const,
      axes: 'x = metres east, y = metres north of origin',
      origin: { lat: Math.round(frame.origin.lat * 1e6) / 1e6, lng: Math.round(frame.origin.lng * 1e6) / 1e6 },
    }
  }
  return {
    mode: 'schematic' as const,
    axes: 'x = metres east (same as the canvas x), y = metres NORTH = minus the canvas y (canvas y grows down), so everything on the canvas has y <= 0',
    origin: 'top-left corner of the canvas',
  }
}

/** Rounding helpers; `+ 0` turns -0 into 0 so output never prints "-0". */
export const r1 = (v: number) => Math.round(v * 10) / 10 + 0
export const r2 = (v: number) => Math.round(v * 100) / 100 + 0
export const r6 = (v: number) => Math.round(v * 1e6) / 1e6
export const norm360 = (d: number) => ((d % 360) + 360) % 360
/** Compass bearing (degrees clockwise from north) of a vector in the local frame. */
export const bearingOf = (v: Pt) => norm360((Math.atan2(v.x, v.y) * 180) / Math.PI)
/** Unit vector (east, north) of a compass bearing. */
export const unitOf = (bearingDeg: number): Pt => ({ x: Math.sin((bearingDeg * Math.PI) / 180), y: Math.cos((bearingDeg * Math.PI) / 180) })
export const angleBetween = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)
