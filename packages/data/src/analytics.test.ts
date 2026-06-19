import { describe, it, expect } from 'vitest'
import {
  summarizeRevenue,
  summarizeOccupancy,
  toFiguresCsv,
  type DailyRevenue,
  type DailyOccupancy,
} from './analytics'

const row = (date: string, revenue: number, count: number): DailyRevenue => ({ date, revenue, count })
const occ = (date: string, capacity: number, occupied: number, comps: number, occupancyPct: number): DailyOccupancy =>
  ({ date, capacity, occupied, comps, occupancyPct })

describe('summarizeRevenue', () => {
  it('returns zeros and no best day for an empty set', () => {
    expect(summarizeRevenue([])).toEqual({ totalRevenue: 0, totalCount: 0, bestDay: null })
  })

  it('sums revenue (rounded) and count across days', () => {
    const res = summarizeRevenue([row('2026-06-01', 0.1, 1), row('2026-06-02', 0.2, 2)])
    expect(res.totalRevenue).toBe(0.3) // float drift rounded away
    expect(res.totalCount).toBe(3)
  })

  it('picks the highest-revenue day as best day', () => {
    const best = row('2026-06-02', 90, 9)
    const res = summarizeRevenue([row('2026-06-01', 40, 4), best, row('2026-06-03', 10, 1)])
    expect(res.bestDay).toEqual(best)
  })

  it('never reports a zero-revenue day as best (null when nothing earned)', () => {
    const res = summarizeRevenue([row('2026-06-01', 0, 0), row('2026-06-02', 0, 0)])
    expect(res.bestDay).toBeNull()
    expect(res.totalRevenue).toBe(0)
  })

  it('keeps the first of tied top days (deterministic)', () => {
    const first = row('2026-06-01', 50, 5)
    const res = summarizeRevenue([first, row('2026-06-02', 50, 5)])
    expect(res.bestDay).toEqual(first)
  })
})

describe('summarizeOccupancy', () => {
  it('returns zeros for an empty set', () => {
    expect(summarizeOccupancy([])).toEqual({ avgOccupancyPct: 0, peakOccupancyPct: 0, totalComps: 0 })
  })

  it('averages occupancy %, tracks the peak, and sums comp bed-days', () => {
    const res = summarizeOccupancy([
      occ('2026-06-01', 4, 1, 0, 25),
      occ('2026-06-02', 4, 3, 1, 75),
      occ('2026-06-03', 4, 2, 2, 50),
    ])
    expect(res).toEqual({ avgOccupancyPct: 50, peakOccupancyPct: 75, totalComps: 3 })
  })
})

describe('toFiguresCsv', () => {
  it('emits a header plus one row per day, revenue at 2dp', () => {
    const csv = toFiguresCsv([row('2026-06-01', 16, 2), row('2026-06-02', 0, 0)])
    expect(csv).toBe('date,rentals,revenue\n2026-06-01,2,16.00\n2026-06-02,0,0.00\n')
  })

  it('emits just the header for no rows', () => {
    expect(toFiguresCsv([])).toBe('date,rentals,revenue\n')
  })
})
