import { vi } from 'vitest'

/**
 * Unit-test mock for @repo/data/analytics.
 *
 * The real DB helpers query Postgres; the pure helpers are trivial. Unit tests
 * that drive a server action which composes these (e.g. accounting
 * getRevenueTrend) use this stub. Defaults: an empty trend. Override per-test.
 */
export const getRevenueByDay = vi.fn().mockResolvedValue([])
export const getOccupancyByDay = vi.fn().mockResolvedValue([])
export const getReservationDayStats = vi.fn().mockResolvedValue([])
export const summarizeRevenue = vi.fn().mockReturnValue({ totalRevenue: 0, totalCount: 0, bestDay: null })
export const summarizeOccupancy = vi.fn().mockReturnValue({ avgOccupancyPct: 0, peakOccupancyPct: 0, totalComps: 0 })
export const summarizeReservationStats = vi.fn().mockReturnValue({ totalRevenue: 0, totalSeats: 0, bestDay: null })
export const toFiguresCsv = vi.fn().mockReturnValue('date,sunbeds,revenue\n')
export const getFloorStateSnapshot = vi.fn().mockResolvedValue({ capacity: 0, libres: 0, alquiladas: 0, reservadas: 0, gratis: 0, desactivada: 0 })
export const getOccupancySnapshotForSites = vi.fn().mockResolvedValue({
  capacity: 0, blocked: 0, sellable: 0, occupied: 0,
  comps: 0, held: 0, unconfirmed: 0, occupancyPct: 0,
})
export const getArrivalsToday = vi.fn().mockResolvedValue({ expected: 0, arrived: 0, arrivedPct: 0 })
export const getRevenueByChannelByDay = vi.fn().mockResolvedValue([])
export const summarizeRevenueByChannel = vi.fn().mockReturnValue({ total: 0, cash: 0, qr: 0, online: 0, bestDay: null })
export const getMonthlySourceSummary = vi.fn().mockResolvedValue({
  sunbeds: { revenue: 0, count: 0, seats: 0 },
  rentals: { revenue: 0, count: 0 },
  orders: { revenue: 0, count: 0, bedLinkedRevenue: 0 },
  refunds: { revenue: 0, count: 0 },
  total: 0,
  totalCount: 0,
  capacity: 0,
})
