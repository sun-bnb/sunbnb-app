import { vi } from 'vitest'

/**
 * Unit-test mock for @repo/data/till.
 *
 * The real helpers query Postgres (open-till sum since last close; per-employee
 * day-breakdown). Unit tests that drive a server action composing these (manage
 * getTillStatus/closeTill, accounting staff-till) use these stubs. Defaults: an
 * empty till / empty breakdown. Override per-test.
 */
export const getOpenTill = vi.fn().mockResolvedValue({ total: 0, count: 0 })
export const getTillByEmployee = vi.fn().mockResolvedValue([])
