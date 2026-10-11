/**
 * Parcel position + two-parcel measurement. Expected numbers are worked out by hand from the one fact the
 * editor fixes: a sunbed footprint is 2.1 m, so a 1x1 parcel is a 2.1 m square around its anchor.
 */
import { describe, it, expect } from 'vitest'
import { measureParcels, polygonGap, positionFacts, parcelShape } from './parcel-geometry'

const base = { rows: 1, seatsPerRow: 1, horizontalGap: 1, verticalGap: 1.5, pairGap: 0, rotation: 0 }
const sch = (x: number, y: number, over = {}) => ({ ...base, locationLat: null, locationLng: null, schematicX: x, schematicY: y, ...over })
const geo = (lat: number, lng: number, over = {}) => ({ ...base, locationLat: String(lat), locationLng: String(lng), schematicX: null, schematicY: null, ...over })
const mPerDegLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180)

describe('positionFacts', () => {
  it('schematic: centre is the anchor for a 1x1 parcel, 2.1 m square, 4 corners 1.05 m out, rounded to 0.1 m', () => {
    const f = positionFacts(sch(10, 20), 'schematic')!
    expect(f.anchor).toEqual({ x: 10, y: 20 })
    expect(f.centre).toEqual({ x: 10, y: 20 })
    expect(f.sizeM).toEqual({ alongRows: 2.1, acrossRows: 2.1 })
    const xs = f.corners.map((c) => (c as { x: number }).x).sort((a, b) => a - b)
    expect(xs).toEqual([9, 9, 11.1, 11.1]) // 10 -/+ 1.05 -> 8.95 / 11.05 at 0.1 m
  })

  it('map: lat/lng rounded to 6 decimals; 1.05 m north is 1.05/111320 deg', () => {
    const f = positionFacts(geo(36.5, -4.9), 'geo')!
    expect(f.centre).toEqual({ lat: 36.5, lng: -4.9 })
    const lats = f.corners.map((c) => (c as { lat: number }).lat)
    expect(Math.max(...lats)).toBeCloseTo(36.5 + 1.05 / 111320, 6)
  })

  it('compact form drops anchor and corners', () => {
    expect(Object.keys(positionFacts(sch(0, 0), 'schematic', true)!).sort()).toEqual(['centre', 'rowBearingDegrees', 'sizeM'])
  })

  it('a multi-seat row is longer along the rows than across them, and the row axis follows the rotation', () => {
    const wide = { seatsPerRow: 4 }
    const f0 = positionFacts(sch(0, 0, wide), 'schematic')!
    expect(f0.sizeM.alongRows).toBeGreaterThan(f0.sizeM.acrossRows)
    expect(f0.rowBearingDegrees).toBe(90) // east
    expect(positionFacts(sch(0, 0, { ...wide, rotation: 90 }), 'schematic')!.rowBearingDegrees).toBe(180) // clockwise: south
    expect(positionFacts(geo(0, 0, { ...wide, rotation: 90 }), 'geo')!.rowBearingDegrees).toBe(180)
  })

  it('a rotated 4-seat row is longer north-south at 90 degrees (map and schematic agree)', () => {
    for (const [mode, p] of [['schematic', sch(0, 0, { seatsPerRow: 4, rotation: 90 })], ['geo', geo(0, 0, { seatsPerRow: 4, rotation: 90 })]] as const) {
      const s = parcelShape(p, mode)!
      const ys = s.localCorners.map((c) => c.y)
      const xs = s.localCorners.map((c) => c.x)
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(Math.max(...xs) - Math.min(...xs))
    }
  })

  it('a legacy parcel without geometry has no position', () => {
    expect(positionFacts({ ...base, rows: null, seatsPerRow: null, locationLat: null, locationLng: null, schematicX: null, schematicY: null }, 'geo')).toBeNull()
    expect(positionFacts(sch(0, 0, { schematicX: null }), 'schematic')).toBeNull()
  })
})

describe('polygonGap', () => {
  const sq = (x: number, y: number, s = 2) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }]
  it('apart, touching, overlapping', () => {
    expect(polygonGap(sq(0, 0), sq(5, 0))).toBe(3)
    expect(polygonGap(sq(0, 0), sq(2, 0))).toBe(0)
    expect(polygonGap(sq(0, 0), sq(1, 0))).toBe(-1)
  })
  it('corner to corner is the diagonal distance, not the axis separation', () => {
    expect(polygonGap(sq(0, 0), sq(5, 6))).toBeCloseTo(Math.hypot(3, 4), 9)
  })
})

describe('measureParcels', () => {
  it('schematic: B 10 m east of A -> centre 10, edge gap 7.9, move A east 5.9 for a 2 m gap', () => {
    const m = measureParcels(sch(0, 0), sch(10, 0), 'schematic')
    expect(m).toMatchObject({ ok: true, centreDistanceM: 10, edgeGapM: 7.9, overlapping: false, centreBearingDegrees: 90, targetGapM: 2 })
    if (!m.ok) return
    expect(m.direction).toEqual({ dx: 1, dy: 0 })
    expect(m.by_m).toEqual({ dx: 5.9, dy: 0 })
    expect(m.resultingGapM).toBe(2)
  })

  it('schematic y grows down: B drawn above A is NORTH of it (dy positive)', () => {
    const m = measureParcels(sch(0, 0), sch(0, -10), 'schematic', 1)
    if (!m.ok) throw new Error('expected ok')
    expect(m.direction).toEqual({ dx: 0, dy: 1 })
    expect(m.by_m).toEqual({ dx: 0, dy: 6.9 })
    expect(m.centreBearingDegrees).toBe(0)
  })

  it('overlapping parcels: negative gap, and by_m moves AWAY to reach the target', () => {
    const m = measureParcels(sch(0, 0), sch(1, 0), 'schematic', 0)
    if (!m.ok) throw new Error('expected ok')
    expect(m.edgeGapM).toBe(-1.1)
    expect(m.overlapping).toBe(true)
    expect(m.by_m.dx).toBeCloseTo(-1.1, 5) // away from B (B is east), so west
    expect(m.resultingGapM).toBe(0)
  })

  it('rotated parcels: applying by_m really lands the polygons at the target gap', () => {
    const a = sch(0, 0, { rotation: 30, seatsPerRow: 3 })
    const b = sch(9, -6, { rotation: 75, rows: 2 })
    const m = measureParcels(a, b, 'schematic', 3)
    if (!m.ok) throw new Error('expected ok')
    const sa = parcelShape(a, 'schematic')!
    const sb = parcelShape(b, 'schematic')!
    const moved = sa.localCorners.map((c) => ({ x: c.x + m.by_m.dx, y: c.y + m.by_m.dy }))
    const bPoly = sb.localCorners.map((c) => ({ x: c.x + 9, y: c.y + 6 })) // schematic y down -> north-up
    expect(polygonGap(moved, bPoly)).toBeCloseTo(3, 1)
    expect(m.edgeGapM).toBeGreaterThan(0)
  })

  it('map: lng offset converts with cos(lat); 10 m east at 60N is 10/(111320*cos60) degrees', () => {
    const lat = 60
    const m = measureParcels(geo(lat, 10), geo(lat, 10 + 10 / mPerDegLng(lat)), 'geo')
    if (!m.ok) throw new Error('expected ok')
    expect(m.centreDistanceM).toBe(10)
    expect(m.by_m).toEqual({ dx: 5.9, dy: 0 })
    const north = measureParcels(geo(lat, 10), geo(lat + 10 / 111320, 10), 'geo')
    if (!north.ok) throw new Error('expected ok')
    expect(north.direction).toEqual({ dx: 0, dy: 1 })
  })

  it('target gap defaults to 2 m and can be 0', () => {
    const m = measureParcels(sch(0, 0), sch(10, 0), 'schematic', 0)
    if (!m.ok) throw new Error('expected ok')
    expect(m.by_m.dx).toBe(7.9)
  })

  it('refuses parcels without geometry and identical centres', () => {
    expect(measureParcels(sch(0, 0, { schematicX: null }), sch(1, 1), 'schematic')).toEqual({ ok: false, error: 'parcel_has_no_geometry' })
    expect(measureParcels(sch(0, 0), sch(0, 0), 'schematic')).toEqual({ ok: false, error: 'parcels_share_the_same_centre' })
  })
})
