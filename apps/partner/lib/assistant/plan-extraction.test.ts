/**
 * Plan -> schematic conversion (track 030 S8), pure level. Requirements: the model's pixel readings
 * become schematic METRES deterministically; no scale => no guess; everything is clamped to the
 * canvas; overlaps are dropped (objects) or flagged (parcels); a parcel's generated grid lands where
 * the block was DRAWN (checked against the real schematic generator).
 */
import { describe, it, expect } from 'vitest'
import { generateChairsSchematic } from '@/app/sites/[id]/inventory/chair-util'
import {
  clampToCanvas, convertPlan, fitParcel, normaliseRotation, rectsOverlap, resolveScale, rotateCw, validatePlanExtraction,
  type PlanExtraction, type ResolvedScale,
} from './plan-extraction'

const base = (over: Partial<PlanExtraction> = {}): PlanExtraction => ({
  planArea: { x: 50, y: 50, w: 600, h: 400 },
  canvas: null,
  scale: null,
  seaSide: 'none',
  elements: [],
  parcels: [],
  confidence: 0.9,
  notes: '',
  ...over,
})
const el = (over: Record<string, unknown> = {}) => ({ type: 'bar', label: null, x: 100, y: 200, w: 200, h: 100, rotation: 0, confidence: 0.9, ...over })
const parcel = (over: Record<string, unknown> = {}) => ({ label: 'A', x: 300, y: 100, w: 100, h: 100, rotation: 0, rows: 2, seatsPerRow: 4, paired: true, confidence: 0.9, ...over })
// 0.1 m per pixel: the 600 x 400 px plan area is 60 x 40 m.
const S: ResolvedScale = { metresPerPx: 0.1, source: 'user', description: 'test' }
const convert = (plan: PlanExtraction, scale = S) => {
  const r = convertPlan(plan, scale)
  if (!r.ok) throw new Error(r.message)
  return r.plan
}

describe('validatePlanExtraction (strict schema)', () => {
  const valid = () => JSON.parse(JSON.stringify(base({ elements: [el()] as never, parcels: [parcel()] as never })))

  it('accepts a complete reading', () => {
    expect(validatePlanExtraction(valid()).ok).toBe(true)
  })
  it('rejects a missing required section, naming it', () => {
    const v = valid()
    delete v.planArea
    const r = validatePlanExtraction(v)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.errors.join()).toContain('planArea')
  })
  it('rejects an element type that is not a schematic element', () => {
    const v = valid()
    v.elements[0].type = 'sofa'
    expect(validatePlanExtraction(v).ok).toBe(false)
  })
  it('rejects unknown fields, fractional rows, out-of-range confidence and zero-size boxes', () => {
    for (const mutate of [
      (v: any) => { v.extra = 1 },
      (v: any) => { v.parcels[0].rows = 2.5 },
      (v: any) => { v.parcels[0].confidence = 1.4 },
      (v: any) => { v.elements[0].w = 0 },
      (v: any) => { v.parcels[0].seatsPerRow = 0 },
      (v: any) => { v.planArea.w = 'wide' },
    ]) {
      const v = valid()
      mutate(v)
      expect(validatePlanExtraction(v).ok).toBe(false)
    }
  })
  it('rejects a non-object and an empty reading (nothing recognised)', () => {
    expect(validatePlanExtraction('plan').ok).toBe(false)
    expect(validatePlanExtraction(JSON.parse(JSON.stringify(base()))).ok).toBe(false)
  })
  it('rejects a scale whose two points coincide', () => {
    const v = valid()
    v.scale = { metres: 10, from: { x: 5, y: 5 }, to: { x: 6, y: 5 }, source: 'scale_bar', confidence: 0.9 }
    expect(validatePlanExtraction(v).ok).toBe(false)
  })
})

describe('resolveScale: user > printed scale > stated size > unknown', () => {
  const bar = { metres: 10, from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, source: 'scale_bar' as const, confidence: 0.9 }

  it('the user dimension wins and divides by the plan area side', () => {
    const s = resolveScale(base({ scale: bar, canvas: { widthM: 99, heightM: 99 } }), { what: 'total_width', metres: 60 })!
    expect(s.source).toBe('user')
    expect(s.metresPerPx).toBeCloseTo(0.1)
    expect(resolveScale(base(), { what: 'total_height', metres: 40 })!.metresPerPx).toBeCloseTo(0.1)
  })
  it('a printed scale bar is metres over the pixel distance', () => {
    expect(resolveScale(base({ scale: bar }))!.metresPerPx).toBeCloseTo(0.1)
  })
  it('a low-confidence scale bar is not trusted', () => {
    expect(resolveScale(base({ scale: { ...bar, confidence: 0.3 } }))).toBeNull()
  })
  it('the size written on the drawing is the last resort', () => {
    const s = resolveScale(base({ canvas: { widthM: 30, heightM: 20 } }))!
    expect(s.source).toBe('stated_size')
    expect(s.metresPerPx).toBeCloseTo(0.05)
  })
  it('nothing known => null (the tool must ask, not guess)', () => {
    expect(resolveScale(base())).toBeNull()
  })
})

describe('geometry helpers', () => {
  it('rotates clockwise on a y-down screen', () => {
    const p = rotateCw(1, 0, 90)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(1)
  })
  it('normalises rotation to (-180, 180]', () => {
    expect([normaliseRotation(270), normaliseRotation(-190), normaliseRotation(360), normaliseRotation(180)]).toEqual([-90, 170, 0, 180])
  })
  it('SAT overlap: crossing rotated bars overlap, bars apart do not', () => {
    expect(rectsOverlap({ cx: 0, cy: 0, w: 10, h: 2, rot: 0 }, { cx: 0, cy: 0, w: 10, h: 2, rot: 90 })).toBe(true)
    expect(rectsOverlap({ cx: 0, cy: 0, w: 4, h: 2, rot: 0 }, { cx: 10, cy: 0, w: 4, h: 2, rot: 0 })).toBe(false)
  })
  it('touching edges are not an overlap (drawing slack)', () => {
    expect(rectsOverlap({ cx: 0, cy: 0, w: 4, h: 2, rot: 0 }, { cx: 4, cy: 0, w: 4, h: 2, rot: 0 })).toBe(false)
  })
})

describe('clampToCanvas', () => {
  const canvas = { width: 60, height: 40 }
  it('slides a slightly protruding rectangle inside and says it adjusted', () => {
    const r = clampToCanvas({ cx: 59, cy: 20, w: 6, h: 4, rot: 0 }, canvas)
    expect('rect' in r && r.rect.cx).toBe(57)
    expect('rect' in r && r.adjusted).toBe(true)
  })
  it('leaves an inside rectangle alone', () => {
    const r = clampToCanvas({ cx: 30, cy: 20, w: 6, h: 4, rot: 0 }, canvas)
    expect('rect' in r && r.adjusted).toBe(false)
  })
  it('drops one that is mostly off the canvas', () => {
    expect(clampToCanvas({ cx: 70, cy: 20, w: 6, h: 4, rot: 0 }, canvas)).toEqual({ dropped: true })
  })
  it('shrinks one bigger than the canvas to fit', () => {
    const r = clampToCanvas({ cx: 30, cy: 20, w: 90, h: 20, rot: 0 }, canvas)
    expect('rect' in r && r.rect.w).toBeCloseTo(60)
    expect('rect' in r && r.adjusted).toBe(true)
  })
  it('accounts for rotation: a 20 m bar turned 90 degrees needs 20 m of height, not width', () => {
    const r = clampToCanvas({ cx: 30, cy: 1, w: 20, h: 2, rot: 90 }, canvas)
    expect('rect' in r && r.rect.cy).toBeCloseTo(10)
  })
})

describe('convertPlan: pixels -> metres', () => {
  it('measures from the plan area origin at the resolved scale', () => {
    const p = convert(base({ elements: [el({ x: 100, y: 200, w: 200, h: 100, label: 'Chiringuito' })] as never }))
    expect(p.canvas).toEqual({ width: 60, height: 40 })
    expect(p.elements).toHaveLength(1)
    expect(p.elements[0]).toMatchObject({ type: 'bar', shape: 'rect', x: 5, y: 15, width: 20, height: 10, rotation: 0, label: 'Chiringuito' })
  })
  it('normalises rotation and keeps the centre of a rotated element', () => {
    const p = convert(base({ elements: [el({ x: 200, y: 200, w: 100, h: 40, rotation: 270 })] as never }))
    expect(p.elements[0]!.rotation).toBe(-90)
    expect(p.elements[0]!.x + p.elements[0]!.width / 2).toBeCloseTo(20)
    expect(p.elements[0]!.y + p.elements[0]!.height / 2).toBeCloseTo(17)
  })
  it('uses the preset shape of the element type (pool is an ellipse)', () => {
    const p = convert(base({ elements: [el({ type: 'pool', x: 100, y: 100, w: 100, h: 60 })] as never }))
    expect(p.elements[0]!.shape).toBe('ellipse')
  })
  it('canvas size follows the plan area, within 5 to 500 m', () => {
    expect(convert(base({ elements: [el()] as never }), { ...S, metresPerPx: 0.5 }).canvas).toEqual({ width: 300, height: 200 })
  })
  it('refuses a scale that makes the plan implausible instead of clamping silently', () => {
    const r = convertPlan(base({ elements: [el()] as never }), { ...S, metresPerPx: 10 })
    expect(r.ok).toBe(false)
    const tiny = convertPlan(base({ elements: [el()] as never }), { ...S, metresPerPx: 0.001 })
    expect(tiny.ok).toBe(false)
  })
  it('warns when the stated size and the scale disagree', () => {
    const p = convert(base({ canvas: { widthM: 20, heightM: 10 }, elements: [el()] as never }))
    expect(p.warnings.join()).toContain('check the scale')
  })
  it('drops an element lying outside the plan area and says so', () => {
    const p = convert(base({ elements: [el({ x: 5000, y: 5000 }), el({ type: 'sand', x: 100, y: 100 })] as never }))
    expect(p.elements.map((e) => e.type)).toEqual(['sand'])
    expect(p.warnings.join()).toContain('outside the plan area')
  })
})

describe('convertPlan: confidence and overlaps', () => {
  it('keeps low-confidence items but lists them; drops hopeless ones', () => {
    const p = convert(base({
      elements: [el({ label: 'Shaky', confidence: 0.4 }), el({ type: 'sand', x: 100, y: 100, confidence: 0.1 })] as never,
    }))
    expect(p.elements).toHaveLength(1)
    expect(p.lowConfidence.join()).toContain('Shaky')
    expect(p.warnings.join()).toContain('too uncertain')
  })
  it('two objects on the same spot: the more certain one stays', () => {
    const p = convert(base({ elements: [el({ label: 'Maybe', confidence: 0.7 }), el({ label: 'Sure', confidence: 0.95, x: 110 })] as never }))
    expect(p.elements.map((e) => e.label)).toEqual(['Sure'])
    expect(p.warnings.join()).toContain('overlapped')
  })
  it('a pool on a deck, and a bar on sand, are NOT overlaps', () => {
    const p = convert(base({ elements: [el({ type: 'deck', x: 100, y: 100, w: 300, h: 200 }), el({ type: 'pool', x: 150, y: 150, w: 100, h: 60 }), el({ type: 'sand', x: 100, y: 100, w: 300, h: 200 })] as never }))
    expect(p.elements).toHaveLength(3)
  })
  it('only the 30 most certain elements are proposed', () => {
    const many = Array.from({ length: 35 }, (_, i) => el({ type: 'shower', x: 60 + (i % 7) * 70, y: 60 + Math.floor(i / 7) * 60, w: 20, h: 20, confidence: 0.5 + i / 100 }))
    const p = convert(base({ elements: many as never }))
    expect(p.elements).toHaveLength(30)
    expect(p.warnings.join()).toContain('30 most certain')
  })
  it('flags overlapping parcels and a parcel on a bar, without moving them', () => {
    const p = convert(base({
      parcels: [parcel({ label: 'A', x: 200, y: 100 }), parcel({ label: 'B', x: 220, y: 110 })] as never,
      elements: [el({ type: 'bar', x: 210, y: 100, w: 60, h: 60 })] as never,
    }))
    expect(p.parcels).toHaveLength(2)
    const w = p.warnings.join('|')
    expect(w).toContain('"A" and "B" overlap')
    expect(w).toContain('overlaps bar')
  })
  it('a parcel on sand is fine, on water is flagged', () => {
    const ok = convert(base({ parcels: [parcel()] as never, elements: [el({ type: 'sand', x: 100, y: 50, w: 500, h: 300 })] as never }))
    expect(ok.warnings.join()).not.toContain('overlaps')
    const bad = convert(base({ parcels: [parcel()] as never, elements: [el({ type: 'water', x: 100, y: 50, w: 500, h: 300 })] as never }))
    expect(bad.warnings.join()).toContain('overlaps water')
  })
  it('notes a sea edge with no water recognised; says so when the whole plan is hard to read', () => {
    const p = convert(base({ seaSide: 'bottom', confidence: 0.4, elements: [el()] as never }))
    expect(p.warnings.join()).toContain('bottom edge')
    expect(p.warnings.join()).toContain('hard to read')
  })
})

describe('convertPlan: parcels', () => {
  it('fits the generated grid to the drawn block: centre and size', () => {
    const p = convert(base({ parcels: [parcel({ x: 300, y: 100, w: 150, h: 120, rows: 3, seatsPerRow: 6, paired: true })] as never }))
    const q = p.parcels[0]!
    // Drawn centre: ((300 + 75) - 50, (100 + 60) - 50) px * 0.1 = (32.5, 11) m.
    expect(q.footprint.cx).toBeCloseTo(32.5)
    expect(q.footprint.cy).toBeCloseTo(11)
    expect(q.footprint.w).toBeCloseTo(15, 0)
    expect(q.footprint.h).toBeCloseTo(12, 0)
  })

  it.each([0, 30, 90, -45])('the REAL schematic generator centres the grid on the drawn block at rotation %i', (rotation) => {
    const f = fitParcel({ rows: 3, seatsPerRow: 5, paired: true, wM: 12, hM: 9, cx: 25, cy: 18, rotation })
    const seats = generateChairsSchematic({
      group: 1, rows: 3, seatsPerRow: 5, horizontalGap: f.horizontalGap, verticalGap: f.verticalGap, intraPairGap: 0.4,
      pairSeats: true, rotation, baseX: f.anchor.x, baseY: f.anchor.y, baseLat: 0, baseLng: 0,
    } as never)
    const xs = seats.map((s) => s.schematicX)
    const ys = seats.map((s) => s.schematicY)
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(25, 1)
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(18, 1)
  })

  it('derives the gaps so the unrotated extent matches the drawn size', () => {
    const f = fitParcel({ rows: 2, seatsPerRow: 4, paired: false, wM: 10, hM: 8, cx: 20, cy: 20, rotation: 0 })
    expect(f.footprint.w).toBeCloseTo(10, 1)
    expect(f.footprint.h).toBeCloseTo(8, 1)
    expect(f.horizontalGap).toBeGreaterThan(0)
  })
  it('a single row / seat uses the editor defaults for the gap it cannot measure', () => {
    const f = fitParcel({ rows: 1, seatsPerRow: 1, paired: false, wM: 1, hM: 2, cx: 5, cy: 5, rotation: 0 })
    expect([f.horizontalGap, f.verticalGap]).toEqual([1, 1.5])
  })
  it('clamps absurd gaps to 0..10 m', () => {
    const f = fitParcel({ rows: 2, seatsPerRow: 2, paired: false, wM: 400, hM: 0.1, cx: 5, cy: 5, rotation: 0 })
    expect(f.horizontalGap).toBe(10)
    expect(f.verticalGap).toBe(0)
  })
  it('names unlabeled blocks and respects the seat cap', () => {
    const r = convertPlan(base({ parcels: [parcel({ label: null }), parcel({ label: 'Big', x: 400, rows: 10, seatsPerRow: 10 })] as never }), S, { maxSeats: 50 })
    if (!r.ok) throw new Error('unexpected')
    expect(r.plan.parcels.map((p) => p.label)).toEqual(['Block 1'])
    expect(r.plan.warnings.join()).toContain('"Big" was left out')
  })
  it('a parcel hanging off the canvas is flagged, not silently moved', () => {
    const p = convert(base({ parcels: [parcel({ x: 560, y: 100, w: 150 })] as never }))
    expect(p.parcels[0]!.footprint.cx).toBeCloseTo(58.5)
    expect(p.warnings.join()).toContain('extends past')
  })
})
