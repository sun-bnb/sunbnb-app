/**
 * Pure parcel geometry for the assistant's read tools (track 030): where a parcel sits, how big it is,
 * and how two parcels relate. NOT a tool and no IO, so the model can be handed facts it can reason with
 * ("move parcel 5 closer to parcel 4") instead of having to ask the user for coordinates.
 *
 * Conventions (shared with the editor via `parcelFootprint` / `generateChairGrid`): a parcel is a rectangle
 * around its ANCHOR (the first sunbed); `rotation` turns it clockwise on screen. Internally everything is
 * metres, east (x) / north (y, UP). Map sites project lat/lng with 111320 m/deg (cos(lat) for lng), the
 * same equirectangular rule as chair-util; schematic y grows DOWN so it is flipped at the edges.
 */
import { parcelFootprint } from '@repo/schematic'
import type { ParcelSummary } from '@/app/sites/[id]/parcels'

export type LayoutMode = 'geo' | 'schematic'
export interface Pt { x: number; y: number }

const M_PER_DEG = 111320
const r1 = (v: number) => Math.round(v * 10) / 10
const r6 = (v: number) => Math.round(v * 1e6) / 1e6
const r2 = (v: number) => Math.round(v * 100) / 100

/** A parcel in local metres (east/north-up), plus the facts the model is shown. */
export interface ParcelShape {
  /** Corners and centre in metres, relative to the shape's own anchor. */
  localCorners: Pt[]
  localCentre: Pt
  /** Anchor in the site's own coordinates. */
  anchor: { lat: number; lng: number } | { x: number; y: number }
  /** Size in metres: along the rows (the seat axis) x across rows. */
  sizeM: { alongRows: number; acrossRows: number }
  /** Compass bearing (degrees clockwise from north) of the direction the seats of a row run in. */
  rowBearingDegrees: number
}

type GeoSource = Pick<
  ParcelSummary,
  'rows' | 'seatsPerRow' | 'horizontalGap' | 'verticalGap' | 'pairGap' | 'rotation' | 'locationLat' | 'locationLng' | 'schematicX' | 'schematicY'
>

const norm360 = (d: number) => ((d % 360) + 360) % 360

/** Parcel shape, or null when the parcel has no ItemGroup geometry / anchor (legacy parcels). */
export function parcelShape(p: GeoSource, mode: LayoutMode): ParcelShape | null {
  if (p.rows == null || p.seatsPerRow == null) return null
  let anchor: ParcelShape['anchor']
  if (mode === 'schematic') {
    if (p.schematicX == null || p.schematicY == null) return null
    anchor = { x: p.schematicX, y: p.schematicY }
  } else {
    const lat = Number(p.locationLat)
    const lng = Number(p.locationLng)
    if (p.locationLat == null || p.locationLng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
    anchor = { lat, lng }
  }
  const rot = p.rotation ?? 0
  const cfg = {
    rows: p.rows, seatsPerRow: p.seatsPerRow, horizontalGap: p.horizontalGap ?? 0, verticalGap: p.verticalGap ?? 0,
    intraPairGap: p.pairGap ?? 0, pairSeats: (p.pairGap ?? 0) > 0,
  }
  // The footprint at the equator is metres/111320 in both axes. The schematic grid is generated with the
  // inverse angle and its dy is SCREEN-down, so after the same call the north component is negated.
  const raw = parcelFootprint({ lat: 0, lng: 0 }, { ...cfg, rotation: mode === 'schematic' ? -rot : rot })
  const localCorners = raw.map((c) => ({ x: c.lng * M_PER_DEG, y: (mode === 'schematic' ? -c.lat : c.lat) * M_PER_DEG }))
  const unflat = parcelFootprint({ lat: 0, lng: 0 }, { ...cfg, rotation: 0 })
  const alongRows = Math.abs(unflat[1]!.lng - unflat[0]!.lng) * M_PER_DEG
  const acrossRows = Math.abs(unflat[2]!.lat - unflat[1]!.lat) * M_PER_DEG
  const rad = (rot * Math.PI) / 180
  const rowBearingDegrees = norm360((Math.atan2(Math.cos(rad), -Math.sin(rad)) * 180) / Math.PI)
  const localCentre = {
    x: localCorners.reduce((s, c) => s + c.x, 0) / 4,
    y: localCorners.reduce((s, c) => s + c.y, 0) / 4,
  }
  return { localCorners, localCentre, anchor, sizeM: { alongRows, acrossRows }, rowBearingDegrees }
}

/** Metres (east, north-up) to a point in the site's coordinates, relative to `anchor`. */
function toSite(anchor: ParcelShape['anchor'], m: Pt): { lat: number; lng: number } | { x: number; y: number } {
  if ('lat' in anchor) {
    const perLng = M_PER_DEG * Math.cos((anchor.lat * Math.PI) / 180)
    return { lat: anchor.lat + m.y / M_PER_DEG, lng: anchor.lng + m.x / perLng }
  }
  return { x: anchor.x + m.x, y: anchor.y - m.y }
}

const roundSite = (pt: { lat: number; lng: number } | { x: number; y: number }) =>
  'lat' in pt ? { lat: r6(pt.lat), lng: r6(pt.lng) } : { x: r1(pt.x), y: r1(pt.y) }

/** The model-facing position facts. `compact` keeps only centre, size and bearing (for list_parcels). */
export function positionFacts(p: GeoSource, mode: LayoutMode, compact = false) {
  const s = parcelShape(p, mode)
  if (!s) return null
  const base = {
    centre: roundSite(toSite(s.anchor, s.localCentre)),
    sizeM: { alongRows: r1(s.sizeM.alongRows), acrossRows: r1(s.sizeM.acrossRows) },
    rowBearingDegrees: Math.round(s.rowBearingDegrees * 10) / 10,
  }
  if (compact) return base
  return { anchor: roundSite(s.anchor), ...base, corners: s.localCorners.map((c) => roundSite(toSite(s.anchor, c))) }
}

// ─── two-parcel measurement ─────────────────────────────────────────────────

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y

function distPointSegment(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a)
  const len2 = dot(ab, ab)
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2))
  return Math.hypot(p.x - (a.x + ab.x * t), p.y - (a.y + ab.y * t))
}

/**
 * Edge-to-edge gap between two convex polygons: the smallest distance between their outlines when apart,
 * and the NEGATIVE smallest penetration depth when they overlap (0 when exactly touching).
 */
export function polygonGap(a: Pt[], b: Pt[]): number {
  // Separating-axis test over both polygons' edge normals: the largest separation along any axis.
  let best = -Infinity
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const e = sub(poly[(i + 1) % poly.length]!, poly[i]!)
      const len = Math.hypot(e.x, e.y)
      if (len === 0) continue
      const n = { x: e.y / len, y: -e.x / len }
      const pa = a.map((p) => dot(p, n))
      const pb = b.map((p) => dot(p, n))
      best = Math.max(best, Math.max(Math.min(...pa) - Math.max(...pb), Math.min(...pb) - Math.max(...pa)))
    }
  }
  if (best <= 0) return best === 0 ? 0 : best
  // Apart: the true distance is vertex-to-edge somewhere (the axis value only under-reads corner-to-corner).
  let min = Infinity
  for (const [p, q] of [[a, b], [b, a]] as const) {
    for (const v of p) for (let i = 0; i < q.length; i++) min = Math.min(min, distPointSegment(v, q[i]!, q[(i + 1) % q.length]!))
  }
  return min
}

const shift = (poly: Pt[], d: Pt): Pt[] => poly.map((p) => ({ x: p.x + d.x, y: p.y + d.y }))

export type Measurement =
  | { ok: false; error: string }
  | {
      ok: true
      centreDistanceM: number
      /** Compass bearing (degrees clockwise from north) from `from`'s centre to `to`'s centre. */
      centreBearingDegrees: number
      edgeGapM: number
      overlapping: boolean
      /** Unit vector from `from` to `to`: dx east, dy north. */
      direction: { dx: number; dy: number }
      targetGapM: number
      /** Move for `from` (propose_move by_m) that makes the edge gap `targetGapM`, along the centre line. */
      by_m: { dx: number; dy: number }
      /** Edge gap after applying by_m (equals the target unless the geometry cannot reach it). */
      resultingGapM: number
    }

export function measureParcels(from: GeoSource, to: GeoSource, mode: LayoutMode, targetGapM = 2): Measurement {
  const a = parcelShape(from, mode)
  const b = parcelShape(to, mode)
  if (!a || !b) return { ok: false, error: 'parcel_has_no_geometry' }

  // Put both in one metric frame, origin = a's anchor.
  let bOffset: Pt
  if ('lat' in a.anchor && 'lat' in b.anchor) {
    const midLat = (a.anchor.lat + b.anchor.lat) / 2
    bOffset = {
      x: (b.anchor.lng - a.anchor.lng) * M_PER_DEG * Math.cos((midLat * Math.PI) / 180),
      y: (b.anchor.lat - a.anchor.lat) * M_PER_DEG,
    }
  } else if ('x' in a.anchor && 'x' in b.anchor) {
    bOffset = { x: b.anchor.x - a.anchor.x, y: -(b.anchor.y - a.anchor.y) }
  } else return { ok: false, error: 'mixed_layout_modes' }

  const polyA = a.localCorners
  const polyB = shift(b.localCorners, bOffset)
  const cA = a.localCentre
  const cB = { x: b.localCentre.x + bOffset.x, y: b.localCentre.y + bOffset.y }
  const delta = sub(cB, cA)
  const dist = Math.hypot(delta.x, delta.y)
  const gap = polygonGap(polyA, polyB)
  if (dist < 1e-6) return { ok: false, error: 'parcels_share_the_same_centre' }
  const u = { x: delta.x / dist, y: delta.y / dist }

  // Move along the centre line by s: start from the gap difference, then correct for the polygons'
  // shape (offset / rotated parcels make the edge gap change at a different rate than the centres).
  let s = gap - targetGapM
  for (let i = 0; i < 12; i++) {
    const g = polygonGap(shift(polyA, { x: u.x * s, y: u.y * s }), polyB)
    if (Math.abs(g - targetGapM) < 0.005) break
    s += g - targetGapM
  }
  const resulting = polygonGap(shift(polyA, { x: u.x * s, y: u.y * s }), polyB)
  return {
    ok: true,
    centreDistanceM: r1(dist),
    centreBearingDegrees: Math.round(norm360((Math.atan2(delta.x, delta.y) * 180) / Math.PI) * 10) / 10,
    edgeGapM: r1(gap),
    overlapping: gap < 0,
    direction: { dx: r2(u.x), dy: r2(u.y) },
    targetGapM,
    by_m: { dx: r2(u.x * s), dy: r2(u.y * s) },
    resultingGapM: r1(resulting),
  }
}
