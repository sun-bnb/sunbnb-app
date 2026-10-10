/**
 * Stripe Terminal / Tap to Pay on the partner's connected account (track 028, P5a).
 * SERVER-ONLY. Every call passes `{ stripeAccount }` (direct charge, same as checkout.ts).
 */
import prisma from '../../index'
import { getStripeConnectClient } from './client'
import { flattenMeta } from './checkout'
import { toCents } from '../payment-math'
import type { PaymentMeta } from '../payment-providers/types'
import { esProvinceFromPostalCode, isKnownEsRegion } from '../tax/regime'

export interface TerminalLocationSite {
  id: string
  name: string
  stripeTerminalLocationId: string | null
  address?: string | null
  city?: string | null
  postalCode?: string | null
  /** PartnerAccount.taxRegion — for ES the province code; preferred over the postal-code derivation. */
  taxRegion?: string | null
  country: string
}

/**
 * `address.state` for a Terminal Location. Stripe REQUIRES it for Spain ("Missing required address
 * field for a Location in ES: address[state]", found against the live API 2026-10-08) and accepts the
 * ISO province code (`MA`). Other countries: omitted.
 */
export function terminalLocationState(site: Pick<TerminalLocationSite, 'country' | 'taxRegion' | 'postalCode'>): string | undefined {
  if (site.country.toUpperCase() !== 'ES') return undefined
  if (isKnownEsRegion(site.taxRegion)) return site.taxRegion!.trim().toUpperCase()
  return esProvinceFromPostalCode(site.postalCode) ?? undefined
}

/** Returns the site's Terminal Location id, creating + persisting one on first use. */
export async function ensureTerminalLocation(
  site: TerminalLocationSite,
  stripeAccount: string,
): Promise<string> {
  if (site.stripeTerminalLocationId) return site.stripeTerminalLocationId
  const location = await getStripeConnectClient().terminal.locations.create(
    {
      display_name: site.name,
      address: {
        line1: site.address || site.name,
        city: site.city || undefined,
        postal_code: site.postalCode || undefined,
        state: terminalLocationState(site),
        country: site.country,
      },
    },
    { stripeAccount },
  )
  await prisma.site.update({ where: { id: site.id }, data: { stripeTerminalLocationId: location.id } })
  return location.id
}

export async function createConnectionToken(stripeAccount: string, locationId: string): Promise<string> {
  const token = await getStripeConnectClient().terminal.connectionTokens.create(
    { location: locationId },
    { stripeAccount },
  )
  return token.secret
}

export async function createTerminalPaymentIntent(i: {
  amount: number
  applicationFee: number
  meta: PaymentMeta
  stripeAccount: string
  description: string
}): Promise<{ paymentIntentId: string; clientSecret: string }> {
  const feeCents = toCents(i.applicationFee)
  const pi = await getStripeConnectClient().paymentIntents.create(
    {
      amount: toCents(i.amount),
      currency: 'eur',
      // API 2026-09-30.endive (stripe-node 23) removed `payment_method_types` on create
      // (400 payment_method_types_no_longer_supported). `allowed_payment_method_types`
      // replaces it; unlike the old field it filters incompatible methods silently, so a
      // misconfigured reader now fails at collect time rather than here.
      allowed_payment_method_types: ['card_present'],
      capture_method: 'automatic',
      ...(feeCents > 0 ? { application_fee_amount: feeCents } : {}),
      description: i.description,
      metadata: flattenMeta(i.meta),
    },
    { stripeAccount: i.stripeAccount },
  )
  if (!pi.client_secret) throw new Error('Stripe returned no client_secret for the terminal PaymentIntent')
  return { paymentIntentId: pi.id, clientSecret: pi.client_secret }
}

/**
 * Cancel an in-flight Terminal PaymentIntent. `paid` = the tap landed first (finalize, don't revert);
 * `error` = unresolved (still processing, or API failure) — the caller must poll, never revert.
 */
export async function cancelTerminalPaymentIntent(
  piId: string,
  stripeAccount: string,
): Promise<'canceled' | 'paid' | 'error'> {
  try {
    const stripe = getStripeConnectClient()
    const pi = await stripe.paymentIntents.retrieve(piId, {}, { stripeAccount })
    if (pi.status === 'succeeded') return 'paid'
    if (pi.status === 'canceled') return 'canceled'
    if (
      pi.status === 'requires_payment_method' ||
      pi.status === 'requires_confirmation' ||
      pi.status === 'requires_capture' ||
      pi.status === 'requires_action'
    ) {
      await stripe.paymentIntents.cancel(piId, {}, { stripeAccount })
      return 'canceled'
    }
    return 'error'
  } catch {
    return 'error'
  }
}
