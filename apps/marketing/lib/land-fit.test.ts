import { describe, expect, it } from 'vitest'
import { generateBeachLayout } from './beach-layout.ts'
import { signedShoreDistance, trimShore } from './coastline.ts'
import { keepOnLand, parcelGround, shoreBand, type Frame } from './land-fit.ts'

const M = 111_320
const at = { lat: 39.8, lng: 3.1 }
const mLng = M * Math.cos((at.lat * Math.PI) / 180)
const off = (e: number, n: number) => ({ lat: at.lat + n / M, lng: at.lng + e / mLng })
// A straight shore running north, 30 m east of `at`: water on the right of travel = EAST.
const straight = [[off(30, -2000), off(30, 2000)]]
// A headland: the shore bends seaward-left, so a long parcel's north end meets water sooner.
const bent = [[off(30, -2000), off(30, 0), off(-10, 60)]]

const minDistance = (frame: Frame, count: number, ways: typeof straight) =>
  Math.min(...generateBeachLayout({ ...frame, sunbedCount: count }).sunbeds.map((b) => signedShoreDistance(ways, b)!))

describe('signedShoreDistance — land positive, sea negative', () => {
  it('reads both sides of a north-running shore (water on the right = east)', () => {
    expect(signedShoreDistance(straight, off(0, 0))).toBeCloseTo(30, 0)
    expect(signedShoreDistance(straight, off(50, 0))).toBeCloseTo(-20, 0)
  })
  it('is null with no geometry', () => {
    expect(signedShoreDistance([], at)).toBeNull()
  })
})

describe('keepOnLand — every bed ends up on the sand', () => {
  it('leaves a parcel that is already on land where it is', () => {
    const f: Frame = { anchor: off(-40, 0), seaBearingDeg: 90, placement: 'center' }
    expect(keepOnLand(f, 40, straight, { shoreSeaBearingDeg: 90 })).toEqual(f)
  })

  it('slides a parcel moved into the sea back inland, perpendicular to the shore', () => {
    const f: Frame = { anchor: off(35, 0), seaBearingDeg: 90, placement: 'center' }
    expect(minDistance(f, 60, straight)).toBeLessThan(0) // really in the sea to begin with
    const fixed = keepOnLand(f, 60, straight, { shoreSeaBearingDeg: 90 })
    expect(minDistance(fixed, 60, straight)).toBeGreaterThanOrEqual(3.9)
    expect(fixed.anchor.lat).toBeCloseTo(f.anchor.lat, 6) // moved west only, not along the shore
  })

  it('a parcel turned the wrong way still lands on the sand (pushed by the SHORE, not the beds)', () => {
    const f: Frame = { anchor: off(10, 0), seaBearingDeg: 0, placement: 'center' } // turned 90° off
    expect(minDistance(f, 120, straight)).toBeLessThan(0)
    const fixed = keepOnLand(f, 120, straight, { shoreSeaBearingDeg: 90 })
    expect(minDistance(fixed, 120, straight)).toBeGreaterThanOrEqual(3.9)
    expect(fixed.seaBearingDeg).toBe(0) // the visitor's turn is kept
  })

  it('a long parcel on a curving shore clears the bend too', () => {
    const f: Frame = { anchor: off(30, 0), seaBearingDeg: 90, placement: 'waterline' }
    expect(minDistance(f, 200, bent)).toBeLessThan(0)
    const fixed = keepOnLand(f, 200, bent, { shoreSeaBearingDeg: 90 })
    expect(minDistance(fixed, 200, bent)).toBeGreaterThanOrEqual(3.9)
  })
})

describe('trimShore — only the nearby coast goes to the page', () => {
  it('keeps segments near the beach and drops the far coast', () => {
    const trimmed = trimShore(straight.map((w) => [w[0]!, off(30, -100), off(30, 100), w[1]!]), at, 300)
    expect(trimmed.length).toBe(1)
    expect(trimmed[0]!.length).toBeGreaterThanOrEqual(2)
    expect(trimShore([[off(5000, 0), off(5000, 100)]], at, 300)).toEqual([])
  })
})

describe('parcelGround — the sand pad under the beds', () => {
  it('covers every bed with a margin', () => {
    const f: Frame = { anchor: off(-20, 0), seaBearingDeg: 90, placement: 'center' }
    const beds = generateBeachLayout({ ...f, sunbedCount: 60 }).sunbeds
    const ground = parcelGround(beds, f)
    expect(ground).toHaveLength(4)
    const lats = ground.map((p) => p.lat), lngs = ground.map((p) => p.lng)
    for (const b of beds) {
      expect(b.lat).toBeGreaterThan(Math.min(...lats)); expect(b.lat).toBeLessThan(Math.max(...lats))
      expect(b.lng).toBeGreaterThan(Math.min(...lngs)); expect(b.lng).toBeLessThan(Math.max(...lngs))
    }
  })
  it('is empty with no beds', () => {
    expect(parcelGround([], { anchor: at, seaBearingDeg: 90, placement: 'center' })).toEqual([])
  })
})

describe('shoreBand — a strip of sand along the coast, on the land side', () => {
  it('runs from the waterline to widthM inland, never into the sea', () => {
    const [band] = shoreBand([[off(30, -100), off(30, 0), off(30, 100)]], 15)
    const ds = band!.map((p) => signedShoreDistance(straight, p)!)
    expect(Math.min(...ds)).toBeGreaterThan(-0.5)
    expect(Math.max(...ds)).toBeCloseTo(15, 0)
  })
  it('follows a bend instead of cutting across it', () => {
    const [band] = shoreBand(bent, 10)
    for (const p of band!.slice(bent[0]!.length)) expect(signedShoreDistance(bent, p)!).toBeGreaterThan(5)
  })
})
