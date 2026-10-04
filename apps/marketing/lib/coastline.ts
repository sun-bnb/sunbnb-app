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
