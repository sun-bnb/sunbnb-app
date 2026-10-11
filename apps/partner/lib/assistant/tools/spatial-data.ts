/**
 * IO side of the assistant's spatial tools (track 030): load the site into the shared local frame and
 * resolve model-supplied feature refs. EVERY lookup is scoped to `siteId` (bound by the route) -- a parcel
 * number, seat id, element handle or OSM id can only resolve to something on this site.
 */
import prisma from '@repo/data/PrismaCient'
import { shoreAround } from '@repo/data/coastline-lookup'
import { getParcelSummaries, type ParcelSummary } from '@/app/sites/[id]/parcels'
import { siteLayoutMode } from '../proposals/inventory-sim'
import { geoFrame, schematicFrame, toLocal, type Frame, type LatLng, type Pt } from '../geo/frame'
import { elementPolygon, pointFeature, polygonFeature, type Feature, type SeaModel, type ShapeFeature } from '../geo/features'
import { osmToFeature } from '../geo/osm'
import { geoSeaModel, waterSeaModel } from './sea-geometry'
import { parcelPolygon, parcelShape, type LayoutMode, type ParcelShape } from './parcel-geometry'
import { elementHandle, storedSeatLabel } from './helpers'
import { cachedOsm, loadOsm } from './osm-source'

/** How much coastline to read around the site for a distance-to-sea question; a shore further than this is "no shore found". */
export const SHORE_RADIUS_M = 1500

export interface SceneParcel { summary: ParcelSummary; shape: ParcelShape; poly: Pt[] }
export interface SiteBase {
  mode: LayoutMode
  frame: Frame
  /** Geo sites: the lat/lng of local (0,0). */
  origin: LatLng | null
  parcels: SceneParcel[]
  /** Parcels the site has but that carry no geometry (legacy). */
  parcelsWithoutGeometry: number[]
}
export type BaseResult = ({ ok: true } & SiteBase) | { ok: false; error: string }

const finite = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

/** The site in its local frame. Geo origin = the site's own location (stable across calls), else the first parcel's anchor. */
export async function loadSiteBase(siteId: string): Promise<BaseResult> {
  const [{ parcels }, mode, site] = await Promise.all([
    getParcelSummaries(siteId),
    siteLayoutMode(siteId),
    prisma.site.findUnique({ where: { id: siteId }, select: { locationLat: true, locationLng: true } }),
  ])
  const shapes = parcels.map((summary) => ({ summary, shape: parcelShape(summary, mode) }))
  let frame: Frame
  let origin: LatLng | null = null
  if (mode === 'schematic') frame = schematicFrame()
  else {
    const lat = finite(site?.locationLat)
    const lng = finite(site?.locationLng)
    const anchor = shapes.find((s) => s.shape && 'lat' in s.shape.anchor)?.shape?.anchor as LatLng | undefined
    if (lat != null && lng != null && !(lat === 0 && lng === 0)) origin = { lat, lng }
    else if (anchor) origin = { lat: anchor.lat, lng: anchor.lng }
    else return { ok: false, error: 'site_has_no_location' }
    frame = geoFrame(origin)
  }
  const placed: SceneParcel[] = []
  const missing: number[] = []
  for (const { summary, shape } of shapes) {
    const poly = shape ? parcelPolygon(shape, frame) : null
    if (shape && poly) placed.push({ summary, shape, poly })
    else missing.push(summary.group)
  }
  return { ok: true, mode, frame, origin, parcels: placed, parcelsWithoutGeometry: missing }
}

export async function loadElements(siteId: string, types?: string) {
  return prisma.layoutElement.findMany({
    where: types ? { siteId, type: types } : { siteId },
    orderBy: [{ z: 'asc' }, { createdAt: 'asc' }],
    take: 500,
  })
}

type SeatRow = { number: number; seatLabel: string | null; locationLat: string | null; locationLng: string | null; schematicX: number | null; schematicY: number | null }
const SEAT_SELECT = { number: true, seatLabel: true, locationLat: true, locationLng: true, schematicX: true, schematicY: true } as const

export function seatLocal(frame: Frame, s: SeatRow): Pt | null {
  if (frame.mode === 'schematic') return s.schematicX == null || s.schematicY == null ? null : toLocal(frame, { x: s.schematicX, y: s.schematicY })
  const lat = finite(s.locationLat)
  const lng = finite(s.locationLng)
  return lat == null || lng == null ? null : toLocal(frame, { lat, lng })
}

/** Seats that belong to no parcel (group 0), with their local positions. `total` may exceed what is returned. */
export async function loadUngroupedSeats(siteId: string, frame: Frame, take = 600) {
  const where = { siteId, group: 0, status: { not: 'pool' } }
  const [total, rows] = await Promise.all([
    prisma.inventoryItem.count({ where }),
    prisma.inventoryItem.findMany({ where, select: SEAT_SELECT, orderBy: { number: 'asc' }, take }),
  ])
  const seats = rows.flatMap((r: SeatRow) => {
    const at = seatLocal(frame, r)
    return at ? [{ number: r.number, label: r.seatLabel, at }] : []
  })
  return { total, seats }
}

// ─── sea model ──────────────────────────────────────────────────────────────

export type SeaLoad = { ok: true; model: SeaModel; source: string } | { ok: false; reason: string }

/** The shoreline (map: OSM coastline around `origin`; schematic: the water elements) as a SeaModel in the local frame. */
export async function loadSeaModel(siteId: string, mode: LayoutMode, origin: LatLng | null): Promise<SeaLoad> {
  if (mode === 'schematic') {
    const water = await loadElements(siteId, 'water')
    if (!water.length) return { ok: false, reason: 'no_water_in_the_schematic' }
    return { ok: true, model: waterSeaModel(water.map(elementPolygon)), source: 'schematic water elements' }
  }
  if (!origin) return { ok: false, reason: 'site_has_no_location' }
  let shore
  try {
    shore = await shoreAround(origin.lat, origin.lng, SHORE_RADIUS_M)
  } catch (err) {
    console.error('[assistant] coastline lookup failed', err)
    return { ok: false, reason: 'coastline_unavailable' }
  }
  if (!shore.ways.length) return { ok: false, reason: 'no_shore_within_1500m' }
  return { ok: true, model: geoSeaModel(shore.ways, shore.water, origin), source: 'OpenStreetMap coastline' }
}

// ─── feature refs ───────────────────────────────────────────────────────────

export interface FeatureRef {
  parcel?: number
  seat?: string
  element?: string
  shoreline?: boolean
  point?: { lat?: number; lng?: number; x?: number; y?: number }
  osm?: string
}

export type Resolved = { ok: true; feature: Feature; label: string; kind: string } | { ok: false; error: string }
const fail = (error: string): Resolved => ({ ok: false, error })

export interface RefContext {
  siteId: string
  base: SiteBase
  /** Loaded lazily, once per call. */
  sea: () => Promise<SeaLoad>
}

export async function resolveRef(ref: unknown, ctx: RefContext): Promise<Resolved> {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return fail('a feature ref is an object like { parcel: 4 }')
  const r = ref as FeatureRef
  const keys = (['parcel', 'seat', 'element', 'shoreline', 'point', 'osm'] as const).filter((k) => r[k] !== undefined)
  if (keys.length !== 1) return fail('give exactly one of parcel, seat, element, shoreline, point, osm')
  const { base, siteId } = ctx

  switch (keys[0]) {
    case 'parcel': {
      const p = base.parcels.find((x) => x.summary.group === r.parcel)
      if (!p) return fail(base.parcelsWithoutGeometry.includes(r.parcel as number) ? 'parcel_has_no_geometry' : 'parcel_not_found')
      return { ok: true, kind: 'parcel', label: `parcel ${p.summary.group}`, feature: polygonFeature(p.poly, { name: `parcel ${p.summary.group}`, rowBearingDegrees: p.shape.rowBearingDegrees }) }
    }
    case 'seat': {
      const id = String(r.seat).trim()
      let row: SeatRow | null
      if (/^#\d+$/.test(id)) {
        row = await prisma.inventoryItem.findFirst({ where: { siteId, number: Number(id.slice(1)), status: { not: 'pool' } }, select: SEAT_SELECT })
      } else {
        const stored = storedSeatLabel(id)
        if (!stored) return fail('seat must look like "1-2-3-1" (parcel-row-unit-member), or "#<number>" for a sunbed outside any parcel')
        if (stored.label.endsWith('-')) return fail('give the sunbed with its member number, e.g. "1-2-3-1"')
        row = await prisma.inventoryItem.findFirst({ where: { siteId, seatLabel: stored.label, status: { not: 'pool' } }, select: SEAT_SELECT })
      }
      if (!row) return fail('seat_not_found')
      const at = seatLocal(base.frame, row)
      if (!at) return fail('seat_has_no_position')
      return { ok: true, kind: 'seat', label: `seat ${id}`, feature: pointFeature(at, { name: `seat ${id}` }) }
    }
    case 'element': {
      if (base.mode !== 'schematic') return fail('layout elements exist on schematic sites only')
      const wanted = String(r.element).trim()
      const rows = await loadElements(siteId)
      const lc = wanted.toLowerCase()
      let hits = rows.filter((e) => e.id === wanted || elementHandle(e.id) === wanted)
      if (!hits.length) hits = rows.filter((e) => e.label?.toLowerCase() === lc)
      if (!hits.length) hits = rows.filter((e) => e.label?.toLowerCase().includes(lc) || e.type.toLowerCase() === lc)
      if (!hits.length) return fail('element_not_found')
      if (hits.length > 1) return fail(`"${wanted}" matches ${hits.length} elements; use one of these handles: ${hits.slice(0, 8).map((e) => `${elementHandle(e.id)} (${e.label ?? e.type})`).join(', ')}`)
      const e = hits[0]!
      const name = e.label ?? e.type
      return { ok: true, kind: 'element', label: `${name} (${elementHandle(e.id)})`, feature: polygonFeature(elementPolygon(e), { name }) }
    }
    case 'shoreline': {
      if (r.shoreline !== true) return fail('shoreline must be true')
      const sea = await ctx.sea()
      if (!sea.ok) return fail(sea.reason)
      return { ok: true, kind: 'shoreline', label: 'the waterline', feature: { kind: 'shore', model: sea.model, name: 'the waterline' } }
    }
    case 'point': {
      const p = r.point ?? {}
      const hasLL = p.lat !== undefined || p.lng !== undefined
      const hasXY = p.x !== undefined || p.y !== undefined
      if (hasLL === hasXY) return fail('point is { lat, lng } or { x, y } (local metres from describe_site_area)')
      let local: Pt | null
      if (hasLL) {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return fail('point needs both lat and lng')
        if (base.frame.mode !== 'geo') return fail('lat/lng points exist on map sites only; use { x, y }')
        local = toLocal(base.frame, { lat: p.lat!, lng: p.lng! })
      } else {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return fail('point needs both x and y')
        local = { x: p.x!, y: p.y! }
      }
      return { ok: true, kind: 'point', label: 'the point', feature: pointFeature(local!, { name: 'the point' }) }
    }
    case 'osm': {
      const id = String(r.osm).trim()
      let features = cachedOsm(siteId)
      if (!features && base.origin) {
        const load = await loadOsm(siteId, base.origin, 300)
        features = load.ok ? load.features : null
        if (!load.ok) return fail('osm_unavailable')
      }
      const f = features?.find((x) => x.id === id)
      const sf = f ? osmToFeature(f, base.frame) : null
      if (!f || !sf) return fail('osm_feature_not_found (ids come from describe_site_area)')
      return { ok: true, kind: `osm ${f.kind}`, label: f.name ?? `${f.subtype} ${f.id}`, feature: sf as ShapeFeature }
    }
  }
  return fail('unknown ref')
}
