import { getParcelSummaries } from '@/app/sites/[id]/parcels'
import { siteLayoutMode } from '../proposals/inventory-sim'
import { geoFrame, schematicFrame, type LatLng } from '../geo/frame'
import { parcelPolygon, parcelShape } from './parcel-geometry'
import { measureToSea, type SeaParcel } from './sea-geometry'
import { loadSeaModel } from './spatial-data'
import { defineTool } from './helpers'

export const measureToSeaTool = defineTool({
  name: 'measure_to_sea',
  label: 'Measuring to the sea',
  description:
    'Where the sea is relative to one or more parcels: compass bearing toward the water, the distance in metres from the parcel\'s NEAREST edge to the waterline (negative = partly in the water), which edge faces the sea, and -- when `target_distance_m` is given -- a ready `by_m` { dx east, dy north } for propose_move that moves the parcel straight toward the sea so its nearest edge ends that far from the waterline. With several parcels it also returns `shared.by_m`: ONE vector for the whole group (set by the parcel closest to the water) that keeps their gaps -- use it when the user wants them moved together. Map sites use the real OpenStreetMap shoreline; schematic sites use the water elements. Use for "closer to / further from the sea / the water / the waterline". If it returns ok:false, only then ask the user. Never ask which way the sea is when this works.',
  properties: {
    parcels: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 9999 }, minItems: 1, maxItems: 200, description: 'Parcel numbers (all parcels of the site fit in one call)' },
    target_distance_m: { type: 'number', minimum: 0, maximum: 500, description: 'Wanted distance from the nearest edge to the waterline, metres. Omit to only measure.' },
  },
  required: ['parcels'],
  async run(input, ctx) {
    const wanted = [...new Set(input.parcels as number[])]
    const target = typeof input.target_distance_m === 'number' ? input.target_distance_m : undefined
    const [{ parcels }, mode] = await Promise.all([getParcelSummaries(ctx.siteId), siteLayoutMode(ctx.siteId)])
    const picked = wanted.map((n) => parcels.find((p) => p.group === n))
    if (picked.some((p) => !p)) return { ok: false, error: 'parcel_not_found' }

    const shapes = picked.map((p) => ({ p: p!, s: parcelShape(p!, mode) }))
    if (shapes.some((x) => !x.s)) return { ok: false, error: 'parcel_has_no_geometry' }

    // Shared local frame: the first parcel's anchor on a map (so the shore is read around the parcels), the canvas on a schematic.
    const origin = mode === 'geo' ? (shapes[0]!.s!.anchor as LatLng) : null
    const frame = origin ? geoFrame(origin) : schematicFrame()
    const sea: SeaParcel[] = shapes.map(({ p, s }) => ({ group: p.group, rowBearingDegrees: s!.rowBearingDegrees, corners: parcelPolygon(s!, frame)! }))
    const loaded = await loadSeaModel(ctx.siteId, mode, origin)
    if (!loaded.ok) return loaded

    const m = measureToSea(sea, loaded.model, target)
    if (!m.ok) return m
    return { ...m, source: loaded.source }
  },
})
