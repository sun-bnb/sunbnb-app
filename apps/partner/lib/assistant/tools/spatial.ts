/**
 * General-purpose spatial tools for the assistant (track 030 G2): `describe_site_area` gives the model a
 * compact scene in one local metre frame; `measure` relates ANY two features in it. Together they answer
 * spatial questions nobody wrote a tool for ("which parcel is nearest the bar", "is anything on the
 * promenade", "align parcel 9 with 8", "how far is parcel 3 from the road") without asking for coordinates.
 */
import { trimShore } from '@repo/agent/geo/coastline'
import { shoreAround } from '@repo/data/coastline-lookup'
import { formatSeatId } from '@repo/data/seat-label'
import { r1, r2, toLocal, type Frame, type Pt } from '../geo/frame'
import { alignmentFacts, elementPolygon, isShore, moveToGap, relate, type ShapeFeature } from '../geo/features'
import { formatScene, type SceneElement, type SceneInput, type SceneShore } from '../geo/describe'
import { OSM_CAPS, trimOsmScene, type OsmKind } from '../geo/osm'
import { centroid } from '../geo/shapes'
import { defineTool, elementHandle } from './helpers'
import { loadElements, loadSeaModel, loadSiteBase, loadUngroupedSeats, resolveRef } from './spatial-data'
import { loadOsm } from './osm-source'
import { geoSeaModel } from './sea-geometry'

const INCLUDE = ['parcels', 'seats', 'elements', 'shoreline', 'osm'] as const
type Include = (typeof INCLUDE)[number]
/** The scene is trimmed to fit this many characters of JSON (the model pays for every one). */
export const SCENE_BUDGET_CHARS = 16000

const refSchema = {
  type: 'object',
  description: 'ONE of: { parcel: 4 } | { seat: "1-2-3-1" } | { element: "Bar" } (schematic label, type or handle) | { shoreline: true } | { point: { lat, lng } or { x, y } } | { osm: "w123" } (id from describe_site_area)',
  properties: {
    parcel: { type: 'integer', minimum: 1, maximum: 9999 },
    seat: { type: 'string', maxLength: 30 },
    element: { type: 'string', minLength: 1, maxLength: 60 },
    shoreline: { type: 'boolean' },
    point: {
      type: 'object',
      properties: { lat: { type: 'number' }, lng: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' } },
      additionalProperties: false,
    },
    osm: { type: 'string', minLength: 2, maxLength: 24 },
  },
  additionalProperties: false,
}

export const describeSiteArea = defineTool({
  name: 'describe_site_area',
  label: 'Looking at the site',
  description:
    'A compact picture of the open site in ONE metre frame (x east, y north -- the same axes as propose_move by_m): every parcel (number, centre, 4 footprint corners, row bearing, seats), sunbeds outside parcels, schematic elements (water, bar, deck ...) with corners, the shoreline + sea bearing (map sites), and nearby OpenStreetMap features within `radius_m` (roads, footpaths, promenades, buildings, amenities such as lifeguard tower / toilets / bars, each with an id). Call it FIRST for any spatial question you have no dedicated tool for, then use `measure` for exact numbers between two things in it. Output is capped and says what it left out; OpenStreetMap is best effort and the scene still comes back (with a note) if it is unavailable. Not for changing anything.',
  properties: {
    radius_m: { type: 'number', minimum: 20, maximum: 1500, description: 'How far around the site centre to look for the shoreline and OpenStreetMap features; default 300. Parcels and elements are always all included.' },
    include: { type: 'array', items: { type: 'string', enum: [...INCLUDE] }, minItems: 1, maxItems: 5, description: 'Parts to include; default all.' },
  },
  async run(input, ctx) {
    const radius = typeof input.radius_m === 'number' ? input.radius_m : 300
    const parts = new Set<Include>(Array.isArray(input.include) && input.include.length ? (input.include as Include[]) : INCLUDE)
    const base = await loadSiteBase(ctx.siteId)
    if (!base.ok) return base
    const notes: string[] = []
    const scene: SceneInput = { frame: base.frame, radiusM: radius, notes }

    if (parts.has('parcels')) {
      scene.parcels = base.parcels.map((p) => ({
        parcel: p.summary.group,
        corners: p.poly,
        centre: centroid(p.poly),
        rowBearingDegrees: p.shape.rowBearingDegrees,
        seats: p.summary.count,
        rows: p.summary.rows,
        seatsPerRow: p.summary.seatsPerRow,
      }))
      if (base.parcelsWithoutGeometry.length) notes.push(`parcels without a position (legacy): ${base.parcelsWithoutGeometry.join(', ')}`)
    }

    if (parts.has('seats')) {
      const u = await loadUngroupedSeats(ctx.siteId, base.frame)
      scene.ungroupedSeats = { total: u.total, seats: u.seats.map((s) => ({ id: s.label ? formatSeatId({ seatLabel: s.label, number: s.number }) : `#${s.number}`, at: s.at })) }
      if (u.total > u.seats.length) notes.push(`ungrouped seats: positions summarised from the first ${u.seats.length} of ${u.total}`)
    }

    if (parts.has('elements') && base.mode === 'schematic') {
      const rows = await loadElements(ctx.siteId)
      scene.elements = rows.map<SceneElement>((e) => {
        const corners = elementPolygon(e)
        return { element: elementHandle(e.id), type: e.type, label: e.label, corners, centre: centroid(corners), width: e.width, height: e.height, rotation: e.rotation }
      })
    }

    if (base.mode === 'geo' && base.origin) {
      const origin = base.origin
      if (parts.has('shoreline')) scene.shore = await shoreScene(origin, base.frame, radius, notes)
      if (parts.has('osm')) {
        const load = await loadOsm(ctx.siteId, origin, radius)
        if (!load.ok) notes.push('osm_unavailable: OpenStreetMap did not answer in time, so roads, paths, buildings and amenities are NOT in this scene -- say so if the question depends on them.')
        else {
          // Shrink the OSM part until the whole scene fits the budget.
          for (const scale of [1, 0.5, 0.25, 0]) {
            const caps = Object.fromEntries((Object.keys(OSM_CAPS) as OsmKind[]).map((k) => [k, Math.floor(OSM_CAPS[k] * scale)])) as Record<OsmKind, number>
            scene.osm = trimOsmScene(load.features, base.frame, radius, caps)
            if (JSON.stringify(formatScene({ ...scene, notes: [] })).length <= SCENE_BUDGET_CHARS) break
          }
          if (scene.osm!.total === 0) notes.push(`osm: no mapped roads, paths, buildings or amenities within ${radius} m`)
          else if (scene.osm!.items.length < scene.osm!.total) notes.push(`osm: showing ${scene.osm!.items.length} of ${scene.osm!.total} features within ${radius} m (nearest first per kind); ask with a smaller radius_m for more detail`)
        }
      }
    } else if (base.mode === 'schematic' && (parts.has('osm') || parts.has('shoreline'))) {
      notes.push('schematic site: there is no map, so no OpenStreetMap or shoreline; water and other elements are in `elements`.')
    }

    return formatScene(scene)
  },
})

/** Shore polylines (and the sea bearing from the site centre) in the local frame; null with a note when unavailable. */
export async function shoreScene(origin: { lat: number; lng: number }, frame: Frame, radius: number, notes: string[]): Promise<SceneShore | null> {
  let shore
  try {
    shore = await shoreAround(origin.lat, origin.lng, Math.max(radius, 300))
  } catch (err) {
    console.error('[assistant] describe_site_area: coastline lookup failed', err)
    notes.push('shoreline_unavailable: the coastline lookup failed')
    return null
  }
  if (!shore.ways.length) {
    notes.push(`no shoreline within ${Math.max(radius, 300)} m of the site`)
    return null
  }
  const toL = (ll: { lat: number; lng: number }) => toLocal(frame, ll) as Pt
  const model = geoSeaModel(shore.ways, shore.water, origin)
  return {
    lines: trimShore(shore.ways, origin, radius * 1.3).map((w) => w.map(toL)),
    water: shore.water.map((ring) => ring.map(toL)),
    seaBearingDegrees: model.bearing({ x: 0, y: 0 }),
    distanceFromOriginM: model.distance([{ x: 0, y: 0 }]),
  }
}

export const measureTool = defineTool({
  name: 'measure',
  label: 'Measuring',
  description:
    'Relate ANY two things on the open site: a parcel, one sunbed, a schematic element, the shoreline, a point, or an OpenStreetMap feature (id from describe_site_area). Returns the centre/nearest distance and compass bearing from a to b, the edge-to-edge gap in metres (negative = overlapping), an overlap flag, whether one contains the other, the unit direction a->b ({ dx east, dy north }), and -- when `target_gap_m` is given -- `by_m` { dx, dy }: the exact move for `a` (pass it to propose_move) that makes the gap that size, plus the gap you will get. When b is a parcel it also gives a\'s offset along/across b\'s rows and the moves that line a up with b (by_m_to_share_rows / by_m_to_share_columns) -- use for "align parcel 9 with parcel 8". `a` is the thing that moves; the shoreline can only be b. With b = the shoreline the gap is the distance from a\'s nearest edge to the waterline (negative = in the water) and the direction points to the sea. Never ask the user for coordinates when this works; if it returns ok:false say why and only then ask.',
  properties: {
    a: refSchema,
    b: refSchema,
    target_gap_m: { type: 'number', minimum: -50, maximum: 1000, description: 'Wanted gap between a and b in metres (0 = touching). Omit to only measure.' },
  },
  required: ['a', 'b'],
  async run(input, ctx) {
    const base = await loadSiteBase(ctx.siteId)
    if (!base.ok) return base
    let seaLoad: ReturnType<typeof loadSeaModel> | null = null
    const rc = { siteId: ctx.siteId, base, sea: () => (seaLoad ??= loadSeaModel(ctx.siteId, base.mode, base.origin)) }
    if (JSON.stringify(input.a) === JSON.stringify(input.b)) return { ok: false, error: 'a and b are the same thing; give two different features' }
    const ra = await resolveRef(input.a, rc)
    if (!ra.ok) return { ok: false, error: `a: ${ra.error}` }
    const rb = await resolveRef(input.b, rc)
    if (!rb.ok) return { ok: false, error: `b: ${rb.error}` }
    if (isShore(ra.feature)) return { ok: false, error: 'the shoreline cannot move: put it in b and the thing that moves in a' }
    const a = ra.feature as ShapeFeature
    const b = rb.feature

    const rel = relate(a, b)
    if (!rel.ok) return { ok: false, error: rel.error }
    const r = rel.relation
    const out: Record<string, unknown> = {
      ok: true,
      a: ra.label,
      b: rb.label,
      centreDistanceM: r1(r.centreDistanceM),
      centreBearingDegrees: r1(r.centreBearingDegrees),
      edgeGapM: r1(r.edgeGapM),
      overlapping: r.overlapping,
      containment: r.containment === 'a_in_b' ? `${ra.label} is inside ${rb.label}` : r.containment === 'b_in_a' ? `${rb.label} is inside ${ra.label}` : null,
      direction: { dx: r2(r.direction.x), dy: r2(r.direction.y) },
      ...(r.nearest ? { nearestPoints: { a: [r1(r.nearest.a.x), r1(r.nearest.a.y)], b: [r1(r.nearest.b.x), r1(r.nearest.b.y)] } } : {}),
      ...(isShore(b) ? { meaning: 'edgeGapM = metres from a\'s nearest edge to the waterline; direction/bearing point toward the sea' } : {}),
    }
    if (typeof input.target_gap_m === 'number') {
      if (r.degenerate) return { ok: false, error: 'a and b are centred on the same point, so there is no direction to move in; measure against something else or give a point' }
      const move = moveToGap(a, b, r.direction, input.target_gap_m)
      if (!move) return { ok: false, error: 'could_not_solve_the_move' }
      out.targetGapM = input.target_gap_m
      out.by_m = { dx: r2(move.by.x), dy: r2(move.by.y) }
      out.resultingGapM = r1(move.resultingGapM)
    }
    if (!isShore(b)) {
      const al = alignmentFacts(a, b)
      if (al) out.alignment = al
    }
    return out
  },
})
