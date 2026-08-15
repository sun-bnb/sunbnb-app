/**
 * Tests for the shared viewport primitives (track 020 P6).
 *
 * The footprint tests are property-based against the REAL grid generator: for
 * a matrix of grid shapes and rotations, every seat generateChairGrid places
 * must land inside the polygon parcelFootprint claims for the same config —
 * the footprint's whole job is "the box you can render INSTEAD of the seats".
 */

import { describe, it, expect } from 'vitest'
import { generateChairGrid } from './grid'
import {
  LOD_SEAT_ZOOM,
  lodTier,
  expandBounds,
  cullToBounds,
  parcelFootprint,
  type ViewportBounds,
} from './viewport'

describe('lodTier', () => {
  it('matches the consumer map switch: seats strictly above LOD_SEAT_ZOOM', () => {
    expect(lodTier(LOD_SEAT_ZOOM)).toBe('parcels')     // 19 → parcels (zoom > 19 renders seats)
    expect(lodTier(LOD_SEAT_ZOOM - 3)).toBe('parcels')
    expect(lodTier(LOD_SEAT_ZOOM + 0.1)).toBe('seats')
    expect(lodTier(20)).toBe('seats')
  })
})

describe('expandBounds', () => {
  it('pads each span by the margin factor', () => {
    const b: ViewportBounds = { north: 10, south: 8, east: 24, west: 20 }
    expect(expandBounds(b, 0.5)).toEqual({ north: 11, south: 7, east: 26, west: 18 })
  })
})

describe('cullToBounds', () => {
  const item = (id: string, lat: number, lng: number) => ({ id, lat, lng })
  const items = [
    item('in', 36.5, -4.5),
    item('north-out', 37.5, -4.5),
    item('west-out', 36.5, -6.0),
    item('edge', 37.0, -4.0), // exactly on the boundary — inclusive
  ]
  const bounds: ViewportBounds = { north: 37, south: 36, east: -4, west: -5 }
  const run = (b: ViewportBounds | null, always?: Set<string>) =>
    cullToBounds(items, b, (i) => i.id, (i) => i.lat, (i) => i.lng, { alwaysInclude: always })
      .map((i) => i.id)

  it('keeps inside + boundary items, drops outside', () => {
    expect(run(bounds)).toEqual(['in', 'edge'])
  })

  it('alwaysInclude overrides position (selected seat off-viewport stays)', () => {
    expect(run(bounds, new Set(['west-out']))).toEqual(['in', 'west-out', 'edge'])
  })

  it('null bounds (map not idle yet) yields only alwaysInclude items', () => {
    expect(run(null)).toEqual([])
    expect(run(null, new Set(['in']))).toEqual(['in'])
  })

  it('drops items with non-finite coordinates instead of comparing NaN', () => {
    const weird = [item('nan', Number.NaN, -4.5)]
    expect(
      cullToBounds(weird, bounds, (i) => i.id, (i) => i.lat, (i) => i.lng),
    ).toEqual([])
  })
})

describe('parcelFootprint', () => {
  const anchor = { lat: 36.7213, lng: -4.4214 }

  /** Point-in-rotated-rect: inverse-rotate the point, then rect-test. */
  function containsCell(
    corners: ReturnType<typeof parcelFootprint>,
    rotationDeg: number,
    dxM: number,
    dyM: number,
  ): boolean {
    const metersPerLat = 111320
    const metersPerLng = 111320 * Math.cos((anchor.lat * Math.PI) / 180)
    // Corners back to meter offsets, inverse-rotated into local grid space.
    const rad = (rotationDeg * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const invRotate = (dx: number, dy: number) => ({
      x: dx * cos - dy * sin,
      y: dx * sin + dy * cos,
    })
    const local = corners.map((c) =>
      invRotate((c.lng - anchor.lng) * metersPerLng, (c.lat - anchor.lat) * metersPerLat),
    )
    const xs = local.map((p) => p.x)
    const ys = local.map((p) => p.y)
    const p = invRotate(dxM, dyM)
    const eps = 1e-6
    return (
      p.x >= Math.min(...xs) - eps &&
      p.x <= Math.max(...xs) + eps &&
      p.y >= Math.min(...ys) - eps &&
      p.y <= Math.max(...ys) + eps
    )
  }

  it('contains every seat the grid generator places, across shapes and rotations', () => {
    const shapes = [
      { rows: 1, seatsPerRow: 1, pairSeats: false },
      { rows: 1, seatsPerRow: 6, pairSeats: true },
      { rows: 6, seatsPerRow: 10, pairSeats: true },
      { rows: 3, seatsPerRow: 5, pairSeats: false },
    ]
    for (const shape of shapes) {
      for (const rotation of [0, 30, 45, 90, 137, 270]) {
        const config = {
          ...shape,
          horizontalGap: 1,
          verticalGap: 1.5,
          intraPairGap: 0.4,
          rotation,
        }
        const corners = parcelFootprint(anchor, config)
        expect(corners).toHaveLength(4)
        const cells = generateChairGrid({ group: 1, ...config })
        for (const cell of cells) {
          expect(
            containsCell(corners, rotation, cell.dx, cell.dy),
            `rotation ${rotation}, shape ${shape.rows}x${shape.seatsPerRow}, cell ${cell.tempId}`,
          ).toBe(true)
        }
      }
    }
  })

  it('a 1×1 parcel footprint is a small box around the anchor (~seat-sized)', () => {
    const corners = parcelFootprint(anchor, {
      rows: 1, seatsPerRow: 1, horizontalGap: 1, verticalGap: 1, intraPairGap: 0, pairSeats: false, rotation: 0,
    })
    for (const c of corners) {
      // within ~3m of the anchor in either axis
      expect(Math.abs(c.lat - anchor.lat) * 111320).toBeLessThan(3)
      expect(Math.abs(c.lng - anchor.lng) * 111320).toBeLessThan(4)
    }
  })

  it('rotation changes corner positions but not the footprint size', () => {
    const config = {
      rows: 2, seatsPerRow: 4, horizontalGap: 1, verticalGap: 1.5, intraPairGap: 0.4, pairSeats: true,
    }
    const span = (corners: ReturnType<typeof parcelFootprint>) => {
      const d = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
        Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos((anchor.lat * Math.PI) / 180))
      return [d(corners[0]!, corners[1]!), d(corners[1]!, corners[2]!)].sort((a, b) => a - b)
    }
    const flat = span(parcelFootprint(anchor, { ...config, rotation: 0 }))
    const tilted = span(parcelFootprint(anchor, { ...config, rotation: 63 }))
    expect(tilted[0]).toBeCloseTo(flat[0]!, 5)
    expect(tilted[1]).toBeCloseTo(flat[1]!, 5)
  })
})
