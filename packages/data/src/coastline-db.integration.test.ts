import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { disconnectDatabase } from './test/setup'
import { clearImportedRegion, clearInlandRegion, coastlineNear, inlandShoreNear, insertInlandShores, insertInlandWater, insertImportedLines, insertImportedWater, markImportedTiles, storeCoastTile, uncoveredCoastTiles, waterNear } from './coastline-db'

const M = 111_320
const at = { lat: 39.85, lng: 3.15 }
const off = (e: number, n: number) => ({ lat: at.lat + n / M, lng: at.lng + e / (M * Math.cos((at.lat * Math.PI) / 180)) })

describe('coastline cache', () => {
  // Its own database (COASTLINE_POSTGRES_URL → coastline_test, set in test/setup.ts).
  beforeEach(async () => {
    const c = new Client({ connectionString: process.env.COASTLINE_POSTGRES_URL })
    await c.connect()
    if ((await c.query('SELECT current_database() db')).rows[0].db !== 'coastline_test') throw new Error('refusing to truncate a non-test coastline database')
    await c.query('TRUNCATE coast_line, coast_water, coast_tile, inland_water, inland_shore')
    await c.end()
  })
  afterAll(disconnectDatabase)

  it('a tile is uncovered until stored — including an empty, coast-less tile', async () => {
    expect(await uncoveredCoastTiles(['398:31', '398:32'])).toEqual(['398:31', '398:32'])
    await storeCoastTile('398:32', [])
    expect(await uncoveredCoastTiles(['398:31', '398:32'])).toEqual(['398:31'])
  })

  it('returns the ways within the radius, in OSM order (water stays on the right)', async () => {
    const near = { id: 1001, points: [off(30, -200), off(30, 0), off(30, 200)] }
    const far = { id: 1002, points: [off(3000, -200), off(3000, 200)] }
    await storeCoastTile('398:31', [near, far])
    const got = await coastlineNear(at.lat, at.lng, 500)
    expect(got.map((w) => w.id)).toEqual([1001])
    expect(got[0]!.points[0]!.lat).toBeCloseTo(near.points[0]!.lat, 6)
    expect(got[0]!.points[2]!.lat).toBeCloseTo(near.points[2]!.lat, 6)
  })

  it('a way shared by two tiles is stored once, and storing is idempotent', async () => {
    const shared = { id: 2001, points: [off(30, -200), off(30, 200)] }
    await storeCoastTile('398:31', [shared])
    await storeCoastTile('398:30', [shared])
    await storeCoastTile('398:31', [shared])
    expect(await coastlineNear(at.lat, at.lng, 500)).toHaveLength(1)
  })

  it('ignores degenerate ways', async () => {
    await storeCoastTile('398:31', [{ id: 3001, points: [off(30, 0)] }])
    expect(await coastlineNear(at.lat, at.lng, 500)).toEqual([])
  })

  it('an imported region: lines + water, tiles covered, re-import replaces the old data', async () => {
    const w = (e: number, n: number) => { const p = off(e, n); return `${p.lng} ${p.lat}` }
    // Shore running north 30 m east of the beach; the sea is the square east of it.
    const line = `LINESTRING(${w(30, -300)},${w(30, 300)})`
    const sea = `MULTIPOLYGON(((${w(30, -300)},${w(30, 300)},${w(600, 300)},${w(600, -300)},${w(30, -300)})))`
    await insertImportedLines([{ id: 7, wkt: line }])
    await insertImportedWater([{ id: 7, wkt: sea }])
    await markImportedTiles(['398:31'])
    expect(await uncoveredCoastTiles(['398:31'])).toEqual([])
    const lines = await coastlineNear(at.lat, at.lng, 500)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.id).toBe(-7) // imported ids are negative
    const rings = await waterNear(at.lat, at.lng, 500)
    expect(rings.length).toBeGreaterThan(0)
    // clipped to the 500 m square around the beach
    for (const r of rings) for (const p of r) expect(Math.abs(p.lat - at.lat)).toBeLessThan(500 / M + 1e-6)

    await clearImportedRegion({ south: 39.8, west: 3.1, north: 39.9, east: 3.2 })
    expect(await coastlineNear(at.lat, at.lng, 500)).toEqual([])
    expect(await waterNear(at.lat, at.lng, 500)).toEqual([])
  })

  it('clearing an imported region leaves Overpass-fetched ways alone', async () => {
    await storeCoastTile('398:31', [{ id: 4242, points: [off(30, -200), off(30, 200)] }])
    await clearImportedRegion({ south: 39.8, west: 3.1, north: 39.9, east: 3.2 })
    expect((await coastlineNear(at.lat, at.lng, 500)).map((w) => w.id)).toEqual([4242])
  })

  it('a self-intersecting water ring is repaired, not rejected', async () => {
    const w = (e: number, n: number) => { const p = off(e, n); return `${p.lng} ${p.lat}` }
    const bowtie = `MULTIPOLYGON(((${w(40, -100)},${w(400, 100)},${w(400, -100)},${w(40, 100)},${w(40, -100)})))`
    await insertImportedWater([{ id: 9, wkt: bowtie }])
    expect((await waterNear(at.lat, at.lng, 500)).length).toBeGreaterThan(0)
  })

  describe('inland water (P15)', () => {
    const w = (e: number, n: number) => { const p = off(e, n); return `${p.lng} ${p.lat}` }
    const square = (e0: number, n0: number, e1: number, n1: number) => `MULTIPOLYGON(((${w(e0, n0)},${w(e0, n1)},${w(e1, n1)},${w(e1, n0)},${w(e0, n0)})))`

    it('lake shores come back near the point, in stored order', async () => {
      await insertInlandShores('austria', [`LINESTRING(${w(30, -300)},${w(30, 300)})`, `LINESTRING(${w(5000, -300)},${w(5000, 300)})`])
      const got = await inlandShoreNear(at.lat, at.lng, 500)
      expect(got).toHaveLength(1)
      expect(got[0]![0]!.lat).toBeLessThan(got[0]![1]!.lat) // south → north, as inserted
    })

    it('sea and inland water overlapping (a river mouth) come back as ONE area, not cancelling', async () => {
      await insertImportedWater([{ id: 1, wkt: square(30, -300, 600, 300) }])
      await insertInlandWater('spain', [{ fclass: 'river', wkt: square(-200, -50, 100, 50) }])
      const rings = await waterNear(at.lat, at.lng, 500)
      // The union has a single outer ring; the river's overlap with the sea left no inner edge
      // for an even-odd test to trip on.
      expect(rings).toHaveLength(1)
    })

    it('a lake alone counts as water; clearing a region removes only that region', async () => {
      await insertInlandWater('austria', [{ fclass: 'water', wkt: square(30, -300, 600, 300) }])
      await insertInlandShores('austria', [`LINESTRING(${w(30, -300)},${w(30, 300)})`])
      await insertInlandWater('finland', [{ fclass: 'water', wkt: square(-600, -300, -400, 300) }])
      expect((await waterNear(at.lat, at.lng, 500)).length).toBe(2)
      await clearInlandRegion('austria')
      expect(await inlandShoreNear(at.lat, at.lng, 500)).toEqual([])
      expect((await waterNear(at.lat, at.lng, 500)).length).toBe(1)
    })
  })
})
