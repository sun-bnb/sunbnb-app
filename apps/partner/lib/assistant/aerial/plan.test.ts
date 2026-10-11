/**
 * Aerial plan (track 030 S7). Requirements: parcels are numbered from the site's max + 1; a beach
 * larger than one proposal (1200 sunbeds) becomes several proposals, none over the cap, covering
 * every bed; beds facing away from the sea get a `reverse orientation` op; low-confidence parcels are
 * dropped (and said so); a parcel over existing sunbeds and a parcel in the sea are warned about; no
 * coastline = no sea check (and no false sea warnings).
 */
import { describe, it, expect } from 'vitest'
import { pxToLatLng, type SimilarityGeoref } from '@repo/agent/geo/georef'
import type { AerialDescriptorV1, AerialParcelV1 } from '@repo/agent/vision/aerial-schema'
import { planAerialLayout, splitSpecByRows, MAX_SEATS_PER_PROPOSAL } from './plan'

// 5 cm / px, north-up; sea at the top of the image.
const G: SimilarityGeoref = { kind: 'similarity', anchorPx: { x: 0, y: 0 }, anchor: { lat: 36.7, lng: -4.4 }, metersPerPx: 0.05, rotationDeg: 0 }

function block(id: string, rows: number, units: number, opts: { x0?: number; y0?: number; confidence?: number; facing?: AerialParcelV1['facing'] } = {}): AerialParcelV1 {
  const x0 = opts.x0 ?? 100
  const y0 = opts.y0 ?? 100
  // single beds every 2 m (40 px), rows every 4 m (80 px), front row nearest the sea (top)
  return {
    id,
    facing: opts.facing ?? 'sea',
    confidence: opts.confidence ?? 0.95,
    rows: Array.from({ length: rows }, (_, r) => ({
      first: { x: x0, y: y0 + r * 80 }, last: { x: x0 + (units - 1) * 40, y: y0 + r * 80 },
      units, paired: false, occludedBeds: 0, confidence: 0.95,
    })),
  }
}

function descriptor(parcels: AerialParcelV1[]): AerialDescriptorV1 {
  return {
    image: { w: 4000, h: 4000 }, view: 'nadir', usable: true, bed: { lengthPx: 42, widthPx: 17 },
    shoreline: { points: [{ x: 0, y: 20 }, { x: 4000, y: 20 }], seaSide: 'top' }, parcels, ignored: [],
  }
}

const base = { georef: G, nextParcelNumber: 7, existing: [], shore: null }

describe('planAerialLayout', () => {
  it('numbers parcels from the next free number and emits one create_parcel per block', () => {
    const plan = planAerialLayout({ ...base, descriptor: descriptor([block('A', 3, 10), block('B', 2, 5, { x0: 1000 })]) })
    expect(plan.proposals).toHaveLength(1)
    const creates = plan.proposals[0]!.ops.filter((o) => o.op === 'create_parcel')
    expect(creates.map((o) => (o as { number: number }).number)).toEqual([7, 8])
    expect(plan.proposals[0]!.parcels.map((p) => [p.rows, p.seatsPerRow])).toEqual([[3, 10], [2, 5]])
    expect(plan.proposals[0]!.seats).toBe(40)
  })

  it('splits a beach over 1200 sunbeds into proposals of at most 1200, losing no bed', () => {
    // 30 rows x 60 = 1800 beds in one block
    const plan = planAerialLayout({ ...base, descriptor: descriptor([block('BIG', 30, 60)]) })
    expect(plan.proposals.length).toBeGreaterThan(1)
    for (const p of plan.proposals) expect(p.seats).toBeLessThanOrEqual(MAX_SEATS_PER_PROPOSAL)
    expect(plan.proposals.reduce((n, p) => n + p.seats, 0)).toBe(1800)
    const numbers = plan.proposals.flatMap((p) => p.parcels.map((x) => x.number))
    expect(new Set(numbers).size).toBe(numbers.length)
    expect(plan.warnings.join(' ')).toMatch(/split into \d+ parcels by rows/)
  })

  it('row bands continue where the previous band ended (anchors shifted by whole row strides)', () => {
    const plan = planAerialLayout({ ...base, descriptor: descriptor([block('BIG', 30, 60)]) })
    const [a, b] = plan.proposals.flatMap((p) => p.ops.filter((o) => o.op === 'create_parcel')) as Array<{ anchor: { y: number; x: number }; rows: number; verticalGap: number }>
    const metres = (a!.anchor.y - b!.anchor.y) * 111320 // rows run south (landward)
    expect(metres).toBeCloseTo(a!.rows * (2.1 + a!.verticalGap), 1)
    expect(b!.anchor.x).toBeCloseTo(a!.anchor.x, 7)
  })

  it('beds facing land get a reverse-orientation op on that parcel only', () => {
    const plan = planAerialLayout({ ...base, descriptor: descriptor([block('A', 2, 4), block('B', 2, 4, { x0: 1000, facing: 'land' })]) })
    const reverses = plan.proposals[0]!.ops.filter((o) => o.op === 'reverse')
    expect(reverses).toEqual([{ op: 'reverse', parcel: 8, what: 'orientation' }])
  })

  it('drops parcels below min_confidence and reports it', () => {
    const plan = planAerialLayout({ ...base, minConfidence: 0.5, descriptor: descriptor([block('A', 2, 4), block('B', 2, 4, { x0: 1000, confidence: 0.2 })]) })
    expect(plan.proposals.flatMap((p) => p.parcels).map((p) => p.sourceParcelId)).toEqual(['A'])
    expect(plan.dropped).toBe(1)
    expect(plan.warnings.join(' ')).toMatch(/Parcel B .*dropped/)
  })

  it('warns when a proposed parcel covers existing sunbeds, naming the parcel', () => {
    const inside = pxToLatLng(G, { x: 200, y: 140 })
    const far = pxToLatLng(G, { x: 3500, y: 3500 })
    const plan = planAerialLayout({ ...base, descriptor: descriptor([block('A', 2, 10)]), existing: [{ parcel: 3, points: [inside, far] }, { parcel: 4, points: [far] }] })
    const w = plan.proposals[0]!.parcels[0]!.warnings.join(' ')
    expect(w).toMatch(/overlaps existing parcel 3 \(1 sunbed\)/)
    expect(w).not.toMatch(/parcel 4/)
  })

  it('warns when a parcel lies in the sea by the coastline, and not when it is on land', () => {
    const west = pxToLatLng(G, { x: -1000, y: 20 })
    const east = pxToLatLng(G, { x: 5000, y: 20 })
    // Water is on the RIGHT of a shore way: west->east puts the sea to the south (the beds) ...
    const wet = planAerialLayout({ ...base, descriptor: descriptor([block('A', 2, 4)]), shore: { ways: [[west, east]], water: [] } })
    expect(wet.proposals[0]!.parcels[0]!.warnings.join(' ')).toMatch(/into the sea/)
    // ... east->west puts it to the north: the beds are on land.
    const dry = planAerialLayout({ ...base, descriptor: descriptor([block('A', 2, 4)]), shore: { ways: [[east, west]], water: [] } })
    expect(dry.proposals[0]!.parcels[0]!.warnings.join(' ')).not.toMatch(/sea/)
  })

  it('without a coastline the sea check is skipped (no sea warnings)', () => {
    const plan = planAerialLayout({ ...base, descriptor: descriptor([block('A', 2, 4)]) })
    expect(plan.proposals[0]!.parcels[0]!.warnings.join(' ')).not.toMatch(/sea/)
  })
})

describe('splitSpecByRows', () => {
  it('leaves a spec under the cap untouched', () => {
    const spec = { sourceParcelId: 'A', sourceRows: [0, 1], anchor: { lat: 1, lng: 2 }, rows: 2, seatsPerRow: 10, paired: false, horizontalGap: 1, verticalGap: 1.5, intraPairGap: 0.4, rotation: 0, flipOrientation: false, confidence: 1, warnings: [] }
    expect(splitSpecByRows(spec, 1200)).toEqual([spec])
  })
})
