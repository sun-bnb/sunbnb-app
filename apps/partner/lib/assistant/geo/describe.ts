/**
 * The compact scene `describe_site_area` returns (track 030). Pure: takes features already in the local
 * metre frame and shapes them into a small, rounded, capped JSON object, saying what it cut.
 */
import { describeFrame, r1, type Frame, type Pt } from './frame'
import { capPoints, hypot } from './shapes'
import type { OsmSceneItem } from './osm'

export const SHORE_POINT_BUDGET = 200
const pt = (p: Pt): [number, number] => [r1(p.x), r1(p.y)]
const pts = (ps: Pt[]) => ps.map(pt)

export interface SceneParcel { parcel: number; corners: Pt[]; centre: Pt; rowBearingDegrees: number; seats: number; rows: number | null; seatsPerRow: number | null }
export interface SceneSeat { id: string; at: Pt }
export interface SceneElement { element: string; type: string; label: string | null; corners: Pt[]; centre: Pt; width: number; height: number; rotation: number }
export interface SceneShore { lines: Pt[][]; water: Pt[][]; seaBearingDegrees: number | null; distanceFromOriginM: number | null }

export interface SceneInput {
  frame: Frame
  radiusM: number
  parcels?: SceneParcel[]
  ungroupedSeats?: { total: number; seats: SceneSeat[] }
  elements?: SceneElement[]
  shore?: SceneShore | null
  osm?: { items: OsmSceneItem[]; total: number; dropped: Partial<Record<string, number>> } | null
  notes?: string[]
}

export const MAX_PARCELS = 60
export const MAX_ELEMENTS = 60
/** Ungrouped seats listed one by one up to this many; beyond it they are summarised. */
export const MAX_LISTED_SEATS = 15

export function simplifyShore(shore: SceneShore, radiusM: number) {
  // Longest (most points) lines first; the point budget is split across what is kept.
  const lines = [...shore.lines].sort((a, b) => b.length - a.length).slice(0, 6)
  const per = Math.max(2, Math.floor(SHORE_POINT_BUDGET / Math.max(1, lines.length + Math.min(2, shore.water.length))))
  const window = radiusM * 1.5
  const rings = shore.water
    .map((r) => r.filter((p) => Math.abs(p.x) <= window && Math.abs(p.y) <= window))
    .filter((r) => r.length >= 2)
    .slice(0, 2)
  return {
    lines: lines.map((l) => pts(capPoints(l, per, 0.5))),
    waterEdge: rings.map((r) => pts(capPoints(r, per, 1))),
  }
}

export function formatScene(input: SceneInput) {
  const notes = [...(input.notes ?? [])]
  const out: Record<string, unknown> = { frame: describeFrame(input.frame), radius_m: input.radiusM }

  if (input.parcels) {
    const shown = [...input.parcels].sort((a, b) => a.parcel - b.parcel).slice(0, MAX_PARCELS)
    if (input.parcels.length > shown.length) notes.push(`parcels: showing ${shown.length} of ${input.parcels.length} (lowest numbers)`)
    out.parcels = shown.map((p) => ({
      parcel: p.parcel, centre: pt(p.centre), corners: pts(p.corners), row_bearing_deg: Math.round(p.rowBearingDegrees),
      seats: p.seats, rows: p.rows, seats_per_row: p.seatsPerRow,
    }))
    out.parcel_corners_order = 'first row (2 corners), then last row (2 corners)'
  }

  if (input.ungroupedSeats && input.ungroupedSeats.total > 0) {
    const { total, seats } = input.ungroupedSeats
    if (total <= MAX_LISTED_SEATS) out.ungrouped_seats = { count: total, seats: seats.map((s) => ({ seat: s.id, at: pt(s.at) })) }
    else {
      const xs = seats.map((s) => s.at.x)
      const ys = seats.map((s) => s.at.y)
      out.ungrouped_seats = {
        count: total,
        aggregated: true,
        centroid: pt({ x: xs.reduce((a, b) => a + b, 0) / seats.length, y: ys.reduce((a, b) => a + b, 0) / seats.length }),
        bbox: [r1(Math.min(...xs)), r1(Math.min(...ys)), r1(Math.max(...xs)), r1(Math.max(...ys))],
        nearest_to_origin: seats.map((s) => ({ s, d: hypot(s.at) })).sort((a, b) => a.d - b.d).slice(0, 5).map(({ s }) => ({ seat: s.id, at: pt(s.at) })),
      }
    }
  }

  if (input.elements) {
    const shown = input.elements.slice(0, MAX_ELEMENTS)
    if (input.elements.length > shown.length) notes.push(`layout elements: showing ${shown.length} of ${input.elements.length}`)
    out.elements = shown.map((e) => ({
      element: e.element, type: e.type, ...(e.label ? { label: e.label } : {}), centre: pt(e.centre), size_m: [r1(e.width), r1(e.height)],
      rotation_deg: Math.round(e.rotation), corners: pts(e.corners),
    }))
  }

  if (input.shore) {
    const s = simplifyShore(input.shore, input.radiusM)
    out.shoreline = {
      source: 'OpenStreetMap coastline (water on the sea side)',
      sea_bearing_from_origin_deg: input.shore.seaBearingDegrees == null ? null : Math.round(input.shore.seaBearingDegrees),
      distance_origin_to_waterline_m: input.shore.distanceFromOriginM == null ? null : r1(input.shore.distanceFromOriginM),
      lines: s.lines,
      ...(s.waterEdge.length ? { water_edge_clipped_to_area: s.waterEdge } : {}),
      note: 'Simplified polylines; use measure({ b: { shoreline: true } }) for exact distances.',
    }
  }

  if (input.osm) {
    out.osm = {
      shown: input.osm.items.length,
      total_in_radius: input.osm.total,
      ...(Object.keys(input.osm.dropped).length ? { dropped_by_cap: input.osm.dropped } : {}),
      features: input.osm.items.map((f) => ({
        id: f.id, kind: f.kind, type: f.subtype, ...(f.name ? { name: f.name } : {}), dist_m: r1(f.distanceM),
        ...(f.shape === 'point' ? { at: pt(f.pts[0]!) } : f.shape === 'line' ? { line: pts(f.pts) } : { area: pts(f.pts) }),
      })),
    }
  }

  if (notes.length) out.notes = notes
  return out
}
