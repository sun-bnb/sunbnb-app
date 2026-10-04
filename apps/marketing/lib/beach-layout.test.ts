import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT, generateBeachLayout, type MockSunbed } from './beach-layout.ts'

const anchor = { lat: 39.795, lng: 3.12 } // Platja de Muro

/** Metres between two points (haversine) — independent of the generator's own projection. */
function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Signed metres of `p` from the anchor along a compass bearing. */
function along(p: { lat: number; lng: number }, bearingDeg: number): number {
  const b = (bearingDeg * Math.PI) / 180
  const north = (p.lat - anchor.lat) * 111_320
  const east = (p.lng - anchor.lng) * 111_320 * Math.cos((anchor.lat * Math.PI) / 180)
  return east * Math.sin(b) + north * Math.cos(b)
}

describe('generateBeachLayout', () => {
  it.each([1, 2, 7, 120, 121, 500, 5000])('places exactly %i sunbeds', (n) => {
    expect(generateBeachLayout({ anchor, seaBearingDeg: 180, sunbedCount: n }).sunbeds).toHaveLength(n)
  })

  it('is deterministic — a shared mockup link re-renders the same beach', () => {
    const a = generateBeachLayout({ anchor, seaBearingDeg: 135, sunbedCount: 120 })
    const b = generateBeachLayout({ anchor, seaBearingDeg: 135, sunbedCount: 120 })
    expect(a).toEqual(b)
  })

  it('gives every sunbed a unique label', () => {
    const { sunbeds } = generateBeachLayout({ anchor, seaBearingDeg: 180, sunbedCount: 500 })
    expect(new Set(sunbeds.map((s) => s.label)).size).toBe(500)
  })

  it('pairs beds under one umbrella; an odd count leaves the last pair single', () => {
    const { sunbeds, umbrellas } = generateBeachLayout({ anchor, seaBearingDeg: 180, sunbedCount: 7 })
    expect(umbrellas).toHaveLength(4)
    const last = sunbeds.filter((s) => s.row === sunbeds.at(-1)!.row && s.pair === sunbeds.at(-1)!.pair)
    expect(last).toHaveLength(1)
  })

  it('keeps beds physically apart: no two sunbed centres closer than a bed width', () => {
    const { sunbeds } = generateBeachLayout({ anchor, seaBearingDeg: 200, sunbedCount: 120 })
    let min = Infinity
    for (let i = 0; i < sunbeds.length; i++) {
      for (let j = i + 1; j < sunbeds.length; j++) min = Math.min(min, distM(sunbeds[i]!, sunbeds[j]!))
    }
    expect(min).toBeGreaterThanOrEqual(DEFAULT_LAYOUT.bedWidthM)
  })

  it.each([0, 90, 180, 247])('puts row A nearest the sea when the sea is at %i°', (sea) => {
    const { sunbeds } = generateBeachLayout({ anchor, seaBearingDeg: sea, sunbedCount: 120 })
    const meanSeaward = (row: number) => {
      const r = sunbeds.filter((s) => s.row === row)
      return r.reduce((acc, s) => acc + along(s, sea), 0) / r.length
    }
    expect(meanSeaward(0)).toBeGreaterThan(meanSeaward(1))
    // and every bed points its feet at the sea
    expect(new Set(sunbeds.map((s) => s.rotationDeg))).toEqual(new Set([sea % 360]))
  })

  it('runs rows parallel to the shore: a row has (near) constant distance to the sea', () => {
    const { sunbeds } = generateBeachLayout({ anchor, seaBearingDeg: 120, sunbedCount: 120 })
    const rowA = sunbeds.filter((s) => s.row === 0).map((s) => along(s, 120))
    expect(Math.max(...rowA) - Math.min(...rowA)).toBeLessThan(0.01)
  })

  it('centres the block on the anchor (the place Google returned)', () => {
    const { sunbeds } = generateBeachLayout({ anchor, seaBearingDeg: 180, sunbedCount: 120 })
    const c = {
      lat: sunbeds.reduce((a, s) => a + s.lat, 0) / sunbeds.length,
      lng: sunbeds.reduce((a, s) => a + s.lng, 0) / sunbeds.length,
    }
    expect(distM(c, anchor)).toBeLessThan(2)
  })

  it('keeps a beach shape — long along the shore, few rows deep', () => {
    const small = generateBeachLayout({ anchor, seaBearingDeg: 180, sunbedCount: 20 })
    expect(small.rows).toBe(1)
    const typical = generateBeachLayout({ anchor, seaBearingDeg: 180, sunbedCount: 120 })
    expect(typical.rows).toBe(5)
    const huge = generateBeachLayout({ anchor, seaBearingDeg: 180, sunbedCount: 5000 })
    expect(huge.rows).toBe(DEFAULT_LAYOUT.maxRows)
  })

  it('opens a cross-walkway between blocks of pairs', () => {
    const { sunbeds } = generateBeachLayout({ anchor, seaBearingDeg: 180, sunbedCount: 40 })
    const rowA = sunbeds.filter((s) => s.row === 0 && s.side === 0).sort((a, b) => a.pair - b.pair) as MockSunbed[]
    const gap = (i: number) => distM(rowA[i]!, rowA[i + 1]!)
    const normal = gap(0)
    const acrossWalkway = gap(DEFAULT_LAYOUT.pairsPerBlock - 1)
    expect(acrossWalkway - normal).toBeCloseTo(DEFAULT_LAYOUT.walkwayM, 1)
  })

  it('labels the front row A and numbers along the row', () => {
    const { sunbeds } = generateBeachLayout({ anchor, seaBearingDeg: 180, sunbedCount: 30 })
    expect(sunbeds[0]!.label).toBe('A1')
    expect(sunbeds.filter((s) => s.row === 1)[0]!.label).toBe('B1')
  })

  it('waterline placement: the whole block sits inland, row A a fixed gap behind the waterline', () => {
    const sea = 45
    const { sunbeds } = generateBeachLayout({ anchor, seaBearingDeg: sea, sunbedCount: 120, placement: 'waterline' })
    const seaward = sunbeds.map((s) => along(s, sea))
    expect(Math.max(...seaward)).toBeCloseTo(-DEFAULT_LAYOUT.waterlineGapM, 1) // row A
    expect(seaward.every((d) => d < 0)).toBe(true) // nothing in the water
  })

  it('rejects a non-positive or fractional count', () => {
    expect(() => generateBeachLayout({ anchor, seaBearingDeg: 0, sunbedCount: 0 })).toThrow()
    expect(() => generateBeachLayout({ anchor, seaBearingDeg: 0, sunbedCount: 2.5 })).toThrow()
  })
})
