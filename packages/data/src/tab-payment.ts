/**
 * Dine-in tab payment — thin re-export of the tab-payment surface from
 * payment.ts, following the same pattern as reservation-payment.ts and
 * rental-payment.ts.
 *
 * Exported as a separate submodule (`@repo/data/tab-payment`) so the partner
 * app can mock it cleanly in unit tests (the mock contract and vitest alias
 * pattern applies). Integration tests import directly without mocking.
 */

export {
  calculateTabTotal,
  processConfirmedTabPayment,
  type ProcessTabPaymentOpts,
  type TabTotalResult,
} from './payment'
