/**
 * Spatial features and the relations between them (track 030). Pure, no IO.
 *
 * A feature is a parcel footprint (polygon + row bearing), a single seat (point), a schematic layout
 * element (polygon), an OSM road/path/building/poi (polyline / polygon / point), or the SHORELINE -- not
 * a shape but a `SeaModel` (signed distance to the waterline, bearing toward the water). All geometry is
 * in the local metre frame of `./frame` (x east, y north).
 *
 * `relate(a, b)` answers every "how far / which way / do they overlap" question; `moveToGap` answers
 * "move A so the gap to B is g" with a ready `by_m`.
 */
import { bearingOf, r2, unitOf, type Pt } from './frame'
import { centroid, dot, hypot, nearestOnPath, shapeGap, shift, sub, type Shape } from './shapes'

/** Answers the two shoreline questions in the local frame (map: OSM shore; schematic: water elements). */
export interface SeaModel {
  /** Signed metres from the shape's nearest point to the waterline: positive on land, NEGATIVE when any part is in the water. Null = unknown. */
  distance(poly: Pt[]): number | null
  /** Compass bearing from a point toward the water. Null = unknown. */
  bearing(p: Pt): number | null
}

export interface ShapeFeature extends Shape {
  /** What the model calls it ("parcel 4", "Bar"). */
  name?: string
  /** Direction the seats of a row run in (parcels only): enables row/column alignment facts. */
  rowBearingDegrees?: number
}
export interface ShoreFeature { kind: 'shore'; model: SeaModel; name?: string }
export type Feature = ShapeFeature | ShoreFeature

export interface WaterRect { x: number; y: number; width: number; height: number; rotation: number }

/** A schematic element (x,y = top-left, y DOWN, rotation clockwise on screen about the centre) as a north-up local-frame polygon. */
export function elementPolygon(e: WaterRect): Pt[] {
  const cx = e.x + e.width / 2
  const cy = -(e.y + e.height / 2)
  const t = (e.rotation * Math.PI) / 180
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const dx = (sx! * e.width) / 2
    const dy = (sy! * e.height) / 2
    return { x: cx + dx * Math.cos(t) + dy * Math.sin(t), y: cy - dx * Math.sin(t) + dy * Math.cos(t) }
  })
}

export const isShore = (f: Feature): f is ShoreFeature => f.kind === 'shore'

export const polygonFeature = (pts: Pt[], extra: Partial<ShapeFeature> = {}): ShapeFeature => ({ kind: 'polygon', pts, ...extra })
export const lineFeature = (pts: Pt[], extra: Partial<ShapeFeature> = {}): ShapeFeature => ({ kind: 'line', pts, ...extra })
export const pointFeature = (p: Pt, extra: Partial<ShapeFeature> = {}): ShapeFeature => ({ kind: 'point', pts: [p], ...extra })

export const featureCentre = (f: ShapeFeature): Pt => (f.kind === 'polygon' ? centroid(f.pts) : f.kind === 'point' ? f.pts[0]! : centroid(f.pts))

/** The point of `f` used to aim a move: polygon = centroid, point = itself, line = its closest point to `towards`. */
function referencePoint(f: ShapeFeature, towards: Pt): Pt {
  if (f.kind === 'line') return nearestOnPath(towards, f.pts, false)
  return featureCentre(f)
}

export interface Relation {
  /** Distance between the two reference points (centres; the nearest point of a polyline). */
  centreDistanceM: number
  /** Compass bearing from a's reference point to b's. */
  centreBearingDegrees: number
  /** Metres between the outlines; NEGATIVE = overlap depth. For the shoreline: metres from a's nearest part to the waterline (negative = in the water). */
  edgeGapM: number
  overlapping: boolean
  /** One feature entirely inside the other polygon. */
  containment: 'a_in_b' | 'b_in_a' | null
  /** Unit vector from a toward b (shoreline: toward the water): dx east, dy north. */
  direction: Pt
  /** The two reference points coincide, so `direction` is (0, 0) and no move can be aimed. */
  degenerate?: boolean
  /** Closest points when apart. */
  nearest: { a: Pt; b: Pt } | null
}

export type RelateResult = { ok: true; relation: Relation } | { ok: false; error: string }

/** The signed gap alone (what moveToGap iterates on). Null = unknown (no shore). */
function gapOf(a: ShapeFeature, b: Feature): number | null {
  if (isShore(b)) return b.model.distance(a.pts)
  return shapeGap(a, b).gap
}

export function relate(a: ShapeFeature, b: Feature): RelateResult {
  if (isShore(b)) {
    const c = centroid(a.pts)
    const bearing = b.model.bearing(c)
    const dist = b.model.distance(a.pts)
    if (bearing == null || dist == null) return { ok: false, error: 'no_shore_found' }
    return {
      ok: true,
      relation: {
        centreDistanceM: dist, centreBearingDegrees: bearing, edgeGapM: dist, overlapping: dist < 0,
        containment: null, direction: unitOf(bearing), nearest: null,
      },
    }
  }
  const g = shapeGap(a, b)
  // Aim at each other's reference points; a polyline's reference is its closest point to the other side.
  const ra = referencePoint(a, featureCentre(b))
  const rb = referencePoint(b, ra)
  const ra2 = a.kind === 'line' ? referencePoint(a, rb) : ra
  const delta = sub(rb, ra2)
  const dist = hypot(delta)
  // Reference points coincide (a seat at a 1x1 parcel's centre): the facts are still valid, only a direction is not.
  const degenerate = dist < 1e-6
  return {
    ok: true,
    relation: {
      centreDistanceM: dist,
      centreBearingDegrees: bearingOf(delta),
      edgeGapM: g.gap,
      overlapping: g.overlap,
      containment: g.containment,
      direction: degenerate ? { x: 0, y: 0 } : { x: delta.x / dist, y: delta.y / dist },
      degenerate,
      nearest: g.nearest,
    },
  }
}

export interface Move {
  /** Shift for `a` (a propose_move by_m) that makes the gap `targetGapM`. */
  by: Pt
  /** Gap after applying `by` (equals the target unless the geometry cannot reach it). */
  resultingGapM: number
}

/**
 * Move `a` along `direction` so the gap to `b` becomes `target`: start from the gap difference, then correct
 * for the shapes (offset / rotated outlines change the gap at a different rate than the reference points).
 */
export function moveToGap(a: ShapeFeature, b: Feature, direction: Pt, target: number): Move | null {
  const g0 = gapOf(a, b)
  if (g0 == null) return null
  let s = g0 - target
  for (let i = 0; i < 12; i++) {
    const g = gapOf({ ...a, pts: shift(a.pts, { x: direction.x * s, y: direction.y * s }) }, b)
    if (g == null) return null
    if (Math.abs(g - target) < 0.005) break
    s += g - target
  }
  const by = { x: direction.x * s, y: direction.y * s }
  const resulting = gapOf({ ...a, pts: shift(a.pts, by) }, b)
  return resulting == null ? null : { by, resultingGapM: resulting }
}

/**
 * Where a sits relative to b's rows. Only meaningful when b has a row bearing (a parcel): the offset of a's centre
 * along b's row axis and across it, and the moves that line a up with b.
 */
export function alignmentFacts(a: ShapeFeature, b: ShapeFeature) {
  if (b.rowBearingDegrees == null) return null
  const along = unitOf(b.rowBearingDegrees)
  const across = { x: along.y, y: -along.x } // 90 degrees clockwise: the direction rows are stacked in
  const off = sub(featureCentre(a), featureCentre(b))
  const oAlong = dot(off, along)
  const oAcross = dot(off, across)
  const mv = (v: Pt, k: number) => ({ dx: r2(v.x * k), dy: r2(v.y * k) })
  return {
    /** a's centre relative to b's, along b's row direction and across b's rows (metres). */
    offsetAlongRowsM: r2(oAlong),
    offsetAcrossRowsM: r2(oAcross),
    /** Moves for `a` (propose_move by_m): put a's rows on the same line as b's (keeps the offset along), or its columns level (keeps the offset across). */
    by_m_to_share_rows: mv(across, -oAcross),
    by_m_to_share_columns: mv(along, -oAlong),
  }
}
