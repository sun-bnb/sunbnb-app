import { describe, expect, it } from 'vitest'
import { generateChairGrid, SUNBED_HEIGHT, SUNBED_WIDTH } from '@repo/schematic/grid'
import type { AerialDescriptorV1, AerialRowV1 } from '../vision/aerial-schema.ts'
import { METERS_PER_DEG_LAT, latLngToEnu, latLngToPx, metersPerDegLng, type LatLng, type SimilarityGeoref } from './georef.ts'
import { fitAerialDescriptor, needsOrientationFlip, type ParcelSpec } from './grid-fit.ts'

// ─── synthetic pipeline: ChairConfig -> real generator -> px descriptor ───────────

interface Cfg {
  anchor: LatLng
  rotation: number
  rows: number
  seatsPerRow: number
  horizontalGap: number
  verticalGap: number
  pairSeats: boolean
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Bed centres exactly as `chair-util.generateChairs` places them (dx east, dy north from the anchor). */
function bedLatLngs(cfg: Cfg) {
  const cells = generateChairGrid({
    group: 1,
    rotation: cfg.rotation,
    rows: cfg.rows,
    seatsPerRow: cfg.seatsPerRow,
    horizontalGap: cfg.horizontalGap,
    verticalGap: cfg.verticalGap,
    intraPairGap: 0.4,
    pairSeats: cfg.pairSeats,
  })
  const mLng = metersPerDegLng(cfg.anchor.lat)
  return cells.map((c) => ({ ...c, ll: { lat: cfg.anchor.lat + c.dy / METERS_PER_DEG_LAT, lng: cfg.anchor.lng + c.dx / mLng } }))
}

/** One descriptor row per generated row (R01 first = front), unit centres = parasol for pairs. */
function synthDescriptor(cfg: Cfg, g: SimilarityGeoref, rng: () => number, noisePx: number, facing: 'sea' | 'land' | 'unclear' = 'sea'): AerialDescriptorV1 {
  const beds = bedLatLngs(cfg)
  const byTemp = new Map(beds.map((b) => [b.tempId, b]))
  const rows: AerialRowV1[] = []
  for (let r = 1; r <= cfg.rows; r++) {
    const tag = `-R${String(r).padStart(2, '0')}C`
    const units = beds
      .filter((b) => b.tempId.includes(tag) && b.isPrimary)
      .map((b) => {
        const p = latLngToPx(g, b.ll)
        if (!b.pairTempId) return p
        const q = latLngToPx(g, byTemp.get(b.pairTempId)!.ll)
        return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
      })
    const jitter = (p: { x: number; y: number }) => ({ x: p.x + (rng() * 2 - 1) * noisePx, y: p.y + (rng() * 2 - 1) * noisePx })
    let first = jitter(units[0]!)
    let last = jitter(units[units.length - 1]!)
    if (rng() < 0.5) [first, last] = [last, first] // the model's left/right order is arbitrary
    rows.push({ first, last, units: units.length, paired: cfg.pairSeats, occludedBeds: 0, confidence: 0.9 })
  }
  return {
    image: { w: 6000, h: 6000 },
    view: 'nadir',
    usable: true,
    bed: { lengthPx: SUNBED_HEIGHT / g.metersPerPx, widthPx: SUNBED_WIDTH / g.metersPerPx },
    shoreline: { points: [], seaSide: 'none' },
    parcels: [{ id: 'A', rows, facing, confidence: 0.9 }],
    ignored: [],
  }
}

function randomCase(rng: () => number) {
  const pairSeats = rng() < 0.5
  const units = 3 + Math.floor(rng() * 10)
  const anchor = { lat: 36.72 + rng() * 0.01, lng: -4.42 + rng() * 0.01 }
  const cfg: Cfg = {
    anchor,
    rotation: rng() * 360,
    rows: 2 + Math.floor(rng() * 7),
    seatsPerRow: pairSeats ? units * 2 : units,
    horizontalGap: 0.3 + rng() * 2.2,
    verticalGap: 0.5 + rng() * 2.5,
    pairSeats,
  }
  const g: SimilarityGeoref = {
    kind: 'similarity',
    anchorPx: { x: 3000, y: 3000 },
    anchor: { lat: anchor.lat + (rng() - 0.5) * 2e-4, lng: anchor.lng + (rng() - 0.5) * 2e-4 },
    metersPerPx: 0.02 + rng() * 0.02,
    rotationDeg: rng() * 360,
  }
  return { cfg, g }
}

const angleDiff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180)
const metres = (a: LatLng, b: LatLng) => {
  const d = latLngToEnu(a, b)
  return Math.hypot(d.e, d.n)
}

function expectSameConfig(spec: ParcelSpec, cfg: Cfg) {
  expect(spec.rows).toBe(cfg.rows)
  expect(spec.seatsPerRow).toBe(cfg.seatsPerRow)
  expect(spec.paired).toBe(cfg.pairSeats)
  expect(Math.abs(spec.horizontalGap - cfg.horizontalGap)).toBeLessThanOrEqual(0.02)
  expect(Math.abs(spec.verticalGap - cfg.verticalGap)).toBeLessThanOrEqual(0.02)
  expect(angleDiff(spec.rotation, cfg.rotation)).toBeLessThanOrEqual(0.5)
  expect(metres(spec.anchor, cfg.anchor)).toBeLessThanOrEqual(0.05)
}

describe('fitAerialDescriptor — round trip through the real generator', () => {
  it('recovers random ChairConfigs exactly from noise-free descriptors', () => {
    const rng = mulberry32(42)
    for (let i = 0; i < 300; i++) {
      const { cfg, g } = randomCase(rng)
      const res = fitAerialDescriptor(synthDescriptor(cfg, g, rng, 0), g)
      expect(res.parcels).toHaveLength(1)
      const spec = res.parcels[0]!
      expectSameConfig(spec, cfg)
      expect(spec.warnings).toEqual([])
      expect(spec.confidence).toBeCloseTo(0.81, 3) // 0.9 × 0.9 × quality 1
      expect(spec.flipOrientation).toBe(false)
    }
  })

  it('recovers them within tolerance under ±0.3 px endpoint noise', () => {
    const rng = mulberry32(7)
    for (let i = 0; i < 300; i++) {
      const { cfg, g } = randomCase(rng)
      const res = fitAerialDescriptor(synthDescriptor(cfg, g, rng, 0.3), g)
      expect(res.parcels).toHaveLength(1)
      expectSameConfig(res.parcels[0]!, cfg)
      expect(res.parcels[0]!.confidence).toBeGreaterThan(0.7)
    }
  })
})

// ─── hand-built descriptors ───────────────────────────────────────────────────

const G: SimilarityGeoref = { kind: 'similarity', anchorPx: { x: 0, y: 0 }, anchor: { lat: 36.72, lng: -4.42 }, metersPerPx: 0.1, rotationDeg: 0 }
const row = (y: number, x0: number, x1: number, units: number, paired = false, extra: Partial<AerialRowV1> = {}): AerialRowV1 => ({
  first: { x: x0, y },
  last: { x: x1, y },
  units,
  paired,
  occludedBeds: 0,
  confidence: 1,
  ...extra,
})
const desc = (rows: AerialRowV1[], over: Partial<AerialDescriptorV1> = {}, facing: 'sea' | 'land' | 'unclear' = 'sea'): AerialDescriptorV1 => ({
  image: { w: 2000, h: 2000 },
  view: 'nadir',
  usable: true,
  bed: { lengthPx: 21, widthPx: 8.4 },
  shoreline: { points: [], seaSide: 'none' },
  parcels: [{ id: 'P', rows, facing, confidence: 1 }],
  ignored: [],
  ...over,
})

describe('fitAerialDescriptor — conventions and edge cases', () => {
  it('sea at the image bottom (south, north-up): R01 is the bottom row, seats run west -> east', () => {
    // Rows 4.5 m apart (45 px), single beds 2 m apart (20 px); front row is the lowest (largest y).
    const res = fitAerialDescriptor(desc([row(1000, 100, 280, 10), row(955, 100, 280, 10)]), G)
    const s = res.parcels[0]!
    expect(s.rotation).toBe(0) // u = east, v = north (landward)
    expect(s.horizontalGap).toBeCloseTo(2 - SUNBED_WIDTH, 2)
    expect(s.verticalGap).toBeCloseTo(4.5 - SUNBED_HEIGHT, 2)
    expect(s.anchor.lat).toBeCloseTo(36.72 - 100 / METERS_PER_DEG_LAT, 9) // front row, y = 1000 px = 100 m south
    expect(s.anchor.lng).toBeCloseTo(-4.42 + 10 / metersPerDegLng(36.72), 9) // western end
  })

  it('sea at the top: the corner flips so R01 stays the front row', () => {
    const res = fitAerialDescriptor(desc([row(955, 100, 280, 10), row(1000, 100, 280, 10)]), G)
    const s = res.parcels[0]!
    expect(s.rotation).toBe(180) // u = west, v = south (landward)
    expect(s.anchor.lat).toBeCloseTo(36.72 - 95.5 / METERS_PER_DEG_LAT, 9)
    expect(s.anchor.lng).toBeCloseTo(-4.42 + 28 / metersPerDegLng(36.72), 9) // eastern end
  })

  it('paired rows: anchor is the first BED, half a pair before the first parasol', () => {
    const pitch = 2 * SUNBED_WIDTH + 0.4 + 1.2
    const res = fitAerialDescriptor(desc([row(1000, 100, 100 + (4 * pitch) / 0.1, 5, true), row(950, 100, 100 + (4 * pitch) / 0.1, 5, true)]), G)
    const s = res.parcels[0]!
    expect(s.seatsPerRow).toBe(10)
    expect(s.horizontalGap).toBeCloseTo(1.2, 2)
    expect(s.anchor.lng).toBeCloseTo(-4.42 + (10 - (SUNBED_WIDTH + 0.4) / 2) / metersPerDegLng(36.72), 9)
  })

  it('splits uneven rows into rectangular parcels', () => {
    const res = fitAerialDescriptor(desc([row(1000, 100, 280, 10), row(955, 100, 280, 10), row(910, 100, 240, 8)]), G)
    expect(res.parcels.map((p) => [p.rows, p.seatsPerRow, p.sourceRows])).toEqual([
      [2, 10, [0, 1]],
      [1, 8, [2]],
    ])
    expect(res.warnings.join(' ')).toMatch(/uneven rows; split into 2/)
  })

  it('splits staggered rows with the same unit count', () => {
    const res = fitAerialDescriptor(desc([row(1000, 100, 280, 10), row(955, 100, 280, 10), row(910, 160, 340, 10)]), G)
    expect(res.parcels.map((p) => p.sourceRows)).toEqual([[0, 1], [2]])
  })

  it('single row: front from the sea side; one-unit rows fall back to defaults with warnings', () => {
    const sea = fitAerialDescriptor(desc([row(1000, 100, 280, 10)], { shoreline: { points: [], seaSide: 'top' } }), G).parcels[0]!
    expect(sea.rotation).toBe(180) // landward = south, so seats run west
    expect(sea.verticalGap).toBe(1.5)
    const lone = fitAerialDescriptor(desc([row(1000, 100, 100, 1)]), G).parcels[0]!
    expect(lone.rotation).toBe(0)
    expect(lone.horizontalGap).toBe(1)
    expect(lone.warnings.join(' ')).toMatch(/could not be measured/)
    expect(lone.warnings.join(' ')).toMatch(/Front row could not be determined/)
  })

  it('clamps overlapping spacing to 0 with a warning', () => {
    // Beds 0.5 m apart centre-to-centre (< 0.84 m width), rows 1.5 m apart (< 2.1 m length).
    const s = fitAerialDescriptor(desc([row(1000, 100, 145, 10), row(985, 100, 145, 10)]), G).parcels[0]!
    expect(s.horizontalGap).toBe(0)
    expect(s.verticalGap).toBe(0)
    expect(s.warnings.filter((w) => /clamped/.test(w))).toHaveLength(2)
  })

  it('clamps rows and seats to the 99 limit', () => {
    const rows = Array.from({ length: 101 }, (_, i) => row(1900 - i * 18, 10, 10 + 119 * 15, 120))
    const s = fitAerialDescriptor(desc(rows, { image: { w: 2000, h: 2000 } }), G).parcels[0]!
    expect(s.rows).toBe(99)
    expect(s.seatsPerRow).toBe(99)
    expect(s.warnings.filter((w) => /limit/.test(w))).toHaveLength(2)
  })

  it('facing: land -> flipOrientation; unclear -> no flip + warning', () => {
    expect(needsOrientationFlip('sea')).toBe(false)
    expect(needsOrientationFlip('land')).toBe(true)
    expect(needsOrientationFlip('unclear')).toBe(false)
    const rows = [row(1000, 100, 280, 10), row(955, 100, 280, 10)]
    expect(fitAerialDescriptor(desc(rows, {}, 'land'), G).parcels[0]!.flipOrientation).toBe(true)
    const unclear = fitAerialDescriptor(desc(rows, {}, 'unclear'), G).parcels[0]!
    expect(unclear.flipOrientation).toBe(false)
    expect(unclear.warnings.join(' ')).toMatch(/orientation unclear/)
  })

  it('confidence multiplies parcel, rows, fit quality and occlusion; minConfidence drops', () => {
    const rows = [row(1000, 100, 280, 10, false, { confidence: 0.8, occludedBeds: 4 }), row(955, 100, 280, 10, false, { confidence: 0.6 })]
    const s = fitAerialDescriptor(desc(rows), G).parcels[0]!
    expect(s.confidence).toBeCloseTo(1 * 0.7 * 1 * (1 - 0.5 * (4 / 20)), 6)
    expect(s.warnings.join(' ')).toMatch(/4 of 20 beds were hidden/)
    const dropped = fitAerialDescriptor(desc(rows), G, { minConfidence: 0.7 })
    expect(dropped.parcels).toEqual([])
    expect(dropped.warnings.join(' ')).toMatch(/dropped: confidence 0.63/)
  })

  it('a misfit row lowers fit quality', () => {
    const good = fitAerialDescriptor(desc([row(1000, 100, 280, 10), row(955, 100, 280, 10), row(910, 100, 280, 10)]), G).parcels[0]!
    const bad = fitAerialDescriptor(desc([row(1000, 100, 280, 10), row(940, 100, 280, 10), row(910, 100, 280, 10)]), G).parcels[0]!
    expect(good.confidence).toBeCloseTo(1, 6)
    expect(bad.confidence).toBeLessThan(0.8)
  })

  it('flags unusable / oblique photos', () => {
    const res = fitAerialDescriptor(desc([row(1000, 100, 280, 10)], { usable: false, view: 'oblique' }), G)
    expect(res.warnings).toEqual(['The photo was reported as unusable for a layout', 'The photo is oblique; distances may be distorted'])
  })
})
