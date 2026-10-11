/**
 * Pure "how far is this parcel from the sea, and which way" maths for the assistant (track 030).
 * No IO. A `SeaModel` answers two questions in one local metric frame (east x / north y, y UP):
 * the signed distance from a footprint to the waterline and the compass bearing toward the water.
 * Two models feed it: the OSM shoreline (map sites) and the schematic's water elements.
 */
import { nearestShoreFrame, signedShoreDistance, verifyShoreFrame, type GeoPoint } from '@repo/agent/geo/coastline'
import { angleBetween, bearingOf, M_PER_DEG, r1, r2, unitOf as unit, type Pt } from '../geo/frame'
import { elementPolygon, type SeaModel, type WaterRect } from '../geo/features'
import { centroid, nearestOnPath, pointInPolygon, polygonGap, shift } from '../geo/shapes'

export { elementPolygon }
export type { SeaModel, WaterRect }

// ─── map sites: OSM shoreline ───────────────────────────────────────────────

/** `origin` is the lat/lng of local (0,0); parcels' corners are metres from it. */
export function geoSeaModel(ways: GeoPoint[][], water: GeoPoint[][], origin: GeoPoint): SeaModel {
  const perLng = M_PER_DEG * Math.cos((origin.lat * Math.PI) / 180)
  const toLL = (p: Pt): GeoPoint => ({ lat: origin.lat + p.y / M_PER_DEG, lng: origin.lng + p.x / perLng })
  return {
    distance(poly) {
      // Corners and edge midpoints: the shore is (nearly) straight at parcel scale, so the nearest point of a convex footprint is a corner.
      const pts = poly.flatMap((p, i) => [p, { x: (p.x + poly[(i + 1) % poly.length]!.x) / 2, y: (p.y + poly[(i + 1) % poly.length]!.y) / 2 }])
      let min: number | null = null
      for (const p of pts) {
        const d = signedShoreDistance(ways, toLL(p), water)
        if (d != null && (min == null || d < min)) min = d
      }
      return min
    },
    bearing(p) {
      const raw = nearestShoreFrame(ways, toLL(p))
      return raw ? verifyShoreFrame(raw, water).seaBearingDeg : null
    },
  }
}

// ─── schematic sites: water elements ────────────────────────────────────────

/** Water elements already in the shared north-up frame. */
export function waterSeaModel(water: Pt[][]): SeaModel {
  return {
    distance(poly) {
      if (!water.length) return null
      return Math.min(...water.map((w) => polygonGap(poly, w)))
    },
    bearing(p) {
      let best: { d: number; q: Pt; inside: boolean } | null = null
      for (const w of water) {
        const q = nearestOnPath(p, w, true)
        const d = Math.hypot(p.x - q.x, p.y - q.y)
        if (!best || d < best.d) best = { d, q, inside: pointInPolygon(p, w) }
      }
      if (!best) return null
      // Outside: toward the nearest water. Inside: the water is "behind" the nearest bank, i.e. away from it.
      const v = best.inside ? { x: p.x - best.q.x, y: p.y - best.q.y } : { x: best.q.x - p.x, y: best.q.y - p.y }
      return best.d < 1e-9 ? null : bearingOf(v)
    },
  }
}

// ─── the measurement ────────────────────────────────────────────────────────

export interface SeaParcel {
  group: number
  /** Footprint corners in the shared frame, in `parcelShape` order (0-1 = first row, 2-3 = last row). */
  corners: Pt[]
  rowBearingDegrees: number
}

const EDGE_NAMES = ['first row', 'row end', 'last row', 'row end'] as const

export interface SeaResult {
  parcel: number
  seaBearingDegrees: number
  /** Metres from the nearest part of the footprint to the waterline; negative = partly in the water. */
  distanceToWaterM: number
  inWater: boolean
  /** The footprint edge that points most nearly at the sea. */
  seaFacingEdge: (typeof EDGE_NAMES)[number]
  /** True when the rows run along the shore, so a whole row faces the water (the usual beach layout). */
  rowsParallelToShore: boolean
  /** Move straight toward the sea so the nearest edge ends `target` from the waterline (negative = away from the sea). */
  by_m?: { dx: number; dy: number }
  resultingDistanceM?: number
}

export type SeaMeasurement =
  | { ok: false; reason: string }
  | { ok: true; parcels: SeaResult[]; shared?: { by_m: { dx: number; dy: number }; basedOnParcel: number; resultingDistancesM: Record<number, number> }; targetDistanceM?: number }

/** The shift along `dir` that puts the footprint `target` m from the water (a few secant steps: exact for a straight shore). */
function solveShift(poly: Pt[], dir: Pt, target: number, model: SeaModel): number | null {
  const d0 = model.distance(poly)
  if (d0 == null) return null
  let s = d0 - target
  for (let i = 0; i < 8; i++) {
    const d = model.distance(shift(poly, { x: dir.x * s, y: dir.y * s }))
    if (d == null) return null
    if (Math.abs(d - target) < 0.01) break
    s += d - target
  }
  return s
}

export function measureToSea(parcels: SeaParcel[], model: SeaModel, targetM?: number): SeaMeasurement {
  if (!parcels.length) return { ok: false, reason: 'no_parcels' }
  const rows: Array<SeaResult & { poly: Pt[]; dir: Pt; s?: number }> = []
  for (const p of parcels) {
    const c = centroid(p.corners)
    const bearing = model.bearing(c)
    const dist = model.distance(p.corners)
    if (bearing == null || dist == null) return { ok: false, reason: 'no_shore_found' }
    const edgeAngles = p.corners.map((a, i) => {
      const b = p.corners[(i + 1) % 4]!
      return angleBetween(bearingOf({ x: (a.x + b.x) / 2 - c.x, y: (a.y + b.y) / 2 - c.y }), bearing)
    })
    const facing = edgeAngles.indexOf(Math.min(...edgeAngles))
    const rel = (((p.rowBearingDegrees - bearing) % 180) + 180) % 180
    const dir = unit(bearing)
    const row: SeaResult & { poly: Pt[]; dir: Pt; s?: number } = {
      parcel: p.group,
      seaBearingDegrees: Math.round(bearing),
      distanceToWaterM: r1(dist),
      inWater: dist < 0,
      seaFacingEdge: EDGE_NAMES[facing]!,
      rowsParallelToShore: Math.abs(rel - 90) <= 20,
      poly: p.corners,
      dir,
    }
    if (targetM != null) {
      const s = solveShift(p.corners, dir, targetM, model)
      if (s != null) {
        row.s = s
        row.by_m = { dx: r2(dir.x * s), dy: r2(dir.y * s) }
        row.resultingDistanceM = r1(model.distance(shift(p.corners, { x: dir.x * s, y: dir.y * s })) ?? NaN)
      }
    }
    rows.push(row)
  }

  let shared: Extract<SeaMeasurement, { ok: true }>['shared']
  if (targetM != null && rows.length > 1) {
    // Group move: one vector, set by the parcel closest to the water, so every gap between the parcels is kept.
    const lead = rows.reduce((a, b) => (b.distanceToWaterM < a.distanceToWaterM ? b : a))
    if (lead.s != null) {
      const v = { x: lead.dir.x * lead.s, y: lead.dir.y * lead.s }
      const resulting: Record<number, number> = {}
      for (const r of rows) resulting[r.parcel] = r1(model.distance(shift(r.poly, v)) ?? NaN)
      shared = { by_m: { dx: r2(v.x), dy: r2(v.y) }, basedOnParcel: lead.parcel, resultingDistancesM: resulting }
    }
  }
  return {
    ok: true,
    parcels: rows.map(({ poly: _p, dir: _d, s: _s, ...pub }) => pub),
    ...(shared ? { shared } : {}),
    ...(targetM != null ? { targetDistanceM: targetM } : {}),
  }
}
