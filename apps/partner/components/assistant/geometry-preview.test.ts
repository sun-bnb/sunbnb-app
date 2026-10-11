import { describe, it, expect } from 'vitest'
import {
  buildGhostModel, computeBounds, parseGeometry, seatCornersGeo, summaryParts, toPt, MAX_GHOST_SEATS,
} from './geometry-preview'

const geoPreview = {
  geometry: {
    mode: 'geo',
    added: [
      { tempId: 't1', label: 'A1', at: { lat: 35.0, lng: 24.0, rotation: 10 }, parcel: 3 },
      { tempId: 't2', at: { lat: 35.0001, lng: 24.0001, rotation: 0 } },
      { tempId: 'bad', at: { rotation: 0 } }, // no coordinates -> dropped from the model
    ],
    moved: [{ id: 'i1', label: 'B2', before: { lat: 35.0, lng: 24.0, rotation: 0 }, after: { lat: 35.0002, lng: 24.0003, rotation: 90 } }],
    removed: [{ id: 'i2', label: 'C3' }, { id: 'gone', label: 'D4' }],
    parcels: [{ number: 3, footprint: [{ lat: 34.9, lng: 23.9 }, { lat: 35.1, lng: 23.9 }, { lat: 35.1, lng: 24.1 }, { lat: 34.9, lng: 24.1 }] }],
  },
}

describe('parseGeometry', () => {
  it('returns null without a valid mode or when nothing is drawable', () => {
    expect(parseGeometry(undefined)).toBeNull()
    expect(parseGeometry({ geometry: { mode: 'nope', added: [{ at: {} }] } })).toBeNull()
    expect(parseGeometry({ geometry: { mode: 'geo', added: [], moved: [], removed: [] } })).toBeNull()
  })
  it('tolerates junk fields instead of throwing', () => {
    const g = parseGeometry({ geometry: { mode: 'schematic', added: [null, 5, { at: { x: '2', y: 3 } }], parcels: [{ footprint: [] }] } })
    expect(g?.added).toHaveLength(1)
    expect(g?.added[0]?.at).toEqual({ y: 3 }) // string x rejected, never coerced
    expect(g?.parcels).toEqual([]) // parcel without a number dropped
  })
})

describe('toPt', () => {
  it('maps geo to x=lng,y=lat and schematic to x,y; null if the mode coordinates are missing', () => {
    expect(toPt('geo', { lat: 1, lng: 2 })).toEqual({ x: 2, y: 1 })
    expect(toPt('schematic', { x: 5, y: 6 })).toEqual({ x: 5, y: 6 })
    expect(toPt('geo', { x: 5, y: 6 })).toBeNull()
    expect(toPt('schematic', { lat: 1, lng: 2 })).toBeNull()
  })
})

describe('buildGhostModel', () => {
  const geo = parseGeometry(geoPreview)!
  const lookup = (id: string) => (id === 'i2' ? { at: { x: 24.0005, y: 35.0005 }, rotation: 45 } : undefined)
  const m = buildGhostModel(geo, lookup)

  it('creates one ghost per drawable added seat, keeping rotation', () => {
    const added = m.seats.filter((s) => s.kind === 'added')
    expect(added).toHaveLength(2)
    expect(added[0]).toMatchObject({ at: { x: 24.0, y: 35.0 }, rotation: 10, parcel: 3, label: 'A1' })
  })
  it('moved seats get an after ghost, a before ghost and a connector', () => {
    expect(m.seats.find((s) => s.kind === 'moved')).toMatchObject({ at: { x: 24.0003, y: 35.0002 }, rotation: 90, itemId: 'i1' })
    expect(m.seats.find((s) => s.kind === 'moved-from')?.at).toEqual({ x: 24.0, y: 35.0 })
    expect(m.links).toEqual([{ key: 'l:i1', from: { x: 24.0, y: 35.0 }, to: { x: 24.0003, y: 35.0002 } }])
  })
  it('removed seats resolve through the lookup; unloaded ones are skipped but still counted', () => {
    expect(m.seats.filter((s) => s.kind === 'removed').map((s) => s.itemId)).toEqual(['i2'])
    expect(m.counts).toEqual({ added: 3, moved: 1, removed: 2 })
  })
  it('keeps parcel footprints (they are what shows at overview zoom)', () => {
    expect(m.parcels).toHaveLength(1)
    expect(m.parcels[0]!.points).toHaveLength(4)
  })
  it('bounds cover seats, removed and footprints', () => {
    expect(m.bounds).toEqual({ minX: 23.9, maxX: 24.1, minY: 34.9, maxY: 35.1 })
  })
  it('caps the seat count', () => {
    const many = { mode: 'geo' as const, moved: [], removed: [], parcels: [], added: Array.from({ length: MAX_GHOST_SEATS + 50 }, (_, i) => ({ tempId: `t${i}`, at: { lat: 1, lng: 1, rotation: 0 } })) }
    expect(buildGhostModel(many).seats).toHaveLength(MAX_GHOST_SEATS)
  })
  it('schematic mode uses x/y', () => {
    const s = parseGeometry({ geometry: { mode: 'schematic', added: [{ tempId: 'a', at: { x: 3, y: 4, rotation: 5 } }], moved: [], removed: [] } })!
    const sm = buildGhostModel(s)
    expect(sm.seats[0]).toMatchObject({ at: { x: 3, y: 4 }, rotation: 5 })
    expect(sm.bounds).toEqual({ minX: 3, maxX: 3, minY: 4, maxY: 4 })
  })
})

describe('computeBounds', () => {
  it('is null for no points', () => expect(computeBounds([])).toBeNull())
  it('spans all points', () => {
    expect(computeBounds([{ x: 1, y: 5 }, { x: -2, y: 3 }])).toEqual({ minX: -2, maxX: 1, minY: 3, maxY: 5 })
  })
})

describe('seatCornersGeo', () => {
  const center = { x: 24, y: 35 }
  it('is a ~0.84 x 2.1 m rectangle: unrotated, long side runs north-south', () => {
    const c = seatCornersGeo(center, 0)
    const lats = c.map((p) => p.lat)
    const dLatM = (Math.max(...lats) - Math.min(...lats)) * 111320
    expect(dLatM).toBeCloseTo(2.1, 2)
  })
  it('rotating 90 degrees swaps the long side to east-west', () => {
    const c = seatCornersGeo(center, 90)
    const lngs = c.map((p) => p.lng)
    const dLngM = (Math.max(...lngs) - Math.min(...lngs)) * 111320 * Math.cos((35 * Math.PI) / 180)
    expect(dLngM).toBeCloseTo(2.1, 2)
  })
  it('is centred on the point', () => {
    const c = seatCornersGeo(center, 33)
    expect(c.reduce((s, p) => s + p.lat, 0) / 4).toBeCloseTo(35, 9)
    expect(c.reduce((s, p) => s + p.lng, 0) / 4).toBeCloseTo(24, 9)
  })
})

describe('summaryParts', () => {
  it('omits zero counts', () => {
    expect(summaryParts({ added: 2, moved: 0, removed: 1 })).toEqual([{ key: 'added', n: 2 }, { key: 'removed', n: 1 }])
  })
})
