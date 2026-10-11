/**
 * Shoreline frame from OpenStreetMap coastline data (track 027, P2 v2).
 *
 * Google's point for a beach is often in the dunes or car park behind it, and nothing in Places
 * says which way the sea is. OSM coastline ways answer both: they are drawn with the WATER ON THE
 * RIGHT-HAND SIDE (OSM `natural=coastline` convention), so the nearest coastline segment gives the
 * waterline position AND the sea direction — no guessing.
 *
 * Pure: takes already-fetched way geometries, so the Overpass call (app/api/coastline) stays a
 * thin, cacheable proxy and this logic is unit-tested.
 */

export interface GeoPoint {
  lat: number
  lng: number
}

export interface ShoreFrame {
  /** Nearest point on the waterline. */
  waterline: GeoPoint
  /** Compass bearing from the beach toward the sea (perpendicular to the shore). */
  seaBearingDeg: number
  /** How far the query point was from the waterline. */
  distanceM: number
}

const M_PER_DEG_LAT = 111_320

export function nearestShoreFrame(ways: GeoPoint[][], point: GeoPoint): ShoreFrame | null {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((point.lat * Math.PI) / 180)
  // Local tangent plane around the query point, metres east (x) / north (y).
  const toXY = (p: GeoPoint) => ({ x: (p.lng - point.lng) * mPerDegLng, y: (p.lat - point.lat) * M_PER_DEG_LAT })

  let best: { d2: number; x: number; y: number; dx: number; dy: number } | null = null
  for (const way of ways) {
    for (let i = 0; i < way.length - 1; i++) {
      const a = toXY(way[i]!)
      const b = toXY(way[i + 1]!)
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len2 = dx * dx + dy * dy
      if (len2 === 0) continue
      // Projection of the origin (the query point) onto segment a→b, clamped to the segment.
      const t = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2))
      const x = a.x + t * dx
      const y = a.y + t * dy
      const d2 = x * x + y * y
      if (!best || d2 < best.d2) best = { d2, x, y, dx, dy }
    }
  }
  if (!best) return null

  // Bearing of the segment's direction of travel; the sea is 90° clockwise (to the right).
  const segmentBearing = (Math.atan2(best.dx, best.dy) * 180) / Math.PI
  const seaBearingDeg = Math.round((((segmentBearing + 90) % 360) + 360) % 360)

  return {
    waterline: { lat: point.lat + best.y / M_PER_DEG_LAT, lng: point.lng + best.x / mPerDegLng },
    seaBearingDeg,
    distanceM: Math.sqrt(best.d2),
  }
}

/**
 * Signed distance (metres) from a point to the nearest coastline: POSITIVE on land, NEGATIVE in
 * the sea — by the water polygons when given, else the water-on-the-right rule. Null with no
 * geometry.
 */
export function signedShoreDistance(ways: GeoPoint[][], point: GeoPoint, water?: GeoPoint[][]): number | null {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((point.lat * Math.PI) / 180)
  const toXY = (p: GeoPoint) => ({ x: (p.lng - point.lng) * mPerDegLng, y: (p.lat - point.lat) * M_PER_DEG_LAT })
  let best: { d2: number; side: number } | null = null
  for (const way of ways) {
    for (let i = 0; i < way.length - 1; i++) {
      const a = toXY(way[i]!)
      const b = toXY(way[i + 1]!)
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len2 = dx * dx + dy * dy
      if (len2 === 0) continue
      const t = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2))
      const x = a.x + t * dx
      const y = a.y + t * dy
      const d2 = x * x + y * y
      // Cross product of the segment direction with segment-start→point: > 0 left (land), < 0 right (sea).
      const side = dx * (0 - a.y) - dy * (0 - a.x)
      if (!best || d2 < best.d2 - 1e-9) best = { d2, side }
    }
  }
  if (!best) return null
  // With water polygons, which side is decided by them — exact, even on bends where the nearest
  // segment's side can mislead. Without, by the water-on-the-right rule.
  const sign = water?.length ? (inWater(water, point) ? -1 : 1) : Math.sign(best.side || 1)
  return sign * Math.sqrt(best.d2)
}

/** Only the coastline near a beach, for the page: segments with an end within `radiusM`. */
export function trimShore(ways: GeoPoint[][], center: GeoPoint, radiusM = 500): GeoPoint[][] {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180)
  const near = (p: GeoPoint) => Math.hypot((p.lng - center.lng) * mPerDegLng, (p.lat - center.lat) * M_PER_DEG_LAT) <= radiusM
  const round = (p: GeoPoint) => ({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 })
  const out: GeoPoint[][] = []
  for (const way of ways) {
    let run: GeoPoint[] = []
    for (let i = 0; i < way.length; i++) {
      const keep = near(way[i]!) || (i > 0 && near(way[i - 1]!)) || (i < way.length - 1 && near(way[i + 1]!))
      if (keep) run.push(round(way[i]!))
      else if (run.length) {
        if (run.length > 1) out.push(run)
        run = []
      }
    }
    if (run.length > 1) out.push(run)
  }
  return out
}

/**
 * Is the point in the sea? Even-odd ray casting over every ring of the imported water polygons
 * (outer rings and holes alike), so islands inside a clipped sea polygon come out as land.
 */
export function inWater(rings: GeoPoint[][], p: GeoPoint): boolean {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!
      const b = ring[j]!
      if (a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside
    }
  }
  return inside
}

/**
 * Check a snap's sea direction against the water polygons, when we have them: a point a few
 * metres seaward of the waterline must be in the sea. If the polygons say otherwise (a mis-drawn
 * or reversed coastline way), turn the frame round. Without polygons the frame is unchanged.
 */
export function verifyShoreFrame(frame: ShoreFrame, water: GeoPoint[][]): ShoreFrame {
  if (!water.length) return frame
  const probe = (deg: number, m: number) => {
    const r = (deg * Math.PI) / 180
    const mPerDegLng = M_PER_DEG_LAT * Math.cos((frame.waterline.lat * Math.PI) / 180)
    return { lat: frame.waterline.lat + (Math.cos(r) * m) / M_PER_DEG_LAT, lng: frame.waterline.lng + (Math.sin(r) * m) / mPerDegLng }
  }
  const seaward = inWater(water, probe(frame.seaBearingDeg, 8))
  const landward = inWater(water, probe(frame.seaBearingDeg + 180, 8))
  if (!seaward && landward) return { ...frame, seaBearingDeg: (frame.seaBearingDeg + 180) % 360 }
  return frame
}
