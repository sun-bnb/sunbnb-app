/**
 * Shared Stripe client for Partner App API routes. The implementation lives in
 * `@repo/data/stripe` (also used for Stripe Connect, track 028); this keeps the
 * existing `@/app/api/_lib/stripe` import path (and its test mocks) stable.
 */
export { getStripeClient, getStripeConnectClient } from '@repo/data/stripe'
