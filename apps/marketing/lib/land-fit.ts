/**
 * Keep the parcel on the sand (track 027): after a snap, a manual turn or a move, a long or turned
 * parcel can poke into the sea where the shore curves. Using the real coastline (water on the
 * right, `signedShoreDistance`), slide the whole parcel inland — perpendicular to the SHORE, not
 * to however the visitor turned the beds — until every bed is at least `gapM` from the water.
 * Pure; a few passes cover curved shores.
 */
import { generateBeachLayout, type LayoutInput, type MockSunbed } from './beach-layout.ts'
import { signedShoreDistance, type GeoPoint } from './coastline.ts'

export type Frame = Required<Pick<LayoutInput, 'anchor' | 'seaBearingDeg' | 'placement'>>

const M_PER_DEG_LAT = 111_320
const PASSES = 4

/** The beds that can reach the water first: the whole front row, and both ends of every row. */
function exposed(beds: MockSunbed[]): MockSunbed[] {
  const byRow = new Map<number, MockSunbed[]>()
  for (const b of beds) byRow.set(b.row, [...(byRow.get(b.row) ?? []), b])
  const out = new Set<MockSunbed>()
  for (const [row, list] of byRow) {
    if (row === 0) list.forEach((b) => out.add(b))
    out.add(list[0]!)
    out.add(list[list.length - 1]!)
  }
  return [...out]
}

export function keepOnLand(frame: Frame, sunbedCount: number, shore: GeoPoint[][], opts: { gapM?: number; shoreSeaBearingDeg: number }): Frame {
  const gap = opts.gapM ?? 4
  const inland = ((opts.shoreSeaBearingDeg + 180) * Math.PI) / 180
  let f = frame
  for (let pass = 0; pass < PASSES; pass++) {
    const beds = exposed(generateBeachLayout({ ...f, sunbedCount }).sunbeds)
    let min = Infinity
    for (const b of beds) {
      const d = signedShoreDistance(shore, b)
      if (d !== null && d < min) min = d
    }
    if (!Number.isFinite(min) || min >= gap - 0.05) return f
    const shift = gap - min + 0.5
    const mPerDegLng = M_PER_DEG_LAT * Math.cos((f.anchor.lat * Math.PI) / 180)
    f = {
      ...f,
      anchor: {
        lat: f.anchor.lat + (Math.cos(inland) * shift) / M_PER_DEG_LAT,
        lng: f.anchor.lng + (Math.sin(inland) * shift) / mPerDegLng,
      },
    }
  }
  return f
}

/**
 * The sand under the parcel itself: its footprint plus a margin, in the parcel's own frame. With
 * `shoreBand` it makes the beds stand on sand where Google's water and the OSM coastline disagree
 * (Copacabana, 2026-10-05: beds the coastline puts 6 m up the beach were drawn on Google's sea).
 */
export function parcelGround(beds: readonly MockSunbed[], frame: Frame): GeoPoint[] {
  if (!beds.length) return []
  const sea = (frame.seaBearingDeg * Math.PI) / 180
  const seaE = Math.sin(sea)
  const seaN = Math.cos(sea)
  const o = frame.anchor
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((o.lat * Math.PI) / 180)
  const local = (p: GeoPoint) => {
    const e = (p.lng - o.lng) * mPerDegLng
    const n = (p.lat - o.lat) * M_PER_DEG_LAT
    return { x: e * -seaN + n * seaE, y: e * seaE + n * seaN } // x along shore, y toward the sea
  }
  const geo = (x: number, y: number) => ({
    lat: o.lat + (x * seaE + y * seaN) / M_PER_DEG_LAT,
    lng: o.lng + (x * -seaN + y * seaE) / mPerDegLng,
  })
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const b of beds) {
    const p = local(b)
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  }
  const pad = 2.5
  return [geo(minX - pad, minY - pad), geo(maxX + pad, minY - pad), geo(maxX + pad, maxY + pad), geo(minX - pad, maxY + pad)]
}

/**
 * A strip of sand along the OSM coastline, `widthM` inland (water on the right ⇒ land on the left
 * of each way). Painted in the basemap's sand colour it is invisible where Google and OSM agree,
 * and fills Google's water up to the OSM waterline where they don't — a natural beach edge that
 * follows the coast, not a rectangle. One polygon per way.
 */
export function shoreBand(shore: GeoPoint[][], widthM: number): GeoPoint[][] {
  const out: GeoPoint[][] = []
  for (const way of shore) {
    if (way.length < 2) continue
    const lat0 = way[0]!.lat
    const mPerDegLng = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180)
    const xy = way.map((p) => ({ x: p.lng * mPerDegLng, y: p.lat * M_PER_DEG_LAT }))
    const inner: GeoPoint[] = []
    for (let i = 0; i < xy.length; i++) {
      const a = xy[Math.max(0, i - 1)]!
      const b = xy[Math.min(xy.length - 1, i + 1)]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy) || 1
      // Left normal of the direction of travel = inland.
      const nx = -dy / len
      const ny = dx / len
      inner.push({ lat: (xy[i]!.y + ny * widthM) / M_PER_DEG_LAT, lng: (xy[i]!.x + nx * widthM) / mPerDegLng })
    }
    out.push([...way, ...inner.reverse()])
  }
  return out
}

/** How far the BACK of the parcel stands from the OSM waterline (max over its beds), or null. */
export function parcelDepthFromWater(beds: readonly MockSunbed[], shore: GeoPoint[][]): number | null {
  let d = -Infinity
  for (const b of beds) {
    const s = signedShoreDistance(shore, b)
    if (s !== null) d = Math.max(d, s)
  }
  return Number.isFinite(d) ? d : null
}
