/**
 * Provider-neutral payment-id helpers.
 *
 * Extracted from the (removed) Stripe lib so they survive independently of any
 * payment provider: `isDemoPayment` is used across the Mollie + demo flows, and
 * `isValidEntityId` guards route inputs everywhere.
 */

/** Check if a paymentRef is a demo/fake payment (not a real provider charge). */
export function isDemoPayment(paymentRef: string | null): boolean {
  return paymentRef?.startsWith('pi_demo_') ?? false
}

/** Validate an entity ID format. Accepts both CUID (Prisma default) and UUID v4. */
export function isValidEntityId(value: string): boolean {
  // CUID: starts with 'c', 25 chars, lowercase alphanumeric
  const cuid = /^c[a-z0-9]{24,}$/
  // UUID v4: 8-4-4-4-12 hex
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return cuid.test(value) || uuid.test(value)
}
