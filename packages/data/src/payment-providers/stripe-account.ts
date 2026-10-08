/**
 * Resolve a partner's Stripe connected-account id (track 028, P3a). SERVER-ONLY (prisma).
 * `PartnerAccount.userId === Site.userId`.
 */
import prisma from '../../index'
import { stripeAdapter } from './stripe-adapter'

export async function stripeAccountForPartner(partnerAccountId: string): Promise<string | null> {
  const pa = await prisma.partnerAccount.findUnique({
    where: { userId: partnerAccountId },
    select: { stripeConnectAccountId: true },
  })
  return pa?.stripeConnectAccountId ?? null
}

export async function stripeAccountForSite(siteId: string): Promise<string | null> {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  return site ? stripeAccountForPartner(site.userId) : null
}

export type StripeRefStatus =
  | { status: 'ok'; providerStatus: string; succeeded: boolean; failed: boolean }
  | { status: 'error'; error: string }

/**
 * Poll-fallback status for a Stripe ref, in the shape `getReservationPaymentStatus` /
 * `getRentalBookingPaymentStatus` return. `refunded` still counts as succeeded: the money
 * was collected, the refund is a later event.
 */
export async function getStripeRefStatus(
  ref: string,
  partnerAccountId: string,
): Promise<StripeRefStatus> {
  const account = await stripeAccountForPartner(partnerAccountId)
  if (!account) return { status: 'error', error: 'Partner has not connected Stripe' }
  try {
    const state = await stripeAdapter.fetchState(ref, {
      partnerAccountId,
      stripeConnectAccountId: account,
    })
    return {
      status: 'ok',
      providerStatus: state,
      succeeded: state === 'paid' || state === 'refunded',
      failed: state === 'failed',
    }
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : 'Stripe lookup failed' }
  }
}
