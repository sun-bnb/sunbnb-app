import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./coastline-db', () => ({
  coastlineNear: vi.fn(),
  inlandShoreNear: vi.fn(),
  storeCoastTile: vi.fn(),
  uncoveredCoastTiles: vi.fn(),
  waterNear: vi.fn(),
}))
vi.mock('./coastline-overpass', () => ({ fetchCoastTile: vi.fn() }))

import { coastlineNear, inlandShoreNear, storeCoastTile, uncoveredCoastTiles, waterNear } from './coastline-db'
import { fetchCoastTile } from './coastline-overpass'
import { coastTilesAround } from './coastline-tiles'
import { shoreAround } from './coastline-lookup'

const A = [{ lat: 1, lng: 1 }, { lat: 1, lng: 2 }]
const B = [{ lat: 2, lng: 1 }, { lat: 2, lng: 2 }]
const LAKE = [{ lat: 3, lng: 1 }, { lat: 3, lng: 2 }]
const RING = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }, { lat: 0, lng: 0 }]

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(inlandShoreNear).mockResolvedValue([])
  vi.mocked(uncoveredCoastTiles).mockResolvedValue([])
  vi.mocked(waterNear).mockResolvedValue([RING])
})

describe('shoreAround — DB first, Overpass only for never-fetched tiles', () => {
  it('an imported region answers from the DB alone, never touching Overpass', async () => {
    vi.mocked(coastlineNear).mockResolvedValue([{ id: -5, points: A }])
    const res = await shoreAround(10, 20, 500)
    expect(res).toEqual({ ways: [A], water: [RING] })
    expect(uncoveredCoastTiles).not.toHaveBeenCalled()
    expect(fetchCoastTile).not.toHaveBeenCalled()
    expect(coastlineNear).toHaveBeenCalledWith(10, 20, 500)
    expect(waterNear).toHaveBeenCalledWith(10, 20, 700)
  })

  it('prefers imported ways over Overpass copies of the same shore', async () => {
    vi.mocked(coastlineNear).mockResolvedValue([{ id: 9, points: B }, { id: -1, points: A }])
    expect((await shoreAround(10, 20, 500)).ways).toEqual([A])
  })

  it('fetches and stores every missing tile, then re-reads the coastline', async () => {
    vi.mocked(coastlineNear).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 7, points: B }])
    vi.mocked(uncoveredCoastTiles).mockResolvedValue(['t1', 't2'])
    vi.mocked(fetchCoastTile).mockImplementation(async (key) => (key === 't1' ? [{ id: 7, points: B }] : null))
    const res = await shoreAround(10, 20, 500)
    expect(uncoveredCoastTiles).toHaveBeenCalledWith(coastTilesAround(10, 20, 500))
    expect(fetchCoastTile).toHaveBeenCalledTimes(2)
    // A tile Overpass couldn't deliver stays uncovered (not stored) — retried next time.
    expect(storeCoastTile).toHaveBeenCalledTimes(1)
    expect(storeCoastTile).toHaveBeenCalledWith('t1', [{ id: 7, points: B }])
    expect(coastlineNear).toHaveBeenCalledTimes(2)
    // Overpass-only shore with no inland water: no water polygons are read.
    expect(res).toEqual({ ways: [B], water: [] })
    expect(waterNear).not.toHaveBeenCalled()
  })

  it('does not re-read when every tile was already cached', async () => {
    vi.mocked(coastlineNear).mockResolvedValue([{ id: 7, points: B }])
    expect(await shoreAround(10, 20, 500)).toEqual({ ways: [B], water: [] })
    expect(coastlineNear).toHaveBeenCalledTimes(1)
  })

  it('appends lake/river shores after the coastline and reads water for them', async () => {
    vi.mocked(coastlineNear).mockResolvedValue([])
    vi.mocked(inlandShoreNear).mockResolvedValue([LAKE])
    expect(await shoreAround(10, 20, 300)).toEqual({ ways: [LAKE], water: [RING] })
    expect(waterNear).toHaveBeenCalledWith(10, 20, 500)
  })

  it('propagates a DB failure so the caller can fall back', async () => {
    vi.mocked(coastlineNear).mockRejectedValue(new Error('COASTLINE_POSTGRES_URL is not set'))
    await expect(shoreAround(10, 20, 500)).rejects.toThrow('COASTLINE_POSTGRES_URL')
  })
})
