/**
 * Picks the online checkout endpoint for a venue's payment provider (track 028 P3e).
 *
 * Mollie (and anything unknown / missing) keeps the dedicated legacy Mollie routes; Stripe and
 * Viva go through the neutral `POST /api/payment/create`. This only chooses the URL — the server
 * re-resolves the provider from the entity's site and never trusts the client value.
 */
export type CheckoutKind = 'reservation' | 'order' | 'rental' | 'tab' | 'table-deposit'

export function usesLegacyMollieEndpoint(paymentProvider: string | null | undefined): boolean {
  return paymentProvider !== 'stripe' && paymentProvider !== 'viva'
}

/** Body for `/api/payment/create`. `anonId` is omitted when absent (the tab kind has none). */
export function neutralCheckoutBody(
  kind: CheckoutKind,
  ids: Record<string, unknown>,
  extra: { anonId?: string | null; redirectUrl: string },
): Record<string, unknown> {
  const body: Record<string, unknown> = { kind, ...ids }
  if (extra.anonId) body.anonId = extra.anonId
  body.redirectUrl = extra.redirectUrl
  return body
}
