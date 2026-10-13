/**
 * Provider-neutral payment-id helpers.
 *
 * Independent of any payment provider: `isDemoPayment` (re-exported from
 * `@repo/data/payment-refs`) gates every provider call across the Mollie,
 * Stripe Connect, Viva and demo flows, and `isValidEntityId` guards route
 * inputs everywhere.
 */

/** Check if a paymentRef is a demo/fake payment (not a real provider charge). */
export { isDemoPayment } from '@repo/data/payment-refs'

/** Validate an entity ID format. Accepts both CUID (Prisma default) and UUID v4. */
export function isValidEntityId(value: string): boolean {
  // CUID: starts with 'c', 25 chars, lowercase alphanumeric
  const cuid = /^c[a-z0-9]{24,}$/
  // UUID v4: 8-4-4-4-12 hex
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return cuid.test(value) || uuid.test(value)
}
