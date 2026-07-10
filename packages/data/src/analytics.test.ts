import { describe, it, expect } from 'vitest'
import {
  summarizeRevenue,
  summarizeOccupancy,
  summarizeReservationStats,
  summarizeRevenueByChannel,
  toFiguresCsv,
  type DailyRevenue,
  type DailyOccupancy,
  type DailyReservationStats,
  type DailyRevenueByChannel,
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

const stat = (date: string, rentedSeats: number, revenue: number): DailyReservationStats =>
  ({ date, rentedSeats, revenue })

describe('summarizeReservationStats', () => {
  it('returns zeros and no best day for an empty set', () => {
    expect(summarizeReservationStats([])).toEqual({ totalRevenue: 0, totalSeats: 0, bestDay: null })
  })

  it('sums revenue (rounded) and seat counts across days', () => {
    const res = summarizeReservationStats([stat('2026-06-01', 2, 0.1), stat('2026-06-02', 3, 0.2)])
    expect(res.totalRevenue).toBe(0.3)
    expect(res.totalSeats).toBe(5)
  })

  it('picks the highest-revenue day as bestDay', () => {
    const best = stat('2026-06-02', 8, 90)
    const res = summarizeReservationStats([stat('2026-06-01', 4, 40), best, stat('2026-06-03', 1, 10)])
    expect(res.bestDay).toEqual(best)
  })

  it('bestDay is null when nothing earned (all zero revenue)', () => {
    const res = summarizeReservationStats([stat('2026-06-01', 0, 0), stat('2026-06-02', 0, 0)])
    expect(res.bestDay).toBeNull()
    expect(res.totalRevenue).toBe(0)
    expect(res.totalSeats).toBe(0)
  })

  it('ignores zero-revenue days for bestDay even when seats were rented (comps already excluded upstream)', () => {
    const res = summarizeReservationStats([stat('2026-06-01', 5, 0), stat('2026-06-02', 1, 30)])
    expect(res.bestDay).toEqual(stat('2026-06-02', 1, 30))
  })

  it('keeps the first of tied top-revenue days (deterministic)', () => {
    const first = stat('2026-06-01', 5, 50)
    const res = summarizeReservationStats([first, stat('2026-06-02', 5, 50)])
    expect(res.bestDay).toEqual(first)
  })
})

const chan = (
  date: string,
  cash: number,
  qr: number,
  online: number,
  total: number,
): DailyRevenueByChannel => ({ date, cash, qr, online, total })

describe('summarizeRevenueByChannel', () => {
  it('returns zeros and no best day for an empty set', () => {
    expect(summarizeRevenueByChannel([])).toEqual({ total: 0, cash: 0, qr: 0, online: 0, bestDay: null })
  })

  it('sums each channel and grand total (rounded) across days', () => {
    const res = summarizeRevenueByChannel([
      chan('2026-06-01', 10, 5, 20, 35),
      chan('2026-06-02', 0, 15, 10, 25),
    ])
    expect(res.cash).toBe(10)
    expect(res.qr).toBe(20)
    expect(res.online).toBe(30)
    expect(res.total).toBe(60)
  })

  it('rounds the grand total to eliminate float drift', () => {
    // 0.1 + 0.2 in JS = 0.30000000000000004 — round() must clean it
    const res = summarizeRevenueByChannel([chan('2026-06-01', 0.1, 0.2, 0, 0.3)])
    expect(res.total).toBe(0.3)
  })

  it('picks the highest-total day as bestDay', () => {
    const best = chan('2026-06-02', 50, 30, 20, 100)
    const res = summarizeRevenueByChannel([
      chan('2026-06-01', 10, 0, 5, 15),
      best,
      chan('2026-06-03', 20, 0, 10, 30),
    ])
    expect(res.bestDay).toEqual(best)
  })

  it('bestDay is null when nothing earned (all totals are zero)', () => {
    const res = summarizeRevenueByChannel([
      chan('2026-06-01', 0, 0, 0, 0),
      chan('2026-06-02', 0, 0, 0, 0),
    ])
    expect(res.bestDay).toBeNull()
    expect(res.total).toBe(0)
  })

  it('keeps the first of tied top-total days (deterministic)', () => {
    const first = chan('2026-06-01', 50, 0, 0, 50)
    const res = summarizeRevenueByChannel([first, chan('2026-06-02', 50, 0, 0, 50)])
    expect(res.bestDay).toEqual(first)
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
