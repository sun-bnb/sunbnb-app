/**
 * Drawn / printed plan -> schematic layout (track 030 S8): the PURE half.
 *
 * The vision model never draws the beach. It reports what it SEES in the picture's own pixel frame
 * (strict JSON, `PLAN_SCHEMA`); everything below is deterministic code that turns that into schematic
 * metres: scale resolution, pixel -> metre conversion, rotation, clamping to the canvas, overlap
 * handling and the parcel fit (rows x seats from a measured block, using the SAME grid generator the
 * schematic actions use, so the previewed parcel matches what the user drew).
 *
 * No Prisma, no network: unit-tested in `plan-extraction.test.ts`.
 *
 * Frames
 *  - image: pixels, origin top-left, +x right, +y down (the picture as sent to the model).
 *  - schematic: metres, origin = top-left of the drawn plan area, +x right, +y down; rotation =
 *    degrees CLOCKWISE (what the schematic editor and `generateChairsSchematic` use).
 */
import { validateJsonSchema } from '@repo/agent/schema'
import { generateChairGrid, SUNBED_HEIGHT, SUNBED_WIDTH } from '@repo/schematic/grid'
import { ELEMENT_PRESETS } from '@/app/sites/[id]/schematic/palette'
import type { LayoutAdd } from './proposals/handlers/layout'

// ─── Limits ──────────────────────────────────────────────────────────────────

export const MIN_CANVAS_M = 5
export const MAX_CANVAS_M = 500
/** Below this the item is listed as "please check"; below DROP_BELOW it is not proposed at all. */
export const LOW_CONFIDENCE = 0.6
export const DROP_BELOW = 0.25
/** A scale read off the picture is trusted only at or above this confidence. */
export const MIN_SCALE_CONFIDENCE = 0.5
export const MAX_ELEMENTS = 30
export const MAX_PARCELS = 20
export const MIN_ELEMENT_M = 0.5
const INTRA_PAIR_GAP = 0.4
const DEFAULT_H_GAP = 1
const DEFAULT_V_GAP = 1.5
const MAX_GAP = 10

// ─── Model output: strict schema ─────────────────────────────────────────────

const ELEMENT_TYPES = Object.keys(ELEMENT_PRESETS)

const NUM = { type: 'number' } as const
const CONF = { type: 'number', minimum: 0, maximum: 1 } as const
const POINT = { type: 'object', properties: { x: NUM, y: NUM }, required: ['x', 'y'], additionalProperties: false } as const

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    planArea: {
      type: 'object',
      description: 'Tight pixel box around the venue area the plan shows (the part that becomes the schematic canvas).',
      properties: { x: NUM, y: NUM, w: { type: 'number', minimum: 1 }, h: { type: 'number', minimum: 1 } },
      required: ['x', 'y', 'w', 'h'],
      additionalProperties: false,
    },
    canvas: {
      type: ['object', 'null'],
      description: 'Overall size in metres ONLY when the drawing states it (e.g. "60 x 40 m"); otherwise null.',
      properties: { widthM: { type: 'number', minimum: 1, maximum: 1000 }, heightM: { type: 'number', minimum: 1, maximum: 1000 } },
      required: ['widthM', 'heightM'],
      additionalProperties: false,
    },
    scale: {
      type: ['object', 'null'],
      description: 'A scale bar or dimension line printed on the drawing: two pixel points and the real distance between them; otherwise null.',
      properties: {
        metres: { type: 'number', minimum: 0.1, maximum: 1000 },
        from: POINT,
        to: POINT,
        source: { type: 'string', enum: ['scale_bar', 'dimension_line'] },
        confidence: CONF,
      },
      required: ['metres', 'from', 'to', 'source', 'confidence'],
      additionalProperties: false,
    },
    seaSide: { type: 'string', enum: ['top', 'bottom', 'left', 'right', 'none'], description: 'Which picture edge the sea / water is on.' },
    elements: {
      type: 'array',
      maxItems: 80,
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ELEMENT_TYPES },
          label: { type: ['string', 'null'], maxLength: 100 },
          x: NUM, y: NUM,
          w: { type: 'number', minimum: 1 },
          h: { type: 'number', minimum: 1 },
          rotation: { type: 'number', minimum: -360, maximum: 360 },
          confidence: CONF,
        },
        required: ['type', 'label', 'x', 'y', 'w', 'h', 'rotation', 'confidence'],
        additionalProperties: false,
      },
    },
    parcels: {
      type: 'array',
      maxItems: 60,
      items: {
        type: 'object',
        properties: {
          label: { type: ['string', 'null'], maxLength: 60 },
          x: NUM, y: NUM,
          w: { type: 'number', minimum: 1 },
          h: { type: 'number', minimum: 1 },
          rotation: { type: 'number', minimum: -360, maximum: 360 },
          rows: { type: 'integer', minimum: 1, maximum: 100 },
          seatsPerRow: { type: 'integer', minimum: 1, maximum: 100 },
          paired: { type: 'boolean' },
          confidence: CONF,
        },
        required: ['label', 'x', 'y', 'w', 'h', 'rotation', 'rows', 'seatsPerRow', 'paired', 'confidence'],
        additionalProperties: false,
      },
    },
    confidence: { ...CONF, description: 'How well the whole plan could be read.' },
    notes: { type: 'string', maxLength: 1500, description: 'Anything unclear, unreadable or assumed.' },
  },
  required: ['planArea', 'canvas', 'scale', 'seaSide', 'elements', 'parcels', 'confidence', 'notes'],
  additionalProperties: false,
} as const

export interface PlanElementIn { type: string; label: string | null; x: number; y: number; w: number; h: number; rotation: number; confidence: number }
export interface PlanParcelIn {
  label: string | null
  /** Pixel box of the block UNROTATED (its width runs along the rows); `rotation` turns it about its centre. */
  x: number; y: number; w: number; h: number
  rotation: number; rows: number; seatsPerRow: number; paired: boolean; confidence: number
}
export interface PlanExtraction {
  planArea: { x: number; y: number; w: number; h: number }
  canvas: { widthM: number; heightM: number } | null
  scale: { metres: number; from: { x: number; y: number }; to: { x: number; y: number }; source: 'scale_bar' | 'dimension_line'; confidence: number } | null
  seaSide: 'top' | 'bottom' | 'left' | 'right' | 'none'
  elements: PlanElementIn[]
  parcels: PlanParcelIn[]
  confidence: number
  notes: string
}

/** Schema errors + the cross-field rules a JSON schema cannot say. Empty = usable. */
export function validatePlanExtraction(raw: unknown): { ok: true; plan: PlanExtraction } | { ok: false; errors: string[] } {
  const errors = validateJsonSchema(PLAN_SCHEMA as unknown as Record<string, unknown>, raw, 'plan')
  if (errors.length) return { ok: false, errors: errors.slice(0, 8) }
  const plan = raw as PlanExtraction
  const extra: string[] = []
  if (plan.scale) {
    const d = Math.hypot(plan.scale.to.x - plan.scale.from.x, plan.scale.to.y - plan.scale.from.y)
    if (d < 10) extra.push('plan.scale: the two points are (almost) the same point')
  }
  if (plan.elements.length === 0 && plan.parcels.length === 0) extra.push('plan: nothing was recognised (no elements and no parcels)')
  return extra.length ? { ok: false, errors: extra } : { ok: true, plan }
}

// ─── Scale ───────────────────────────────────────────────────────────────────

export type KnownDimension = { what: 'total_width' | 'total_height'; metres: number }
export type ScaleSource = 'user' | 'scale_bar' | 'dimension_line' | 'stated_size'
export interface ResolvedScale { metresPerPx: number; source: ScaleSource; description: string }

/**
 * Metres per pixel, in order of authority: the user's stated dimension, a scale bar / dimension line
 * printed on the drawing, the drawing's stated overall size. Null = unknown: the caller must ASK for
 * a real-world dimension, never guess.
 */
export function resolveScale(plan: PlanExtraction, known?: KnownDimension | null): ResolvedScale | null {
  const area = plan.planArea
  if (known && Number.isFinite(known.metres) && known.metres > 0) {
    const px = known.what === 'total_width' ? area.w : area.h
    if (px > 0) return { metresPerPx: known.metres / px, source: 'user', description: `your ${known.what === 'total_width' ? 'width' : 'height'} of ${known.metres} m` }
  }
  const s = plan.scale
  if (s && s.confidence >= MIN_SCALE_CONFIDENCE) {
    const d = Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y)
    if (d >= 10) return { metresPerPx: s.metres / d, source: s.source, description: `the ${s.source === 'scale_bar' ? 'scale bar' : 'dimension line'} on the drawing (${s.metres} m)` }
  }
  if (plan.canvas && area.w > 0) {
    return { metresPerPx: plan.canvas.widthM / area.w, source: 'stated_size', description: `the size written on the drawing (${plan.canvas.widthM} x ${plan.canvas.heightM} m)` }
  }
  return null
}

// ─── Geometry ────────────────────────────────────────────────────────────────

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const rad = (deg: number) => (deg * Math.PI) / 180

/** Rotate (dx,dy) clockwise on screen (y down) by `deg` degrees. */
export function rotateCw(dx: number, dy: number, deg: number): { x: number; y: number } {
  const a = rad(deg)
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) }
}

/** Normalise to (-180, 180]. */
export function normaliseRotation(deg: number): number {
  let d = deg % 360
  if (d > 180) d -= 360
  if (d <= -180) d += 360
  return r2(d === 0 ? 0 : d)
}

export interface CentredRect { cx: number; cy: number; w: number; h: number; rot: number }

const corners = (r: CentredRect, shrink = 0): Array<{ x: number; y: number }> => {
  const hw = (r.w * (1 - shrink)) / 2
  const hh = (r.h * (1 - shrink)) / 2
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([dx, dy]) => {
    const p = rotateCw(dx!, dy!, r.rot)
    return { x: r.cx + p.x, y: r.cy + p.y }
  })
}

/** Separating-axis test on two rotated rectangles. `shrink` (0..1) tolerates edge contact / drawing slack. */
export function rectsOverlap(a: CentredRect, b: CentredRect, shrink = 0.1): boolean {
  const pa = corners(a, shrink)
  const pb = corners(b, shrink)
  for (const poly of [pa, pb]) {
    for (let i = 0; i < 2; i++) {
      const p0 = poly[i]!
      const p1 = poly[i + 1]!
      const nx = -(p1.y - p0.y)
      const ny = p1.x - p0.x
      const proj = (pts: typeof pa) => pts.map((p) => p.x * nx + p.y * ny)
      const A = proj(pa)
      const B = proj(pb)
      if (Math.max(...A) <= Math.min(...B) || Math.max(...B) <= Math.min(...A)) return false
    }
  }
  return true
}

/** Axis-aligned half extents of a rotated rectangle. */
const halfExtents = (r: CentredRect) => {
  const c = Math.abs(Math.cos(rad(r.rot)))
  const s = Math.abs(Math.sin(rad(r.rot)))
  return { ex: (r.w * c + r.h * s) / 2, ey: (r.w * s + r.h * c) / 2 }
}

export type ClampResult = { rect: CentredRect; adjusted: boolean } | { dropped: true }

/**
 * Fit a rotated rectangle inside the canvas: dropped when under half of it is on the canvas, else
 * shrunk uniformly (if bigger than the canvas) and slid inside. `adjusted` = moved / shrunk by more
 * than drawing slack (25 cm, 2 %).
 */
export function clampToCanvas(r: CentredRect, canvas: { width: number; height: number }): ClampResult {
  const { ex, ey } = halfExtents(r)
  const ix = Math.max(0, Math.min(r.cx + ex, canvas.width) - Math.max(r.cx - ex, 0))
  const iy = Math.max(0, Math.min(r.cy + ey, canvas.height) - Math.max(r.cy - ey, 0))
  if (ix * iy < 0.5 * (4 * ex * ey)) return { dropped: true }
  const f = Math.min(1, canvas.width / (2 * ex), canvas.height / (2 * ey))
  const w = r.w * f
  const h = r.h * f
  const e = halfExtents({ ...r, w, h })
  const cx = Math.min(Math.max(r.cx, e.ex), canvas.width - e.ex)
  const cy = Math.min(Math.max(r.cy, e.ey), canvas.height - e.ey)
  const adjusted = f < 0.98 || Math.abs(cx - r.cx) > 0.25 || Math.abs(cy - r.cy) > 0.25
  return { rect: { cx, cy, w, h, rot: r.rot }, adjusted }
}

// ─── Parcel fit ──────────────────────────────────────────────────────────────

const cellsOf = (rows: number, seatsPerRow: number, paired: boolean, h: number, v: number) =>
  generateChairGrid({ group: 1, rotation: 0, rows, seatsPerRow, horizontalGap: h, verticalGap: v, intraPairGap: INTRA_PAIR_GAP, pairSeats: paired })

const extentOf = (cells: ReturnType<typeof cellsOf>) => {
  const xs = cells.map((c) => c.dx)
  const ys = cells.map((c) => c.dy)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return { w: maxX - minX + SUNBED_WIDTH, h: maxY - minY + SUNBED_HEIGHT, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
}

export interface ParcelFit {
  horizontalGap: number
  verticalGap: number
  /** First-sunbed anchor (what a `create_parcel` op takes), schematic metres. */
  anchor: { x: number; y: number }
  /** The block's footprint as the grid will actually produce it. */
  footprint: CentredRect
}

/**
 * Solve the gaps that make the generated grid span a measured `wM x hM` block, then place the anchor
 * so the block's centre lands on (`cx`,`cy`). The grid extent is linear in each gap, so two probes of
 * the real generator give the exact slope: no duplicated sunbed-size constants.
 */
export function fitParcel(p: { rows: number; seatsPerRow: number; paired: boolean; wM: number; hM: number; cx: number; cy: number; rotation: number }): ParcelFit {
  const solve = (axis: 'w' | 'h'): number => {
    const count = axis === 'w' ? p.seatsPerRow : p.rows
    if (count < 2) return axis === 'w' ? DEFAULT_H_GAP : DEFAULT_V_GAP
    const at = (g: number) => extentOf(axis === 'w' ? cellsOf(p.rows, p.seatsPerRow, p.paired, g, 0) : cellsOf(p.rows, p.seatsPerRow, p.paired, 0, g))[axis]
    const e0 = at(0)
    const slope = at(1) - e0
    if (slope <= 0) return axis === 'w' ? DEFAULT_H_GAP : DEFAULT_V_GAP
    const g = ((axis === 'w' ? p.wM : p.hM) - e0) / slope
    return r2(Math.min(MAX_GAP, Math.max(0, g)))
  }
  const horizontalGap = solve('w')
  const verticalGap = solve('h')
  const ext = extentOf(cellsOf(p.rows, p.seatsPerRow, p.paired, horizontalGap, verticalGap))
  const off = rotateCw(ext.cx, ext.cy, p.rotation)
  return {
    horizontalGap,
    verticalGap,
    anchor: { x: r2(p.cx - off.x), y: r2(p.cy - off.y) },
    footprint: { cx: p.cx, cy: p.cy, w: ext.w, h: ext.h, rot: p.rotation },
  }
}

// ─── Conversion ──────────────────────────────────────────────────────────────

export interface ConvertedElement extends LayoutAdd { confidence: number }
export interface ConvertedParcel {
  label: string
  rows: number
  seatsPerRow: number
  paired: boolean
  horizontalGap: number
  verticalGap: number
  rotation: number
  anchor: { x: number; y: number }
  footprint: CentredRect
  confidence: number
}

export interface ConvertedPlan {
  scale: ResolvedScale
  canvas: { width: number; height: number }
  elements: ConvertedElement[]
  parcels: ConvertedParcel[]
  /** Everything the user should look at before applying (overlaps, adjustments, drops). */
  warnings: string[]
  /** Items kept but read with low confidence: "type label (NN %)". */
  lowConfidence: string[]
}

export type ConvertResult = { ok: true; plan: ConvertedPlan } | { ok: false; reason: 'implausible_scale'; message: string }

const isSurface = (type: string) => ELEMENT_PRESETS[type] !== undefined && ['water', 'sand', 'grass', 'deck'].includes(type)
const bodyOfWater = (type: string) => type === 'water' || type === 'pool'
const nameOf = (type: string, label: string | null) => (label ? `${type} "${label}"` : type)
const pct = (c: number) => `${Math.round(c * 100)} %`

export function convertPlan(plan: PlanExtraction, scale: ResolvedScale, opts: { maxSeats?: number } = {}): ConvertResult {
  const mpp = scale.metresPerPx
  const area = plan.planArea
  const rawW = area.w * mpp
  const rawH = area.h * mpp
  if (!(rawW >= MIN_CANVAS_M * 0.5 && rawH >= MIN_CANVAS_M * 0.5) || rawW > MAX_CANVAS_M * 1.2 || rawH > MAX_CANVAS_M * 1.2) {
    return {
      ok: false,
      reason: 'implausible_scale',
      message: `With that scale the plan would be ${r1(rawW)} x ${r1(rawH)} m, outside the 5 to 500 m the schematic supports`,
    }
  }
  const canvas = {
    width: r1(Math.min(MAX_CANVAS_M, Math.max(MIN_CANVAS_M, rawW))),
    height: r1(Math.min(MAX_CANVAS_M, Math.max(MIN_CANVAS_M, rawH))),
  }
  const warnings: string[] = []
  const low: string[] = []
  const toM = (px: number, origin: number) => (px - origin) * mpp

  if (plan.canvas && scale.source !== 'stated_size') {
    const dw = Math.abs(plan.canvas.widthM - rawW) / plan.canvas.widthM
    const dh = Math.abs(plan.canvas.heightM - rawH) / plan.canvas.heightM
    if (dw > 0.25 || dh > 0.25) warnings.push(`The drawing says ${plan.canvas.widthM} x ${plan.canvas.heightM} m but the scale gives ${r1(rawW)} x ${r1(rawH)} m: check the scale`)
  }

  // ── elements ──
  type Candidate = ConvertedElement & { rect: CentredRect; idx: number }
  let cands: Candidate[] = []
  for (const [idx, e] of plan.elements.entries()) {
    const preset = ELEMENT_PRESETS[e.type]
    if (!preset) continue
    const name = nameOf(e.type, e.label)
    if (e.confidence < DROP_BELOW) {
      warnings.push(`Skipped ${name}: too uncertain (${pct(e.confidence)})`)
      continue
    }
    const rect: CentredRect = {
      cx: toM(e.x + e.w / 2, area.x),
      cy: toM(e.y + e.h / 2, area.y),
      w: Math.max(MIN_ELEMENT_M, e.w * mpp),
      h: Math.max(MIN_ELEMENT_M, e.h * mpp),
      rot: normaliseRotation(e.rotation),
    }
    const fit = clampToCanvas(rect, canvas)
    if ('dropped' in fit) {
      warnings.push(`Skipped ${name}: it lies outside the plan area`)
      continue
    }
    if (fit.adjusted) warnings.push(`${name} was moved or shrunk to fit the ${canvas.width} x ${canvas.height} m canvas`)
    const r = fit.rect
    cands.push({
      idx, rect: r, confidence: e.confidence,
      type: preset.type, shape: preset.shape,
      x: r2(r.cx - r.w / 2), y: r2(r.cy - r.h / 2), width: r2(r.w), height: r2(r.h), rotation: r.rot,
      label: e.label?.trim() ? e.label.trim().slice(0, 100) : null, color: null,
    })
  }

  // Overlaps among elements: two OBJECTS (bar, pool, shower ...) or two surfaces of the same type
  // cannot occupy the same spot: keep the more confident one. Surfaces under objects are normal.
  const dropped = new Set<number>()
  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      const a = cands[i]!
      const b = cands[j]!
      if (dropped.has(a.idx) || dropped.has(b.idx)) continue
      const bothObjects = !isSurface(a.type) && !isSurface(b.type)
      const sameSurface = isSurface(a.type) && a.type === b.type
      if (!(bothObjects || sameSurface) || !rectsOverlap(a.rect, b.rect)) continue
      const [keep, drop] = a.confidence >= b.confidence ? [a, b] : [b, a]
      dropped.add(drop.idx)
      warnings.push(`${nameOf(drop.type, drop.label)} overlapped ${nameOf(keep.type, keep.label)} and was left out`)
    }
  }
  cands = cands.filter((c) => !dropped.has(c.idx))
  if (cands.length > MAX_ELEMENTS) {
    const keep = new Set([...cands].sort((a, b) => b.confidence - a.confidence).slice(0, MAX_ELEMENTS).map((c) => c.idx))
    warnings.push(`Only the ${MAX_ELEMENTS} most certain elements are proposed (${cands.length - MAX_ELEMENTS} left out): propose the rest in a second step`)
    cands = cands.filter((c) => keep.has(c.idx))
  }
  const elements: ConvertedElement[] = cands.map(({ rect: _rect, idx: _idx, ...e }) => e)
  for (const e of elements) if (e.confidence < LOW_CONFIDENCE) low.push(`${nameOf(e.type, e.label)} (${pct(e.confidence)})`)

  // ── parcels ──
  const maxSeats = opts.maxSeats ?? 1200
  const parcels: ConvertedParcel[] = []
  let seats = 0
  for (const [i, p] of plan.parcels.entries()) {
    const label = p.label?.trim() || `Block ${i + 1}`
    if (p.confidence < DROP_BELOW) {
      warnings.push(`Skipped parcel "${label}": too uncertain (${pct(p.confidence)})`)
      continue
    }
    if (parcels.length >= MAX_PARCELS || seats + p.rows * p.seatsPerRow > maxSeats) {
      warnings.push(`Parcel "${label}" was left out: at most ${MAX_PARCELS} parcels / ${maxSeats} sunbeds per proposal`)
      continue
    }
    const rotation = normaliseRotation(p.rotation)
    const fit = fitParcel({
      rows: p.rows, seatsPerRow: p.seatsPerRow, paired: p.paired,
      wM: p.w * mpp, hM: p.h * mpp,
      cx: toM(p.x + p.w / 2, area.x), cy: toM(p.y + p.h / 2, area.y), rotation,
    })
    const inside = clampToCanvas(fit.footprint, canvas)
    if ('dropped' in inside) {
      warnings.push(`Skipped parcel "${label}": it lies outside the plan area`)
      continue
    }
    if (inside.adjusted) warnings.push(`Parcel "${label}" extends past the ${canvas.width} x ${canvas.height} m canvas: move it after applying`)
    seats += p.rows * p.seatsPerRow
    parcels.push({
      label, rows: p.rows, seatsPerRow: p.seatsPerRow, paired: p.paired,
      horizontalGap: fit.horizontalGap, verticalGap: fit.verticalGap, rotation, anchor: fit.anchor, footprint: fit.footprint, confidence: p.confidence,
    })
    if (p.confidence < LOW_CONFIDENCE) low.push(`parcel "${label}" (${pct(p.confidence)})`)
  }

  // Parcels vs. parcels / objects / open water: flagged, never silently moved.
  for (let i = 0; i < parcels.length; i++) {
    for (let j = i + 1; j < parcels.length; j++) {
      if (rectsOverlap(parcels[i]!.footprint, parcels[j]!.footprint)) warnings.push(`Parcels "${parcels[i]!.label}" and "${parcels[j]!.label}" overlap`)
    }
    for (const c of cands) {
      if (dropped.has(c.idx)) continue
      if ((!isSurface(c.type) || bodyOfWater(c.type)) && rectsOverlap(parcels[i]!.footprint, c.rect)) {
        warnings.push(`Parcel "${parcels[i]!.label}" overlaps ${nameOf(c.type, c.label)}`)
      }
    }
  }

  if (plan.seaSide !== 'none' && !plan.elements.some((e) => e.type === 'water')) {
    warnings.push(`The sea is on the ${plan.seaSide} edge of the picture but no water area was recognised: add one if you want it on the layout`)
  }
  if (plan.confidence < LOW_CONFIDENCE) warnings.push(`The plan was hard to read overall (${pct(plan.confidence)}): check everything carefully`)

  return { ok: true, plan: { scale, canvas, elements, parcels, warnings, lowConfidence: low } }
}
