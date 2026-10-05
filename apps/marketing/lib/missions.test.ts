import { describe, expect, it } from 'vitest'
import { generateBeachLayout } from './beach-layout.ts'
import { exampleBookings, hintBed, staffWindow } from './missions.ts'

const layout = (n: number) =>
  generateBeachLayout({ anchor: { lat: 39.8, lng: 3.1 }, seaBearingDeg: 90, sunbedCount: n, placement: 'waterline' })

describe('hintBed', () => {
  it('points at a front-row bed', () => {
    for (const n of [2, 20, 120, 400]) expect(hintBed(layout(n))?.row).toBe(0)
  })
  it('is null for an empty beach', () => {
    expect(hintBed({ sunbeds: [], umbrellas: [], rows: 0, pairsPerRow: 0 })).toBeNull()
  })
})

describe('staffWindow', () => {
  it('always contains the guest bed, only from its row', () => {
    const l = layout(240)
    for (const s of l.sunbeds) {
      const w = staffWindow(l, s.label)
      expect(w.map((x) => x.label)).toContain(s.label)
      expect(new Set(w.map((x) => x.row))).toEqual(new Set([s.row]))
      expect(w.length).toBeLessThanOrEqual(10)
    }
  })
  it('never splits a pair (starts on an odd seat number)', () => {
    const l = layout(240)
    for (const s of l.sunbeds) {
      const first = staffWindow(l, s.label)[0]!
      expect(Number(first.label.replace(/^[A-Z]+/, '')) % 2).toBe(1)
    }
  })
  it('shows a short row whole, and nothing for an unknown bed', () => {
    const l = layout(6)
    expect(staffWindow(l, 'A1').length).toBe(l.sunbeds.filter((s) => s.row === 0).length)
    expect(staffWindow(l, 'Z99')).toEqual([])
  })
})

describe('exampleBookings', () => {
  it('never books the guest bed and is stable across calls', () => {
    const l = layout(120)
    for (const s of l.sunbeds.slice(0, 30)) {
      const w = staffWindow(l, s.label)
      const a = exampleBookings(w, s.label)
      expect(a.has(s.label)).toBe(false)
      expect([...a]).toEqual([...exampleBookings(w, s.label)])
    }
  })
})
