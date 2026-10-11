import { describe, expect, it } from 'vitest'
import { INITIAL_ALIGN, reduceAlign, type AlignRequest, type AlignState } from './photo-align-store'

const req = (uploadId = 'u1'): AlignRequest => ({
  uploadId,
  seed: { kind: 'similarity', anchorPx: { x: 5, y: 5 }, anchor: { lat: 35.5, lng: 24 }, metersPerPx: 0.1, rotationDeg: 10 },
  image: { w: 1000, h: 500 },
})
const opened = (id = 'u1') => reduceAlign(INITIAL_ALIGN, { type: 'open', request: req(id) })

describe('reduceAlign', () => {
  it('open activates the mode with the seed as the working georef', () => {
    const s = opened()
    expect(s.active).toBe(true)
    expect(s.georef).toEqual(req().seed)
  })

  it('re-opening the same photo keeps adjustments and extraction progress', () => {
    let s = opened()
    const moved = { ...req().seed, rotationDeg: 77 }
    s = reduceAlign(s, { type: 'set_georef', georef: moved })
    s = reduceAlign(s, { type: 'extract', status: 'done' })
    s = reduceAlign(s, { type: 'close' })
    expect(s.active).toBe(false)
    s = reduceAlign(s, { type: 'open', request: req() })
    expect(s.active).toBe(true)
    expect(s.georef?.rotationDeg).toBe(77)
    expect(s.extract).toBe('done')
  })

  it('opening a different photo starts fresh', () => {
    let s = opened('u1')
    s = reduceAlign(s, { type: 'extract', status: 'done' })
    s = reduceAlign(s, { type: 'opacity', value: 0.9 })
    s = reduceAlign(s, { type: 'open', request: req('u2') })
    expect(s.request?.uploadId).toBe('u2')
    expect(s.extract).toBe('idle')
    expect(s.opacity).toBe(INITIAL_ALIGN.opacity)
  })

  it('reset restores the seed and aborts a half-finished pin flow', () => {
    let s = opened()
    s = reduceAlign(s, { type: 'set_georef', georef: { ...req().seed, metersPerPx: 9 } })
    s = reduceAlign(s, { type: 'pin', action: { type: 'start' } })
    s = reduceAlign(s, { type: 'reset' })
    expect(s.georef).toEqual(req().seed)
    expect(s.pins.step).toBe('idle')
  })

  it('cannot set a georef or pin without a request', () => {
    expect(reduceAlign(INITIAL_ALIGN, { type: 'set_georef', georef: req().seed })).toBe(INITIAL_ALIGN)
    expect(reduceAlign(INITIAL_ALIGN, { type: 'pin', action: { type: 'start' } })).toBe(INITIAL_ALIGN)
  })

  it('a completed 2-pin flow replaces the georef and leaves pin mode', () => {
    const image = req().image
    const ll = { lat: 35.5, lng: 24 }
    let s: AlignState = opened()
    const step = (px: { x: number; y: number }, at: { lat: number; lng: number }) => {
      s = reduceAlign(s, { type: 'pin', action: { type: 'click', px, ll: at, image } })
    }
    s = reduceAlign(s, { type: 'pin', action: { type: 'start' } })
    step({ x: 100, y: 100 }, ll)
    step({ x: 0, y: 0 }, ll)
    step({ x: 900, y: 100 }, ll)
    step({ x: 0, y: 0 }, { lat: ll.lat, lng: ll.lng + 0.0008 }) // ~72 m east for 800 px
    expect(s.pins.step).toBe('idle')
    expect(s.georef).not.toEqual(req().seed)
    expect(s.georef?.metersPerPx).toBeCloseTo(0.09, 1)
    // photo-right pinned to map-east means the photo's up is north: rotation 0 (mod 360)
    const r = s.georef!.rotationDeg
    expect(Math.min(r, 360 - r)).toBeLessThan(0.01)
  })

  it('opacity is clamped', () => {
    expect(reduceAlign(opened(), { type: 'opacity', value: 0 }).opacity).toBe(0.1)
  })

  it('close also cancels pin mode and clears a save error', () => {
    let s = opened()
    s = reduceAlign(s, { type: 'pin', action: { type: 'start' } })
    s = reduceAlign(s, { type: 'save', status: 'error' })
    s = reduceAlign(s, { type: 'close' })
    expect(s.pins.step).toBe('idle')
    expect(s.save).toBe('idle')
  })
})
