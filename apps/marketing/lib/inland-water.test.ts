import { describe, expect, it } from 'vitest'
import { nearestShoreFrame, type GeoPoint } from './coastline.ts'
import { isBathingWater, polygonAreaM2, shoreLines } from './inland-water.ts'

// A 100 m × 100 m lake at Wörthersee's latitude, wound as a shapefile stores it: outer ring
// CLOCKWISE (x = lng, y = lat).
const lat0 = 46.62
const lng0 = 14.15
const dLat = 100 / 111_320
const dLng = 100 / (111_320 * Math.cos((lat0 * Math.PI) / 180))
const lake: [number, number][] = [[lng0, lat0], [lng0, lat0 + dLat], [lng0 + dLng, lat0 + dLat], [lng0 + dLng, lat0], [lng0, lat0]]
// A 20 m island inside it, counter-clockwise (a hole).
const iLat = 20 / 111_320, iLng = 20 / (111_320 * Math.cos((lat0 * Math.PI) / 180))
const c = { lng: lng0 + dLng / 2, lat: lat0 + dLat / 2 }
const island: [number, number][] = [[c.lng, c.lat], [c.lng + iLng, c.lat], [c.lng + iLng, c.lat + iLat], [c.lng, c.lat + iLat], [c.lng, c.lat]]

const parse = (wkt: string): GeoPoint[] => wkt.slice('LINESTRING('.length, -1).split(',').map((p) => { const [x, y] = p.split(' ').map(Number); return { lng: x!, lat: y! } })

describe('polygonAreaM2', () => {
  it('measures the water: outer ring minus islands', () => {
    expect(polygonAreaM2([lake])).toBeCloseTo(10_000, -2)
    expect(polygonAreaM2([lake, island])).toBeCloseTo(10_000 - 400, -2)
  })
})

describe('isBathingWater', () => {
  it('keeps lakes, reservoirs and rivers big enough for a beach', () => {
    expect(isBathingWater('water', [lake])).toBe(true)
    expect(isBathingWater('riverbank', [lake])).toBe(true) // how Geofabrik files the Danube
    expect(isBathingWater('reservoir', [lake])).toBe(true)
  })
  it('drops canals and streams — big by area, but metres wide (the Lendkanal case)', () => {
    const w = 12 / (111_320 * Math.cos((lat0 * Math.PI) / 180))
    const len = 3000 / 111_320
    const canal: [number, number][] = [[lng0, lat0], [lng0, lat0 + len], [lng0 + w, lat0 + len], [lng0 + w, lat0], [lng0, lat0]]
    expect(polygonAreaM2([canal])).toBeGreaterThan(30_000)
    expect(isBathingWater('water', [canal])).toBe(false)
  })
  it('keeps a 100 m-wide river', () => {
    const w = 100 / (111_320 * Math.cos((lat0 * Math.PI) / 180))
    const len = 3000 / 111_320
    expect(isBathingWater('riverbank', [[[lng0, lat0], [lng0, lat0 + len], [lng0 + w, lat0 + len], [lng0 + w, lat0], [lng0, lat0]]])).toBe(true)
  })
  it('drops wetland, glaciers, docks and ponds', () => {
    for (const f of ['wetland', 'wetland_reedbed', 'glacier', 'dock']) expect(isBathingWater(f, [lake])).toBe(false)
    expect(isBathingWater('water', [island])).toBe(false) // 400 m², and a hole on its own
  })
})

describe('shoreLines', () => {
  it('a beach on the west shore looks EAST into the lake', () => {
    const ways = shoreLines([lake]).map(parse)
    const beach = { lat: lat0 + dLat / 2, lng: lng0 - 15 / (111_320 * Math.cos((lat0 * Math.PI) / 180)) }
    expect(nearestShoreFrame(ways, beach)!.seaBearingDeg).toBe(90)
  })
  it('a beach on the south shore looks NORTH into the lake', () => {
    const ways = shoreLines([lake]).map(parse)
    expect(nearestShoreFrame(ways, { lat: lat0 - 10 / 111_320, lng: lng0 + dLng / 2 })!.seaBearingDeg).toBe(0)
  })
  it("an island's beach looks out from the island, into the lake", () => {
    const ways = shoreLines([island]).map(parse)
    // On the island's east half, just inside its east edge → the water is to the east.
    const onIsland = { lat: c.lat + iLat / 2, lng: c.lng + iLng * 0.9 }
    expect(nearestShoreFrame(ways, onIsland)!.seaBearingDeg).toBe(90)
  })
  it('splits long rings into joined pieces', () => {
    const ring: [number, number][] = Array.from({ length: 450 }, (_, i) => [lng0 + Math.cos(i / 70) * 0.01, lat0 + Math.sin(-i / 70) * 0.01])
    ring.push(ring[0]!)
    const pieces = shoreLines([ring], 200).map(parse)
    expect(pieces.length).toBe(3)
    expect(pieces.every((p) => p.length <= 200)).toBe(true)
    expect(pieces[1]![0]).toEqual(pieces[0]![pieces[0]!.length - 1])
    expect(pieces.reduce((s, p) => s + p.length - 1, 0)).toBe(ring.length - 1)
  })
})
