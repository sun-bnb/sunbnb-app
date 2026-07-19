import { vi } from 'vitest'

/**
 * Unit-test mock for @repo/data/tab-payment.
 *
 * The real module reads from the DB and creates invoices, so unit tests must
 * use this stub. Default: processConfirmedTabPayment resolves (no-op);
 * calculateTabTotal returns a zero total. Override per-test with
 * mockResolvedValueOnce.
 */
export const processConfirmedTabPayment = vi.fn().mockResolvedValue(undefined)

export const calculateTabTotal = vi.fn().mockResolvedValue({
  ordersTotal: 0,
  serviceFee: 0,
  payableTotal: 0,
  orderIds: [],
})
