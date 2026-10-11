import { describe, expect, it } from 'vitest'
import {
  latLngToEnu,
  pxToEnu,
  pxToLatLng,
  type LatLng,
  type SimilarityGeoref,
} from '@repo/agent/geo/georef'
import {
  clampOpacity,
  dragHandle,
  dragMove,
  handlePx,
  imageCentre,
  INITIAL_PINS,
  MAX_METERS_PER_PX,
  reducePins,
  type PinState,
} from './photo-align'

const image = { w: 2000, h: 1500 }
const seed = (over: Partial<SimilarityGeoref> = {}): SimilarityGeoref => ({
  kind: 'similarity',
  anchorPx: { x: 1000, y: 750 },
  anchor: { lat: 35.5138, lng: 24.018 },
  metersPerPx: 0.05,
  rotationDeg: 30,
  ...over,
})
const close = (a: number, b: number, tol = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(tol)
const offset = (ll: LatLng, e: number, n: number): LatLng => ({
  lat: ll.lat + n / 111320,
  lng: ll.lng + e / (111320 * Math.cos((ll.lat * Math.PI) / 180)),
})

describe('dragMove', () => {
  it('moves the anchor by exactly the cursor delta in metres, leaving scale and rotation alone', () => {
    const g = seed()
    const from = { lat: 35.5139, lng: 24.0181 }
    const to = offset(from, 12.5, -7)
    const next = dragMove(g, from, to)
    const d = latLngToEnu(g.anchor, next.anchor)
    close(d.e, 12.5)
    close(d.n, -7)
    expect(next.metersPerPx).toBe(g.metersPerPx)
    expect(next.rotationDeg).toBe(g.rotationDeg)
    expect(next.anchorPx).toEqual(g.anchorPx)
  })

  it('moves every image point by the same delta (rigid translation)', () => {
    const g = seed()
    const next = dragMove(g, g.anchor, offset(g.anchor, 40, 25))
    for (const p of [{ x: 0, y: 0 }, { x: 2000, y: 1500 }]) {
      const d = latLngToEnu(pxToLatLng(g, p), pxToLatLng(next, p))
      close(d.e, 40)
      close(d.n, 25)
    }
  })
})

describe('dragHandle', () => {
  const handle = handlePx(image)
  const centreLL = (g: SimilarityGeoref) => pxToLatLng(g, imageCentre(image))

  it('is a no-op when the cursor stays on the handle', () => {
    const g = seed()
    const next = dragHandle(g, image, handle, pxToLatLng(g, handle))
    close(next.rotationDeg, g.rotationDeg, 1e-6)
    close(next.metersPerPx, g.metersPerPx, 1e-9)
  })

  it('rotating the handle clockwise by alpha about the centre changes rotationDeg by alpha', () => {
    const g = seed({ rotationDeg: 30 })
    const c = centreLL(g)
    const v = latLngToEnu(c, pxToLatLng(g, handle))
    const a = (25 * Math.PI) / 180
    const rotated = { e: v.e * Math.cos(a) + v.n * Math.sin(a), n: -v.e * Math.sin(a) + v.n * Math.cos(a) } // clockwise
    const next = dragHandle(g, image, handle, offset(c, rotated.e, rotated.n))
    close(next.rotationDeg, 55, 1e-3)
    close(next.metersPerPx, g.metersPerPx, 1e-6)
  })

  it('wraps rotation into [0, 360)', () => {
    const g = seed({ rotationDeg: 350 })
    const c = centreLL(g)
    const v = latLngToEnu(c, pxToLatLng(g, handle))
    const a = (20 * Math.PI) / 180
    const next = dragHandle(g, image, handle, offset(c, v.e * Math.cos(a) + v.n * Math.sin(a), -v.e * Math.sin(a) + v.n * Math.cos(a)))
    close(next.rotationDeg, 10, 1e-3)
  })

  it('dragging the handle k times farther from the centre multiplies metersPerPx by k (image k times larger)', () => {
    const g = seed()
    const c = centreLL(g)
    const v = latLngToEnu(c, pxToLatLng(g, handle))
    const next = dragHandle(g, image, handle, offset(c, v.e * 1.5, v.n * 1.5))
    close(next.metersPerPx, g.metersPerPx * 1.5, 1e-6)
    close(next.rotationDeg, g.rotationDeg, 1e-3)
  })

  it('keeps the image centre fixed on the map and puts the handle under the cursor', () => {
    const g = seed()
    const c = centreLL(g)
    const target = offset(c, -30, 80)
    const next = dragHandle(g, image, handle, target)
    const dc = latLngToEnu(c, pxToLatLng(next, imageCentre(image)))
    close(dc.e, 0)
    close(dc.n, 0)
    const dh = latLngToEnu(target, pxToLatLng(next, handle))
    close(dh.e, 0, 0.01)
    close(dh.n, 0, 0.01)
  })

  it('ignores a cursor dropped on the centre (degenerate)', () => {
    const g = seed()
    expect(dragHandle(g, image, handle, centreLL(g))).toBe(g)
  })

  it('clamps an absurd scale', () => {
    const g = seed()
    const c = centreLL(g)
    const next = dragHandle(g, image, handle, offset(c, 1e6, 0))
    expect(next.metersPerPx).toBe(MAX_METERS_PER_PX)
  })
})

describe('reducePins (2-point flow)', () => {
  const click = (s: PinState, px: { x: number; y: number }, ll: LatLng) => reducePins(s, { type: 'click', px, ll, image })
  const ll0 = { lat: 35.5, lng: 24 }

  it('ignores clicks until started', () => {
    expect(click(INITIAL_PINS, { x: 1, y: 1 }, ll0)).toBe(INITIAL_PINS)
  })

  it('walks photo1 -> map1 -> photo2 -> map2 and yields the georef pinning both points', () => {
    const truth = seed({ anchorPx: { x: 0, y: 0 }, anchor: ll0, metersPerPx: 0.08, rotationDeg: 140 })
    const p1 = { x: 200, y: 300 }
    const p2 = { x: 1600, y: 900 }
    let s = reducePins(INITIAL_PINS, { type: 'start' })
    expect(s.step).toBe('photo1')
    s = click(s, p1, { lat: 0, lng: 0 })
    expect(s.step).toBe('map1')
    s = click(s, { x: -5, y: -5 }, pxToLatLng(truth, p1)) // px ignored in a map step
    expect(s.step).toBe('photo2')
    s = click(s, p2, { lat: 0, lng: 0 })
    expect(s.step).toBe('map2')
    s = click(s, { x: 0, y: 0 }, pxToLatLng(truth, p2))
    expect(s.step).toBe('idle')
    const g = s.result!
    close(g.metersPerPx, 0.08, 1e-6)
    close(g.rotationDeg, 140, 1e-3)
    const e = pxToEnu(g, p2)
    const want = latLngToEnu(pxToLatLng(g, p1), pxToLatLng(truth, p2))
    close(e.e, want.e, 0.01)
    close(e.n, want.n, 0.01)
  })

  it('does not accept a photo pin outside the image', () => {
    const s = reducePins(INITIAL_PINS, { type: 'start' })
    expect(click(s, { x: image.w + 50, y: 10 }, ll0)).toBe(s)
  })

  it('restarts with an error when the second map pin coincides with the first', () => {
    let s = reducePins(INITIAL_PINS, { type: 'start' })
    s = click(s, { x: 10, y: 10 }, ll0)
    s = click(s, { x: 0, y: 0 }, ll0)
    s = click(s, { x: 500, y: 500 }, ll0)
    s = click(s, { x: 0, y: 0 }, ll0)
    expect(s.step).toBe('photo1')
    expect(s.error).toBe('degenerate')
    expect(s.result).toBeUndefined()
  })

  it('back undoes the last pin; cancel resets', () => {
    let s = reducePins(INITIAL_PINS, { type: 'start' })
    s = click(s, { x: 10, y: 10 }, ll0)
    s = click(s, { x: 0, y: 0 }, ll0)
    expect(s.step).toBe('photo2')
    s = reducePins(s, { type: 'back' })
    expect(s.step).toBe('map1')
    expect(reducePins(s, { type: 'cancel' })).toEqual(INITIAL_PINS)
  })
})

describe('clampOpacity', () => {
  it('stays within the visible range and survives NaN', () => {
    expect(clampOpacity(0)).toBe(0.1)
    expect(clampOpacity(5)).toBe(1)
    expect(clampOpacity(0.4)).toBe(0.4)
    expect(clampOpacity(NaN)).toBe(0.6)
  })
})
