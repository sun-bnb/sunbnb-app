/**
 * Inland water for the shore lookup (track 027 P15) — pure, used by the region import.
 *
 * Geofabrik's `gis_osm_water_a_free_1` layer carries lakes, reservoirs and river areas as polygons
 * with an `fclass`. The sea import gets the shore direction from OSM coastline LINES; inland water
 * has none, so the shore is derived from the polygon edges. A shapefile ring is wound with the
 * polygon's inside on the right — outer rings clockwise, holes (islands) counter-clockwise — and the
 * inside IS the water, so each ring, walked as stored, has the water on the right: exactly the
 * coastline convention the rest of the pipeline (`lib/coastline.ts`, `lib/land-fit.ts`) assumes.
 */
import { isClockwise } from './shapefile.ts'

/**
 * Water a beach can sit on. Geofabrik files river AREAS (the Danube, the Inn) as `riverbank`;
 * `river` is kept in case an extract uses it. Wetland (all `wetland_*`), glacier and dock areas are
 * not bathing shores. Measured on Austria 2026-10-06: water 59 533, riverbank 2 396, reservoir 2 198,
 * then wetlands, glaciers and 4 docks.
 */
export const BATHING_FCLASSES: ReadonlySet<string> = new Set(['water', 'reservoir', 'riverbank', 'river'])

/** Ponds, pools and fountains: below this a "lake" cannot have a sunbed concession. */
export const MIN_INLAND_AREA_M2 = 5_000

/**
 * Canals and streams are big enough by area but only metres wide — the Lendkanal into Klagenfurt
 * (35 000 m², ~12 m wide) out-snapped the Wörthersee 630 m away. Mean width = 2 × area ÷ perimeter;
 * the Danube's river areas are ~300 m, a bathable river comfortably over this.
 */
export const MIN_INLAND_MEAN_WIDTH_M = 20

/** Shore pieces stay short, so a lookup near a beach reads a few hundred points, not a whole lake. */
export const SHORE_PIECE_POINTS = 200

const M_PER_DEG_LAT = 111_320

/** Water area in m² of a shapefile polygon's rings (outer rings count, holes subtract). */
export function polygonAreaM2(rings: [number, number][][]): number {
  let total = 0
  for (const ring of rings) {
    if (ring.length < 4) continue
    const lat0 = ring[0]![1]
    const mPerDegLng = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180)
    let s = 0
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i]!
      const [x2, y2] = ring[i + 1]!
      s += x1 * mPerDegLng * (y2 * M_PER_DEG_LAT) - x2 * mPerDegLng * (y1 * M_PER_DEG_LAT)
    }
    const a = Math.abs(s) / 2
    total += isClockwise(ring) ? a : -a
  }
  return Math.max(0, total)
}

/** Total length in metres of a polygon's rings (outer and holes). */
export function perimeterM(rings: [number, number][][]): number {
  let total = 0
  for (const ring of rings) {
    const mPerDegLng = M_PER_DEG_LAT * Math.cos(((ring[0]?.[1] ?? 0) * Math.PI) / 180)
    for (let i = 0; i < ring.length - 1; i++) {
      total += Math.hypot((ring[i + 1]![0] - ring[i]![0]) * mPerDegLng, (ring[i + 1]![1] - ring[i]![1]) * M_PER_DEG_LAT)
    }
  }
  return total
}

/** Keep this polygon? A bathing kind of water, big and wide enough to have a beach. */
export function isBathingWater(fclass: string, rings: [number, number][][]): boolean {
  if (!BATHING_FCLASSES.has(fclass)) return false
  const area = polygonAreaM2(rings)
  return area >= MIN_INLAND_AREA_M2 && (2 * area) / perimeterM(rings) >= MIN_INLAND_MEAN_WIDTH_M
}

/**
 * The polygon's shore as WKT LINESTRINGs, water on the right, in pieces of at most `maxPoints`
 * points (consecutive pieces share their joining point, so no gap opens in the shore).
 */
export function shoreLines(rings: [number, number][][], maxPoints = SHORE_PIECE_POINTS): string[] {
  const out: string[] = []
  for (const ring of rings) {
    if (ring.length < 4) continue
    for (let start = 0; start < ring.length - 1; start += maxPoints - 1) {
      const piece = ring.slice(start, start + maxPoints)
      if (piece.length >= 2) out.push(`LINESTRING(${piece.map(([x, y]) => `${x} ${y}`).join(',')})`)
    }
  }
  return out
}
