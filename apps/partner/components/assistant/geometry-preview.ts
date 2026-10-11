/**
 * Pure model for previewing an assistant `inventory_batch` proposal ON the map /
 * schematic before Apply (track 030 S4b). The server ships `preview.geometry`; this
 * file validates it (it crosses a JSON boundary), normalises both coordinate systems
 * to one `Pt` ({x,y}: geo x=lng y=lat, schematic x,y metres) and builds the ghost
 * list the editors paint. No React / maps API, so it is unit-testable.
 */

export type GeometryMode = 'geo' | 'schematic'
export const INVENTORY_BATCH_KIND = 'inventory_batch'
/** Schematic layout-element proposals (track 030 S4c); preview rides in `geometry.elements`. */
export const LAYOUT_ELEMENTS_KIND = 'layout_elements'
/** Canvas resize proposals (no geometry preview; the editor just resyncs). */
export const LAYOUT_CANVAS_KIND = 'layout_canvas'
/** Proposal kinds whose `preview.geometry` is drawn on the map / schematic. */
export const GEOMETRY_KINDS: readonly string[] = [INVENTORY_BATCH_KIND, LAYOUT_ELEMENTS_KIND]

/** Wire shape of one position: geo uses lat/lng, schematic uses x/y. */
export interface WirePos {
  lat?: number
  lng?: number
  x?: number
  y?: number
  rotation?: number
}

export interface Pt {
  x: number
  y: number
}

export interface ElementRect {
  x: number
  y: number
  w: number
  h: number
  rotation: number
}
export interface ElementPreview {
  added: { tempId: string; type: string; shape: string; label: string | null; rect: ElementRect }[]
  moved: { id: string; label: string; before: ElementRect; after: ElementRect }[]
  removed: { id: string; label: string }[]
}
const EMPTY_ELEMENTS: ElementPreview = { added: [], moved: [], removed: [] }

export interface GeometryPreview {
  elements: ElementPreview
  mode: GeometryMode
  moved: { id: string; label: string; before: WirePos; after: WirePos }[]
  added: { tempId: string; label?: string; at: WirePos; parcel?: number }[]
  removed: { id: string; label: string }[]
  parcels: { number: number; footprint: WirePos[] }[]
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

function pos(v: unknown): WirePos {
  const o = isObj(v) ? v : {}
  const p: WirePos = {}
  for (const k of ['lat', 'lng', 'x', 'y', 'rotation'] as const) {
    const n = num(o[k])
    if (n !== undefined) p[k] = n
  }
  return p
}

function rect(v: unknown): ElementRect | null {
  const o = isObj(v) ? v : {}
  const x = num(o.x), y = num(o.y), w = num(o.w), h = num(o.h)
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null
  return { x, y, w, h, rotation: num(o.rotation) ?? 0 }
}

function parseElements(v: unknown): ElementPreview {
  if (!isObj(v)) return EMPTY_ELEMENTS
  return {
    added: arr(v.added).filter(isObj).flatMap((a, i) => {
      const r = rect({ x: a.x, y: a.y, w: a.w, h: a.h, rotation: a.rotation })
      return r ? [{ tempId: text(a.tempId) || `e${i}`, type: text(a.type), shape: text(a.shape) || 'rect', label: a.label == null ? null : text(a.label), rect: r }] : []
    }),
    moved: arr(v.moved).filter(isObj).flatMap((m) => {
      const before = rect(m.before), after = rect(m.after)
      return before && after ? [{ id: text(m.id), label: text(m.label), before, after }] : []
    }),
    removed: arr(v.removed).filter(isObj).map((r) => ({ id: text(r.id), label: text(r.label) })),
  }
}

/** Tolerant parse of `preview.geometry`; null when there is nothing to draw. */
export function parseGeometry(preview: unknown): GeometryPreview | null {
  const g = isObj(preview) && isObj(preview.geometry) ? preview.geometry : null
  if (!g || (g.mode !== 'geo' && g.mode !== 'schematic')) return null
  const out: GeometryPreview = {
    mode: g.mode,
    moved: arr(g.moved).filter(isObj).map((m) => ({
      id: text(m.id), label: text(m.label), before: pos(m.before), after: pos(m.after),
    })),
    added: arr(g.added).filter(isObj).map((a, i) => ({
      tempId: text(a.tempId) || `added-${i}`,
      ...(a.label != null ? { label: text(a.label) } : {}),
      at: pos(a.at),
      ...(num(a.parcel) !== undefined ? { parcel: num(a.parcel) } : {}),
    })),
    removed: arr(g.removed).filter(isObj).map((r) => ({ id: text(r.id), label: text(r.label) })),
    parcels: arr(g.parcels).filter(isObj).flatMap((p) => {
      const number = num(p.number)
      return number === undefined ? [] : [{ number, footprint: arr(p.footprint).map(pos) }]
    }),
    elements: parseElements(g.elements),
  }
  const el = out.elements
  const empty = !out.moved.length && !out.added.length && !out.removed.length && !out.parcels.length
    && !el.added.length && !el.moved.length && !el.removed.length
  return empty ? null : out
}

/** Wire position -> Pt for the given mode; null when the needed coordinates are missing. */
export function toPt(mode: GeometryMode, p: WirePos): Pt | null {
  if (mode === 'geo') return p.lat !== undefined && p.lng !== undefined ? { x: p.lng, y: p.lat } : null
  return p.x !== undefined && p.y !== undefined ? { x: p.x, y: p.y } : null
}

export type GhostKind = 'added' | 'moved' | 'moved-from' | 'removed'

export interface GhostSeat {
  key: string
  kind: GhostKind
  at: Pt
  rotation: number
  label?: string
  /** Real inventory id (moved / removed) - for the schematic to tint the original. */
  itemId?: string
  parcel?: number
}
export interface GhostLink {
  key: string
  from: Pt
  to: Pt
}
export interface GhostParcel {
  number: number
  points: Pt[]
}
export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}
export interface GhostModel {
  mode: GeometryMode
  seats: GhostSeat[]
  links: GhostLink[]
  parcels: GhostParcel[]
  bounds: Bounds | null
  /** Layout-element ghosts (schematic only); seats counts above exclude them. */
  elements: ElementPreview
  counts: { added: number; moved: number; removed: number }
}

/** Where a real seat currently sits, so `removed` (id only on the wire) can be drawn. */
export type SeatLookup = (id: string) => { at: Pt; rotation: number } | undefined

export const MAX_GHOST_SEATS = 5000

function centroid(points: readonly Pt[]): Pt {
  let x = 0, y = 0
  for (const p of points) { x += p.x; y += p.y }
  return { x: x / points.length, y: y / points.length }
}

/** True when the preview deletes something: the only case a ghost is still drawn (everything else is applied at once). */
export const hasRemovals = (g: GeometryPreview): boolean => g.removed.length > 0 || (g.elements?.removed.length ?? 0) > 0

export function computeBounds(points: readonly Pt[]): Bounds | null {
  if (points.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

export function buildGhostModel(input: GeometryPreview, lookup?: SeatLookup): GhostModel {
  const geo = { ...input, elements: input.elements ?? EMPTY_ELEMENTS }
  const { mode } = geo
  const seats: GhostSeat[] = []
  const links: GhostLink[] = []
  const parcels: GhostParcel[] = []
  const pts: Pt[] = []
  const track = (p: Pt) => pts.push(p)

  for (const a of geo.added) {
    const at = toPt(mode, a.at)
    if (!at) continue
    seats.push({ key: `a:${a.tempId}`, kind: 'added', at, rotation: a.at.rotation ?? 0, label: a.label, parcel: a.parcel })
    track(at)
  }
  const fromPts: Pt[] = []
  const toPts: Pt[] = []
  for (const m of geo.moved) {
    const from = toPt(mode, m.before)
    const to = toPt(mode, m.after)
    if (!to) continue
    seats.push({ key: `m:${m.id}`, kind: 'moved', at: to, rotation: m.after.rotation ?? 0, label: m.label, itemId: m.id })
    track(to)
    if (from) {
      seats.push({ key: `f:${m.id}`, kind: 'moved-from', at: from, rotation: m.before.rotation ?? 0, itemId: m.id })
      fromPts.push(from)
      toPts.push(to)
      track(from)
    }
  }
  // One connector per move, not one per seat: a moved parcel is hundreds of seats that all shift by the
  // same vector, and a line from every old seat to its new one paints as a field of long streaks that
  // hides the boxes at the new position. A lone seat keeps its own arrow; a group gets one arrow between centroids.
  if (fromPts.length === 1) links.push({ key: `l:${geo.moved[0]!.id}`, from: fromPts[0]!, to: toPts[0]! })
  else if (fromPts.length > 1) links.push({ key: 'l:group', from: centroid(fromPts), to: centroid(toPts) })
  for (const r of geo.removed) {
    const hit = lookup?.(r.id)
    if (!hit) continue // not loaded (parcel tier): the parcel footprint still marks the area
    seats.push({ key: `r:${r.id}`, kind: 'removed', at: hit.at, rotation: hit.rotation, label: r.label, itemId: r.id })
    track(hit.at)
  }
  for (const e of geo.elements.added) track({ x: e.rect.x, y: e.rect.y }), track({ x: e.rect.x + e.rect.w, y: e.rect.y + e.rect.h })
  for (const e of geo.elements.moved) track({ x: e.after.x, y: e.after.y }), track({ x: e.after.x + e.after.w, y: e.after.y + e.after.h })
  for (const p of geo.parcels) {
    const points = p.footprint.map((f) => toPt(mode, f)).filter((x): x is Pt => x !== null)
    if (points.length < 2) continue
    parcels.push({ number: p.number, points })
    points.forEach(track)
  }

  return {
    mode,
    seats: seats.length > MAX_GHOST_SEATS ? seats.slice(0, MAX_GHOST_SEATS) : seats,
    links,
    parcels,
    bounds: computeBounds(pts),
    elements: geo.elements,
    counts: {
      added: geo.added.length + geo.elements.added.length,
      moved: geo.moved.length + geo.elements.moved.length,
      removed: geo.removed.length + geo.elements.removed.length,
    },
  }
}

/** Sunbed footprint (matches `@repo/schematic` renderer: 0.84 x 2.1 m). */
export const SEAT_WIDTH_M = 0.84
export const SEAT_LENGTH_M = 2.1
const METERS_PER_LAT = 111320

/**
 * Four lat/lng corners of a seat centred at `at` (x=lng, y=lat), rotated clockwise by
 * `rotation` degrees - the same convention as `parcelFootprint` / the SunbedMarker SVG.
 */
export function seatCornersGeo(at: Pt, rotation: number, widthM = SEAT_WIDTH_M, lengthM = SEAT_LENGTH_M): { lat: number; lng: number }[] {
  const rad = (rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const metersPerLng = METERS_PER_LAT * Math.cos((at.y * Math.PI) / 180)
  const hw = widthM / 2
  const hl = lengthM / 2
  return [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]].map(([dx, dy]) => ({
    lat: at.y + (dy! * cos - dx! * sin) / METERS_PER_LAT,
    lng: at.x + (dy! * sin + dx! * cos) / metersPerLng,
  }))
}

/** "N added · M moved · K removed" parts, zero counts omitted. */
export function summaryParts(counts: GhostModel['counts']): { key: 'added' | 'moved' | 'removed'; n: number }[] {
  return (['added', 'moved', 'removed'] as const).filter((k) => counts[k] > 0).map((k) => ({ key: k, n: counts[k] }))
}
