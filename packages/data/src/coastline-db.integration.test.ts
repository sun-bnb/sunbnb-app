import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanDatabase, disconnectDatabase } from './test/setup'
import { coastlineNear, storeCoastTile, uncoveredCoastTiles } from './coastline-db'

const M = 111_320
const at = { lat: 39.85, lng: 3.15 }
const off = (e: number, n: number) => ({ lat: at.lat + n / M, lng: at.lng + e / (M * Math.cos((at.lat * Math.PI) / 180)) })

describe('coastline cache', () => {
  beforeEach(cleanDatabase)
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
})
