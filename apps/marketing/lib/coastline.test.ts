import { describe, expect, it } from 'vitest'
import { nearestShoreFrame, type GeoPoint } from './coastline.ts'

const origin = { lat: 39.8, lng: 3.12 }
const M_LAT = 111_320
const mLng = M_LAT * Math.cos((origin.lat * Math.PI) / 180)
/** A point `east`/`north` metres from the origin. */
const at = (east: number, north: number): GeoPoint => ({ lat: origin.lat + north / M_LAT, lng: origin.lng + east / mLng })

describe('nearestShoreFrame — OSM coastlines keep the water on the RIGHT', () => {
  it('coastline running north, 50 m east of the beach → sea is east (90°)', () => {
    const f = nearestShoreFrame([[at(50, -200), at(50, 200)]], origin)!
    expect(f.seaBearingDeg).toBe(90)
    expect(f.distanceM).toBeCloseTo(50, 0)
    expect(f.waterline.lng).toBeCloseTo(at(50, 0).lng, 6)
  })

  it('the same line drawn the other way means the sea is on the other side (270°)', () => {
    expect(nearestShoreFrame([[at(50, 200), at(50, -200)]], origin)!.seaBearingDeg).toBe(270)
  })

  it('coastline running east, south of the beach → sea is south (180°)', () => {
    expect(nearestShoreFrame([[at(-300, -40), at(300, -40)]], origin)!.seaBearingDeg).toBe(180)
  })

  it('picks the NEAREST segment across ways (a bay with two shores)', () => {
    // A spit: sea 500 m to the west AND 80 m to the east; the beach faces the nearer one.
    const far = [at(-500, 300), at(-500, -300)] // runs south → water on its west
    const near = [at(80, -300), at(80, 300)] // runs north → water on its east
    const f = nearestShoreFrame([far, near], origin)!
    expect(f.distanceM).toBeCloseTo(80, 0)
    expect(f.seaBearingDeg).toBe(90)
  })

  it('handles a diagonal shore (Platja de Muro runs NW–SE with the sea to the NE)', () => {
    // Travelling north-west with water on the right → sea to the north-east (45°).
    const f = nearestShoreFrame([[at(200, -100), at(-100, 200)]], origin)!
    expect(f.seaBearingDeg).toBe(45)
  })

  it('returns null with no usable geometry', () => {
    expect(nearestShoreFrame([], origin)).toBeNull()
    expect(nearestShoreFrame([[at(1, 1)]], origin)).toBeNull()
    expect(nearestShoreFrame([[at(1, 1), at(1, 1)]], origin)).toBeNull()
  })
})
