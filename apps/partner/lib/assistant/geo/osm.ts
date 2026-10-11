/**
 * OpenStreetMap features around a site, as the assistant sees them (track 030). Pure: builds the Overpass
 * query, classifies an answer into roads / paths / promenades / buildings / amenities, converts to
 * local-frame features, and trims them to a compact, radius-limited scene. The fetch + cache is
 * `tools/osm-source.ts`.
 */
import { toLocal, type Frame, type LatLng, type Pt } from './frame'
import { lineFeature, pointFeature, polygonFeature, type ShapeFeature } from './features'
import { capPoints, hypot, shapeGap, type Shape } from './shapes'

export type OsmKind = 'road' | 'path' | 'promenade' | 'building' | 'poi'
export interface OsmFeature {
  /** Stable handle: `w123` (way) / `n456` (node). This is the `{osm: id}` the measure tool takes. */
  id: string
  kind: OsmKind
  /** The OSM value that decided the kind: `residential`, `footway`, `toilets`, `lifeguard`, `bar`, `yes` ... */
  subtype: string
  name?: string
  shape: 'point' | 'line' | 'polygon'
  pts: LatLng[]
}

const PROMENADE_NAME = /promenad|paseo|passeig|boardwalk|esplanad|seafront|rantakatu|rantapromenadi|lungomare|promenade/i
const PATH_HIGHWAYS = new Set(['footway', 'path', 'steps', 'cycleway', 'track', 'bridleway', 'corridor'])
const AMENITIES = 'toilets|bar|cafe|restaurant|fast_food|pub|ice_cream|shower|drinking_water|parking|bicycle_parking|bench|first_aid|police'
const LEISURE = 'swimming_pool|beach_resort|playground|pitch|sports_centre|marina|slipway'
const MAN_MADE = 'pier|breakwater|groyne|lighthouse|jetty'
const TOURISM = 'hotel|attraction|viewpoint|apartment|hostel|guest_house'

export function buildOverpassQuery(centre: LatLng, radiusM: number, limit = 600): string {
  const around = `(around:${Math.round(radiusM)},${centre.lat.toFixed(6)},${centre.lng.toFixed(6)})`
  return [
    '[out:json][timeout:12];',
    '(',
    `way["highway"]${around};`,
    `way["building"]${around};`,
    `nw["amenity"~"^(${AMENITIES})$"]${around};`,
    `nw["emergency"="lifeguard"]${around};`,
    `nw["leisure"~"^(${LEISURE})$"]${around};`,
    `nw["man_made"~"^(${MAN_MADE})$"]${around};`,
    `nw["tourism"~"^(${TOURISM})$"]${around};`,
    ');',
    `out geom ${limit};`,
  ].join('')
}

interface OverpassElement {
  type: string
  id: number
  lat?: number
  lon?: number
  geometry?: { lat: number; lon: number }[]
  tags?: Record<string, string>
}

function classify(tags: Record<string, string>): { kind: OsmKind; subtype: string } | null {
  if (tags.highway) {
    const h = tags.highway
    if (h === 'pedestrian' || PROMENADE_NAME.test(tags.name ?? '')) return { kind: 'promenade', subtype: h }
    return { kind: PATH_HIGHWAYS.has(h) ? 'path' : 'road', subtype: h }
  }
  if (tags.emergency === 'lifeguard') return { kind: 'poi', subtype: 'lifeguard' }
  if (tags.man_made && new RegExp(`^(${MAN_MADE})$`).test(tags.man_made)) return { kind: 'poi', subtype: tags.man_made }
  if (tags.amenity) return { kind: 'poi', subtype: tags.amenity }
  if (tags.leisure) return { kind: 'poi', subtype: tags.leisure }
  if (tags.tourism) return { kind: 'poi', subtype: tags.tourism }
  if (tags.building) return { kind: 'building', subtype: tags.building }
  return null
}

/** Parse an Overpass answer; null when it is incomplete (a `remark` about a timeout/runtime error). Pure. */
export function parseOsmAnswer(data: { remark?: string; elements?: OverpassElement[] }): OsmFeature[] | null {
  if (data.remark && /error|timed out|runtime/i.test(data.remark)) return null
  if (!Array.isArray(data.elements)) return null
  const out: OsmFeature[] = []
  for (const e of data.elements) {
    const tags = e.tags ?? {}
    const c = classify(tags)
    if (!c) continue
    const name = tags.name ?? tags['name:en']
    if (e.type === 'node' && e.lat != null && e.lon != null) {
      out.push({ id: `n${e.id}`, ...c, ...(name ? { name } : {}), shape: 'point', pts: [{ lat: e.lat, lng: e.lon }] })
    } else if (e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length >= 2) {
      const pts = e.geometry.map((g) => ({ lat: g.lat, lng: g.lon }))
      const first = pts[0]!
      const last = pts[pts.length - 1]!
      const closed = pts.length >= 4 && first.lat === last.lat && first.lng === last.lng
      const areaLike = c.kind === 'building' || (c.kind === 'poi' && closed)
      if (areaLike && !closed) continue
      out.push({
        id: `w${e.id}`, ...c, ...(name ? { name } : {}),
        shape: areaLike ? 'polygon' : 'line',
        pts: areaLike ? pts.slice(0, -1) : pts, // polygons carry no repeated closing vertex
      })
    }
  }
  return out
}

/** An OSM feature as a local-frame feature (null when the frame cannot place it). */
export function osmToFeature(f: OsmFeature, frame: Frame): ShapeFeature | null {
  const pts: Pt[] = []
  for (const p of f.pts) {
    const l = toLocal(frame, p)
    if (!l) return null
    pts.push(l)
  }
  const extra = { name: f.name ?? `${f.subtype} (${f.id})` }
  return f.shape === 'point' ? pointFeature(pts[0]!, extra) : f.shape === 'line' ? lineFeature(pts, extra) : polygonFeature(pts, extra)
}

export interface OsmSceneItem {
  id: string
  kind: OsmKind
  subtype: string
  name?: string
  /** Metres from the scene origin to the nearest part (0 = the origin is inside it). */
  distanceM: number
  shape: 'point' | 'line' | 'polygon'
  pts: Pt[]
}

/** Per-kind caps, the nearest kept first. Promenades and amenities matter most for placement, so they cap highest. */
export const OSM_CAPS: Record<OsmKind, number> = { promenade: 15, poi: 40, path: 25, road: 25, building: 30 }
const MAX_PTS: Record<'point' | 'line' | 'polygon', number> = { point: 1, line: 14, polygon: 10 }

/**
 * The OSM scene within `radiusM` of the frame origin: nearest-first per kind, capped, lines clipped to the
 * run nearest the origin and simplified. Reports what was dropped.
 */
export function trimOsmScene(features: OsmFeature[], frame: Frame, radiusM: number, caps: Record<OsmKind, number> = OSM_CAPS) {
  const origin: Shape = { kind: 'point', pts: [{ x: 0, y: 0 }] }
  const placed: OsmSceneItem[] = []
  for (const f of features) {
    const sf = osmToFeature(f, frame)
    if (!sf) continue
    const d = Math.max(0, shapeGap(origin, sf).gap)
    if (d > radiusM) continue
    let pts = sf.pts
    if (f.shape === 'line') pts = nearestRun(pts, radiusM * 1.3)
    placed.push({
      id: f.id, kind: f.kind, subtype: f.subtype, ...(f.name ? { name: f.name } : {}), distanceM: d, shape: f.shape,
      pts: f.shape === 'point' ? pts : f.shape === 'polygon' ? capPoints([...pts, pts[0]!], MAX_PTS.polygon + 1, 0.3).slice(0, -1) : capPoints(pts, MAX_PTS.line, 1),
    })
  }
  const dropped: Partial<Record<OsmKind, number>> = {}
  const kept: OsmSceneItem[] = []
  for (const kind of Object.keys(caps) as OsmKind[]) {
    const of = placed.filter((p) => p.kind === kind).sort((a, b) => a.distanceM - b.distanceM)
    kept.push(...of.slice(0, caps[kind]))
    if (of.length > caps[kind]) dropped[kind] = of.length - caps[kind]
  }
  return { items: kept, total: placed.length, dropped }
}

/** The contiguous run of a polyline that stays within `limit` metres of the origin and contains its point nearest to it. */
function nearestRun(pts: Pt[], limit: number): Pt[] {
  const near = pts.map((p) => hypot(p) <= limit)
  if (near.every(Boolean)) return pts
  let bestI = 0
  let bestD = Infinity
  pts.forEach((p, i) => { const d = hypot(p); if (d < bestD) { bestD = d; bestI = i } })
  let lo = bestI
  let hi = bestI
  while (lo > 0 && near[lo - 1]) lo--
  while (hi < pts.length - 1 && near[hi + 1]) hi++
  // keep one vertex of context each side so a segment crossing the window edge is not lost
  return pts.slice(Math.max(0, lo - 1), Math.min(pts.length, hi + 2))
}
