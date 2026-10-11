import { describe, it, expect } from 'vitest'
import { computeOpenZoom, SEAT_WIDTH_PX, MIN_TAP_SEAT_PX } from './open-zoom'

const base = { zoomMax: 2.5, desktopRatio: 0.8, desktopMin: 0.4 }
// 10 seats + row label + gaps, roughly what a 6x10 parcel measures.
const wide10 = 10 * SEAT_WIDTH_PX + 60

describe('computeOpenZoom', () => {
  it('phone + 10-seat row opens with seats >= 40px (not 22px)', () => {
    const z = computeOpenZoom({ ...base, viewportW: 390, contentW: wide10 })
    expect(z * SEAT_WIDTH_PX).toBeGreaterThanOrEqual(MIN_TAP_SEAT_PX)
  })
  it('phone with a small grid fills the full width', () => {
    const z = computeOpenZoom({ ...base, viewportW: 390, contentW: 280 })
    expect(z * 280).toBeCloseTo(390, 5)
  })
  it('phone never exceeds zoomMax for a tiny grid', () => {
    expect(computeOpenZoom({ ...base, viewportW: 390, contentW: 50 })).toBe(2.5)
  })
  it('desktop keeps fit x 0.8 behaviour', () => {
    expect(computeOpenZoom({ ...base, viewportW: 1440, contentW: 800 })).toBeCloseTo(1.44, 5)
  })
  it('desktop very wide parcel keeps the old 0.4 floor', () => {
    expect(computeOpenZoom({ ...base, viewportW: 1000, contentW: 5000 })).toBe(0.4)
  })
})
