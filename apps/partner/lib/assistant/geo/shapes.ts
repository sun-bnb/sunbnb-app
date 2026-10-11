/**
 * Pure 2D shape maths in the local metre frame (track 030): points, open polylines and simple
 * polygons, and the signed gap between any two of them. No IO, no site concepts.
 */
import type { Pt } from './frame'

export type ShapeKind = 'polygon' | 'line' | 'point'
export interface Shape { kind: ShapeKind; pts: Pt[] }

export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })
export const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y
export const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x
export const hypot = (a: Pt) => Math.hypot(a.x, a.y)
export const shift = (pts: Pt[], d: Pt): Pt[] => pts.map((p) => ({ x: p.x + d.x, y: p.y + d.y }))

/** Area centroid of a polygon; the vertex mean for a degenerate (zero-area) ring. */
export function centroid(pts: Pt[]): Pt {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    const q = pts[(i + 1) % pts.length]!
    const w = p.x * q.y - q.x * p.y
    a += w
    cx += (p.x + q.x) * w
    cy += (p.y + q.y) * w
  }
  if (Math.abs(a) < 1e-9) return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length }
  return { x: cx / (3 * a), y: cy / (3 * a) }
}

export function closestOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const ab = sub(b, a)
  const len2 = dot(ab, ab)
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2))
  return { x: a.x + ab.x * t, y: a.y + ab.y * t }
}

export const distPointSegment = (p: Pt, a: Pt, b: Pt): number => hypot(sub(p, closestOnSegment(p, a, b)))

/** Closest point on the OUTLINE of a polygon (or along a polyline). */
export function nearestOnPath(p: Pt, pts: Pt[], closed: boolean): Pt {
  if (pts.length === 1) return pts[0]!
  let best = pts[0]!
  let bd = Infinity
  const n = closed ? pts.length : pts.length - 1
  for (let i = 0; i < n; i++) {
    const q = closestOnSegment(p, pts[i]!, pts[(i + 1) % pts.length]!)
    const d = hypot(sub(p, q))
    if (d < bd) { bd = d; best = q }
  }
  return best
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export function isConvex(poly: Pt[]): boolean {
  if (poly.length < 3) return false
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const c = cross(sub(poly[(i + 1) % poly.length]!, poly[i]!), sub(poly[(i + 2) % poly.length]!, poly[(i + 1) % poly.length]!))
    if (Math.abs(c) < 1e-9) continue
    if (sign === 0) sign = Math.sign(c)
    else if (Math.sign(c) !== sign) return false
  }
  return sign !== 0
}

/** Do the segments properly cross (a shared interior point, not just touching)? */
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(sub(b, a), sub(c, a))
  const d2 = cross(sub(b, a), sub(d, a))
  const d3 = cross(sub(d, c), sub(a, c))
  const d4 = cross(sub(d, c), sub(b, c))
  return d1 * d2 < 0 && d3 * d4 < 0
}

/**
 * Edge-to-edge gap between two CONVEX polygons: the smallest distance between their outlines when apart, the
 * NEGATIVE smallest penetration depth when they overlap (0 when exactly touching).
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
  return boundaryDistance({ kind: 'polygon', pts: a }, { kind: 'polygon', pts: b }).d
}

const segmentsOf = (s: Shape): Array<[Pt, Pt]> => {
  if (s.kind === 'point' || s.pts.length === 1) return [[s.pts[0]!, s.pts[0]!]]
  const n = s.kind === 'polygon' ? s.pts.length : s.pts.length - 1
  return Array.from({ length: n }, (_, i) => [s.pts[i]!, s.pts[(i + 1) % s.pts.length]!] as [Pt, Pt])
}

/** Smallest distance between the outlines (boundaries) of two shapes, with the closest pair; 0 when they cross. */
function boundaryDistance(a: Shape, b: Shape): { d: number; ca: Pt; cb: Pt; crossed: boolean } {
  let best = { d: Infinity, ca: a.pts[0]!, cb: b.pts[0]! }
  let crossed = false
  const consider = (p: Pt, q: Pt) => {
    const d = hypot(sub(p, q))
    if (d < best.d) best = { d, ca: p, cb: q }
  }
  for (const [p1, p2] of segmentsOf(a)) {
    for (const [q1, q2] of segmentsOf(b)) {
      if (segmentsCross(p1, p2, q1, q2)) {
        crossed = true
        best = { d: 0, ca: p1, cb: p1 }
        continue
      }
      consider(p1, closestOnSegment(p1, q1, q2))
      consider(p2, closestOnSegment(p2, q1, q2))
      consider(closestOnSegment(q1, p1, p2), q1)
      consider(closestOnSegment(q2, p1, p2), q2)
    }
  }
  return { ...best, crossed }
}

export interface ShapeGap {
  /** Metres between the outlines; NEGATIVE = overlap depth (0 = touching, or crossing with no vertex inside). */
  gap: number
  overlap: boolean
  /** One shape sits entirely inside the other polygon. */
  containment: 'a_in_b' | 'b_in_a' | null
  /** Closest points when the shapes are apart (or touching). */
  nearest: { a: Pt; b: Pt } | null
}

/** Signed gap between any two shapes (point / polyline / simple polygon). Convex-convex pairs use the exact SAT depth. */
export function shapeGap(a: Shape, b: Shape): ShapeGap {
  const bd = boundaryDistance(a, b)
  if (a.kind === 'polygon' && b.kind === 'polygon' && isConvex(a.pts) && isConvex(b.pts)) {
    const gap = polygonGap(a.pts, b.pts)
    return {
      gap,
      overlap: gap < -1e-9,
      containment: gap < 0 ? containment(a, b) : null,
      nearest: gap >= 0 ? { a: bd.ca, b: bd.cb } : null,
    }
  }
  const aIn = b.kind === 'polygon' ? a.pts.filter((p) => pointInPolygon(p, b.pts)) : []
  const bIn = a.kind === 'polygon' ? b.pts.filter((p) => pointInPolygon(p, a.pts)) : []
  const overlap = bd.crossed || aIn.length > 0 || bIn.length > 0
  if (!overlap) return { gap: bd.d, overlap: false, containment: null, nearest: { a: bd.ca, b: bd.cb } }
  const depth = Math.max(0, ...aIn.map((p) => hypot(sub(p, nearestOnPath(p, b.pts, true)))), ...bIn.map((p) => hypot(sub(p, nearestOnPath(p, a.pts, true)))))
  return { gap: depth > 0 ? -depth : 0, overlap: true, containment: containment(a, b), nearest: null }
}

function containment(a: Shape, b: Shape): 'a_in_b' | 'b_in_a' | null {
  if (b.kind === 'polygon' && a.pts.every((p) => pointInPolygon(p, b.pts)) && !boundaryDistance(a, b).crossed) return 'a_in_b'
  if (a.kind === 'polygon' && b.pts.every((p) => pointInPolygon(p, a.pts)) && !boundaryDistance(a, b).crossed) return 'b_in_a'
  return null
}

/** Is every point of `inner` inside the polygon `outer` (no crossing)? */
export function containsShape(outer: Shape, inner: Shape): boolean {
  return outer.kind === 'polygon' && containment(inner, outer) === 'a_in_b'
}

/** Douglas-Peucker on an open polyline. */
export function simplifyLine(pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 2) return pts
  let idx = -1
  let max = tol
  const a = pts[0]!
  const b = pts[pts.length - 1]!
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distPointSegment(pts[i]!, a, b)
    if (d > max) { max = d; idx = i }
  }
  if (idx < 0) return [a, b]
  return [...simplifyLine(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplifyLine(pts.slice(idx), tol)]
}

/** Simplify to at most `max` points by growing the tolerance (never below 2 points). */
export function capPoints(pts: Pt[], max: number, startTol = 0.5): Pt[] {
  let tol = startTol
  let out = simplifyLine(pts, tol)
  while (out.length > max && tol < 1e5) {
    tol *= 1.6
    out = simplifyLine(pts, tol)
  }
  return out.length > max ? out.slice(0, max) : out
}
