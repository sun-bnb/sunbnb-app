/**
 * Pure parcel geometry for the assistant's read tools (track 030): where a parcel sits, how big it is,
 * and how two parcels relate. NOT a tool and no IO, so the model can be handed facts it can reason with
 * ("move parcel 5 closer to parcel 4") instead of having to ask the user for coordinates.
 *
 * Conventions (shared with the editor via `parcelFootprint` / `generateChairGrid`): a parcel is a rectangle
 * around its ANCHOR (the first sunbed); `rotation` turns it clockwise on screen. Internally everything is
 * metres, east (x) / north (y, UP). Map sites project lat/lng with 111320 m/deg (cos(lat) for lng), the
 * same equirectangular rule as chair-util; schematic y grows DOWN so it is flipped at the edges.
 */
import { parcelFootprint } from '@repo/schematic'
import type { ParcelSummary } from '@/app/sites/[id]/parcels'

import { geoFrame, M_PER_DEG, norm360, r1, r2, r6, schematicFrame, toLocal, type Frame, type LayoutMode, type Pt } from '../geo/frame'
import { moveToGap, polygonFeature, relate } from '../geo/features'

export type { LayoutMode, Pt }
export { polygonGap } from '../geo/shapes'

/** A parcel in local metres (east/north-up), plus the facts the model is shown. */
export interface ParcelShape {
  /** Corners and centre in metres, relative to the shape's own anchor. */
  localCorners: Pt[]
  localCentre: Pt
  /** Anchor in the site's own coordinates. */
  anchor: { lat: number; lng: number } | { x: number; y: number }
  /** Size in metres: along the rows (the seat axis) x across rows. */
  sizeM: { alongRows: number; acrossRows: number }
  /** Compass bearing (degrees clockwise from north) of the direction the seats of a row run in. */
  rowBearingDegrees: number
}

type GeoSource = Pick<
  ParcelSummary,
  'rows' | 'seatsPerRow' | 'horizontalGap' | 'verticalGap' | 'pairGap' | 'rotation' | 'locationLat' | 'locationLng' | 'schematicX' | 'schematicY'
>

/** Parcel shape, or null when the parcel has no ItemGroup geometry / anchor (legacy parcels). */
export function parcelShape(p: GeoSource, mode: LayoutMode): ParcelShape | null {
  if (p.rows == null || p.seatsPerRow == null) return null
  let anchor: ParcelShape['anchor']
  if (mode === 'schematic') {
    if (p.schematicX == null || p.schematicY == null) return null
    anchor = { x: p.schematicX, y: p.schematicY }
  } else {
    const lat = Number(p.locationLat)
    const lng = Number(p.locationLng)
    if (p.locationLat == null || p.locationLng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
    anchor = { lat, lng }
  }
  const rot = p.rotation ?? 0
  const cfg = {
    rows: p.rows, seatsPerRow: p.seatsPerRow, horizontalGap: p.horizontalGap ?? 0, verticalGap: p.verticalGap ?? 0,
    intraPairGap: p.pairGap ?? 0, pairSeats: (p.pairGap ?? 0) > 0,
  }
  // The footprint at the equator is metres/111320 in both axes. The schematic grid is generated with the
  // inverse angle and its dy is SCREEN-down, so after the same call the north component is negated.
  const raw = parcelFootprint({ lat: 0, lng: 0 }, { ...cfg, rotation: mode === 'schematic' ? -rot : rot })
  const localCorners = raw.map((c) => ({ x: c.lng * M_PER_DEG, y: (mode === 'schematic' ? -c.lat : c.lat) * M_PER_DEG }))
  const unflat = parcelFootprint({ lat: 0, lng: 0 }, { ...cfg, rotation: 0 })
  const alongRows = Math.abs(unflat[1]!.lng - unflat[0]!.lng) * M_PER_DEG
  const acrossRows = Math.abs(unflat[2]!.lat - unflat[1]!.lat) * M_PER_DEG
  const rad = (rot * Math.PI) / 180
  const rowBearingDegrees = norm360((Math.atan2(Math.cos(rad), -Math.sin(rad)) * 180) / Math.PI)
  const localCentre = {
    x: localCorners.reduce((s, c) => s + c.x, 0) / 4,
    y: localCorners.reduce((s, c) => s + c.y, 0) / 4,
  }
  return { localCorners, localCentre, anchor, sizeM: { alongRows, acrossRows }, rowBearingDegrees }
}

/** Metres (east, north-up) to a point in the site's coordinates, relative to `anchor`. */
function toSite(anchor: ParcelShape['anchor'], m: Pt): { lat: number; lng: number } | { x: number; y: number } {
  if ('lat' in anchor) {
    const perLng = M_PER_DEG * Math.cos((anchor.lat * Math.PI) / 180)
    return { lat: anchor.lat + m.y / M_PER_DEG, lng: anchor.lng + m.x / perLng }
  }
  return { x: anchor.x + m.x, y: anchor.y - m.y }
}

const roundSite = (pt: { lat: number; lng: number } | { x: number; y: number }) =>
  'lat' in pt ? { lat: r6(pt.lat), lng: r6(pt.lng) } : { x: r1(pt.x), y: r1(pt.y) }

/** The model-facing position facts. `compact` keeps only centre, size and bearing (for list_parcels). */
export function positionFacts(p: GeoSource, mode: LayoutMode, compact = false) {
  const s = parcelShape(p, mode)
  if (!s) return null
  const base = {
    centre: roundSite(toSite(s.anchor, s.localCentre)),
    sizeM: { alongRows: r1(s.sizeM.alongRows), acrossRows: r1(s.sizeM.acrossRows) },
    rowBearingDegrees: Math.round(s.rowBearingDegrees * 10) / 10,
  }
  if (compact) return base
  return { anchor: roundSite(s.anchor), ...base, corners: s.localCorners.map((c) => roundSite(toSite(s.anchor, c))) }
}

/** The parcel's footprint corners in a shared local frame (x east, y north), `parcelShape` order (0-1 = first row, 2-3 = last row). */
export function parcelPolygon(s: ParcelShape, frame: Frame): Pt[] | null {
  const a = toLocal(frame, s.anchor)
  return a ? s.localCorners.map((c) => ({ x: a.x + c.x, y: a.y + c.y })) : null
}

// ─── two-parcel measurement ─────────────────────────────────────────────────

export type Measurement =
  | { ok: false; error: string }
  | {
      ok: true
      centreDistanceM: number
      /** Compass bearing (degrees clockwise from north) from `from`'s centre to `to`'s centre. */
      centreBearingDegrees: number
      edgeGapM: number
      overlapping: boolean
      /** Unit vector from `from` to `to`: dx east, dy north. */
      direction: { dx: number; dy: number }
      targetGapM: number
      /** Move for `from` (propose_move by_m) that makes the edge gap `targetGapM`, along the centre line. */
      by_m: { dx: number; dy: number }
      /** Edge gap after applying by_m (equals the target unless the geometry cannot reach it). */
      resultingGapM: number
    }

/** Thin wrapper over the generic `relate` / `moveToGap` for two parcels (the `measure_parcels` tool). */
export function measureParcels(from: GeoSource, to: GeoSource, mode: LayoutMode, targetGapM = 2): Measurement {
  const a = parcelShape(from, mode)
  const b = parcelShape(to, mode)
  if (!a || !b) return { ok: false, error: 'parcel_has_no_geometry' }

  // One metric frame, origin = a's anchor.
  let frame: Frame
  if (mode === 'geo' && 'lat' in a.anchor) frame = geoFrame(a.anchor)
  else if (mode === 'schematic' && 'x' in a.anchor) frame = schematicFrame()
  else return { ok: false, error: 'mixed_layout_modes' }
  const polyA = parcelPolygon(a, frame)
  const polyB = parcelPolygon(b, frame)
  if (!polyA || !polyB) return { ok: false, error: 'mixed_layout_modes' }

  const fa = polygonFeature(polyA)
  const fb = polygonFeature(polyB)
  const rel = relate(fa, fb)
  if (!rel.ok || rel.relation.degenerate) return { ok: false, error: 'parcels_share_the_same_centre' }
  const r = rel.relation
  const move = moveToGap(fa, fb, r.direction, targetGapM)
  if (!move) return { ok: false, error: 'parcel_has_no_geometry' }
  return {
    ok: true,
    centreDistanceM: r1(r.centreDistanceM),
    centreBearingDegrees: r1(r.centreBearingDegrees),
    edgeGapM: r1(r.edgeGapM),
    overlapping: r.overlapping,
    direction: { dx: r2(r.direction.x), dy: r2(r.direction.y) },
    targetGapM,
    by_m: { dx: r2(move.by.x), dy: r2(move.by.y) },
    resultingGapM: r1(move.resultingGapM),
  }
}
