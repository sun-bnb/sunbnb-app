import { vi } from 'vitest'

/**
 * Unit-test mock for @repo/data/fiscal.
 *
 * The real helper queries Postgres (invoice + line aggregation). Unit tests
 * that drive a server action which composes this use this stub.
 * Default: zero report (no invoices). Override per-test.
 */
export const getMonthlyFiscalReport = vi.fn().mockResolvedValue({
  count: 0,
  gross: 0,
  net: 0,
  vat: 0,
  vatByRate: [],
  platformCommission: 0,
  platformReverseCharge: false,
  processingFees: 0,
  refunds: { count: 0, amount: 0 },
  lines: [],
})
