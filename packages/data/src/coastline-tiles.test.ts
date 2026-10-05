import { describe, expect, it } from 'vitest'
import { coastTileBounds, coastTileKey, coastTilesAround, coastTilesInBox } from './coastline-tiles'

describe('coastline cache grid', () => {
  it('keys a point to its 0.1° tile, negative coordinates included', () => {
    expect(coastTileKey(39.8071987, 3.1165019)).toBe('398:31')
    expect(coastTileKey(-22.9738729, -43.18531)).toBe('-230:-432')
  })
  it('a point exactly on a tile edge belongs to the tile it starts (float-safe)', () => {
    expect(coastTileKey(39.3, 2.3)).toBe('393:23')
  })
  it('a tile’s bounds contain the points that key to it', () => {
    for (const [lat, lng] of [[39.8071987, 3.1165019], [-22.9738729, -43.18531], [0.05, -0.05]] as const) {
      const b = coastTileBounds(coastTileKey(lat, lng))
      expect(lat).toBeGreaterThanOrEqual(b.south)
      expect(lat).toBeLessThan(b.north)
      expect(lng).toBeGreaterThanOrEqual(b.west)
      expect(lng).toBeLessThan(b.east)
    }
  })
  it('a beach near a tile corner needs all four tiles; one mid-tile needs one', () => {
    expect(coastTilesAround(39.85, 3.15, 500)).toEqual(['398:31'])
    expect(coastTilesAround(39.8001, 3.1001, 500)).toHaveLength(4)
  })
  it('covers a seeding box completely', () => {
    const keys = coastTilesInBox({ south: 39.25, west: 2.3, north: 39.97, east: 3.48 }) // Mallorca
    expect(keys).toContain(coastTileKey(39.8071987, 3.1165019))
    expect(keys.length).toBe(8 * 12)
  })
})
