/**
 * `space` aspect: what spatial information exists for this site and the frame conventions every
 * spatial tool shares. Topic `sea` returns the sea bearing and shoreline availability for THIS site
 * (the same `loadSeaModel` that measure / measure_to_sea use).
 */
import { loadSeaModel, loadSiteBase } from '../tools/spatial-data'
import type { InspectProvider } from './types'

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'] as const
export const compassPoint = (deg: number): string => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]!

const FRAME = {
  x: 'metres EAST of the origin (map sites: the site location; schematic sites: the canvas top-left corner)',
  y: 'metres NORTH of the origin',
  bearings: 'compass degrees clockwise from north (0 = N, 90 = E, 180 = S, 270 = W); bearing 90 means +x',
  schematicNote: 'Schematic sites store y growing DOWN the canvas (x/y of seats and elements, top-left corners). In the shared frame y is negated (local y = -schematic y), so everything on the canvas has y <= 0. propose_* tools on schematic sites take schematic x/y; by_m { dx east, dy north } from measure tools is in the frame and is what propose_move wants.',
  mapNote: 'Map sites store lat/lng; one local frame is built around the site location (equirectangular, 111320 m per degree of latitude).',
}

export const spaceProvider: InspectProvider = {
  name: 'space',
  summary: 'Spatial information available for the open site (parcel footprints, elements, shoreline, OpenStreetMap), the shared metre frame and bearing conventions, and the sea direction (topic sea).',
  examples: ['Which way is the sea?', 'What coordinate system do the spatial tools use?', 'Is there a shoreline for this site?'],
  topics: "'sea' = sea bearing + shoreline availability for this site",
  async describe(ctx, topic) {
    if (topic === 'sea') {
      const base = await loadSiteBase(ctx.siteId)
      if (!base.ok) return { ok: true, topic: 'sea', available: false, reason: base.error }
      const sea = await loadSeaModel(ctx.siteId, base.mode, base.origin)
      if (!sea.ok) {
        return {
          ok: true, topic: 'sea', layoutMode: base.mode, available: false, reason: sea.reason,
          next: base.mode === 'schematic' ? 'Add a Water element to the schematic (propose_layout_elements) so the sea direction can be measured.' : 'No coastline was found near the site; ask the user which direction the sea is.',
        }
      }
      const bearing = sea.model.bearing({ x: 0, y: 0 })
      const distance = sea.model.distance([{ x: 0, y: 0 }])
      return {
        ok: true, topic: 'sea', layoutMode: base.mode, available: true, source: sea.source,
        seaBearingDegrees: bearing == null ? null : Math.round(bearing * 10) / 10,
        seaDirection: bearing == null ? null : compassPoint(bearing),
        distanceFromSiteCentreToWaterM: distance == null ? null : Math.round(distance * 10) / 10,
        note: 'Bearing is from the frame origin (the site centre on map sites). For a parcel, use measure_to_sea or measure({ a: { parcel }, b: { shoreline: true } }) to get exact gaps and a ready by_m.',
      }
    }
    if (topic) return { ok: false, error: 'unknown_topic', detail: "topic must be 'sea'" }

    const base = await loadSiteBase(ctx.siteId)
    const site = base.ok
      ? { layoutMode: base.mode, parcelsWithGeometry: base.parcels.length, parcelsWithoutGeometry: base.parcelsWithoutGeometry.length, hasMapOrigin: base.origin != null }
      : { error: base.error }
    return {
      ok: true,
      frame: FRAME,
      site,
      available: [
        { what: 'Parcel footprints (centre, 4 corners, row bearing, rows x seats)', via: 'describe_site_area, get_parcel, list_parcels', mode: 'both' },
        { what: 'Single sunbeds outside parcels', via: 'describe_site_area (include seats)', mode: 'both' },
        { what: 'Schematic elements: water, pool, bar, deck... with corners', via: 'describe_site_area, list_layout_elements', mode: 'schematic' },
        { what: 'Shoreline (OpenStreetMap coastline) and sea bearing', via: 'inspect({aspect:"space",topic:"sea"}), describe_site_area, measure with b = { shoreline: true }', mode: 'map (schematic: Water elements)' },
        { what: 'Roads, footpaths, promenade, buildings, amenities (lifeguard tower, toilets, bars) within a radius', via: 'describe_site_area (best effort; may say osm_unavailable)', mode: 'map' },
        { what: 'Exact distance / gap / bearing / alignment between ANY two of the above', via: 'measure({a,b,target_gap_m})', mode: 'both' },
      ],
      notRecorded: ['terrain height or slope', 'shade or sun direction', 'wind', 'water depth', 'private property boundaries'],
      pointers: 'describe_site_area first for any spatial question, then measure for exact numbers; measure_parcels / measure_to_sea are shortcuts.',
    }
  },
}
