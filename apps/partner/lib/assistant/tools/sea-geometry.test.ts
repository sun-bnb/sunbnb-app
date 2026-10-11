import { describe, it, expect } from 'vitest'
import type { GeoPoint } from '@repo/agent/geo/coastline'
import { elementPolygon, geoSeaModel, measureToSea, waterSeaModel, type SeaParcel } from './sea-geometry'

const M = 111320
const O: GeoPoint = { lat: 39.8335, lng: 3.1212 }
const perLng = M * Math.cos((O.lat * Math.PI) / 180)
const at = (xE: number, yN: number): GeoPoint => ({ lat: O.lat + yN / M, lng: O.lng + xE / perLng })

/** Axis-aligned parcel 4 m (east) x 2 m (north) with its centre at (cx, cy). Rows run east (bearing 90). */
const box = (group: number, cx: number, cy: number, w = 4, h = 2): SeaParcel => ({
  group,
  rowBearingDegrees: 90,
  corners: [{ x: cx - w / 2, y: cy + h / 2 }, { x: cx + w / 2, y: cy + h / 2 }, { x: cx + w / 2, y: cy - h / 2 }, { x: cx - w / 2, y: cy - h / 2 }],
})

// OSM: water on the RIGHT of the direction of travel.
const shoreEast = (xE: number) => [[at(xE, -500), at(xE, 500)]] // travelling north, sea to the east
const shoreSouth = (yN: number) => [[at(-500, yN), at(500, yN)]] // travelling east, sea to the south

const get = (m: ReturnType<typeof measureToSea>) => {
  if (!m.ok) throw new Error(m.reason)
  return m
}

describe('measureToSea, map shoreline', () => {
  it('shore to the east: bearing 90, distance from the NEAREST (east) edge, ready by_m points east', () => {
    const m = get(measureToSea([box(1, 0, 0)], geoSeaModel(shoreEast(52), [], O), 5))
    const r = m.parcels[0]!
    expect(r.seaBearingDegrees).toBe(90)
    expect(r.distanceToWaterM).toBeCloseTo(50, 0) // centre 52 m away, edge 2 m nearer
    expect(r.seaFacingEdge).toBe('row end')
    expect(r.rowsParallelToShore).toBe(false)
    expect(r.by_m!.dx).toBeCloseTo(45, 0)
    expect(r.by_m!.dy).toBeCloseTo(0, 1)
    expect(r.resultingDistanceM).toBeCloseTo(5, 0)
  })

  it('shore to the south: bearing 180, the last-row edge faces the water, rows run along the shore, by_m is due south', () => {
    const m = get(measureToSea([box(1, 0, 0)], geoSeaModel(shoreSouth(-31), [], O), 5))
    const r = m.parcels[0]!
    expect(r.seaBearingDegrees).toBe(180)
    expect(r.distanceToWaterM).toBeCloseTo(30, 0)
    expect(r.rowsParallelToShore).toBe(true)
    expect(r.seaFacingEdge).toBe('last row')
    expect(r.by_m!.dx).toBeCloseTo(0, 1)
    expect(r.by_m!.dy).toBeCloseTo(-25, 0)
  })

  it('a rotated parcel measures from its true nearest corner, not its centre line', () => {
    // 45 degrees: corners at +-(w+h)/2 / sqrt2 on the diagonal
    const s = Math.SQRT1_2
    const rot: SeaParcel = { group: 1, rowBearingDegrees: 45, corners: [{ x: -2 * s + 1 * s, y: 2 * s + 1 * s }, { x: 2 * s + 1 * s, y: -2 * s + 1 * s }, { x: 2 * s - 1 * s, y: -2 * s - 1 * s }, { x: -2 * s - 1 * s, y: 2 * s - 1 * s }] }
    const furthestEast = Math.max(...rot.corners.map((c) => c.x))
    const r = get(measureToSea([rot], geoSeaModel(shoreEast(40), [], O))).parcels[0]!
    expect(r.distanceToWaterM).toBeCloseTo(40 - furthestEast, 0)
  })

  it('a parcel partly in the water reports a negative distance and a by_m that backs it out to the target', () => {
    const m = get(measureToSea([box(1, 0, 0)], geoSeaModel(shoreEast(1), [], O), 5))
    const r = m.parcels[0]!
    expect(r.inWater).toBe(true)
    expect(r.distanceToWaterM).toBeLessThan(0)
    expect(r.by_m!.dx).toBeLessThan(0) // moves AWAY from the sea
    expect(r.resultingDistanceM).toBeCloseTo(5, 0)
  })

  it('several parcels: one shared by_m set by the closest parcel, every gap kept', () => {
    const near = box(4, 0, 0)
    const far = box(5, -10, 0)
    const m = get(measureToSea([far, near], geoSeaModel(shoreEast(52), [], O), 5))
    expect(m.shared!.basedOnParcel).toBe(4)
    expect(m.shared!.by_m.dx).toBeCloseTo(45, 0)
    expect(m.shared!.resultingDistancesM[4]).toBeCloseTo(5, 0)
    expect(m.shared!.resultingDistancesM[5]).toBeCloseTo(15, 0) // the 10 m gap is preserved
  })

  it('no shore geometry is a reason, not a guess', () => {
    expect(measureToSea([box(1, 0, 0)], geoSeaModel([], [], O), 5)).toEqual({ ok: false, reason: 'no_shore_found' })
  })

  it('without a target it only measures (no by_m, no shared)', () => {
    const m = get(measureToSea([box(1, 0, 0), box(2, 0, 10)], geoSeaModel(shoreEast(52), [], O)))
    expect(m.shared).toBeUndefined()
    expect(m.parcels[0]!.by_m).toBeUndefined()
  })
})

describe('measureToSea, schematic water', () => {
  // Water 40 x 10 m along the bottom of the canvas (schematic y grows DOWN): x 0..40, y 30..40 => north-up y -40..-30.
  const water = elementPolygon({ x: 0, y: 30, width: 40, height: 10, rotation: 0 })

  it('element polygon is north-up (y flipped)', () => {
    expect(Math.max(...water.map((p) => p.y))).toBeCloseTo(-30)
    expect(Math.min(...water.map((p) => p.y))).toBeCloseTo(-40)
  })

  it('water below the parcel: bearing 180, distance to the water edge, by_m due south', () => {
    const r = get(measureToSea([box(1, 20, -10)], waterSeaModel([water]), 5)).parcels[0]!
    expect(r.seaBearingDegrees).toBe(180)
    expect(r.distanceToWaterM).toBeCloseTo(19, 1) // bed bottom at y=-11, water top at -30
    expect(r.by_m!.dy).toBeCloseTo(-14, 1)
    expect(r.by_m!.dx).toBeCloseTo(0, 1)
    expect(r.resultingDistanceM).toBeCloseTo(5, 1)
  })

  it('a rotated water element (90 degrees) is measured through its rotated outline', () => {
    // 10 wide x 40 tall box standing at the east side, then turned 90: becomes 40 wide x 10 tall
    const rotated = elementPolygon({ x: 15, y: 15, width: 10, height: 40, rotation: 90 }) // centre (20,35) -> spans x 0..40, y 30..40
    const r = get(measureToSea([box(1, 20, -10)], waterSeaModel([rotated]))).parcels[0]!
    expect(r.distanceToWaterM).toBeCloseTo(19, 1)
  })

  it('no water element = no model, the tool layer reports it', () => {
    expect(measureToSea([box(1, 0, 0)], waterSeaModel([]))).toEqual({ ok: false, reason: 'no_shore_found' })
  })
})
