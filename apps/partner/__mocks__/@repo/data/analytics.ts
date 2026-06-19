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
export const summarizeRevenue = vi.fn().mockReturnValue({ totalRevenue: 0, totalCount: 0, bestDay: null })
export const toFiguresCsv = vi.fn().mockReturnValue('date,rentals,revenue\n')
