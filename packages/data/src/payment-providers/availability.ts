/**
 * Per-country provider availability (track 028, packet P2a).
 *
 * PURE and client-safe — no prisma, no fetch, no env. FOUNDER-EDITABLE DATA:
 * edit the country lists below, nothing else reads provider support from anywhere
 * else. Facts as of 2026-10-07.
 *
 * Sources: Mollie "Supported countries" + Mollie Tap to Pay on iPhone docs;
 * Viva.com ISV / Terminal app coverage; Stripe global availability + Stripe
 * Terminal Tap to Pay supported countries. Re-verify before launching a new market.
 *
 * `online`      — hosted online checkout can be offered to a venue in this country.
 * `cardPresent` — how the venue's staff can take a card in person:
 *                   'tap-to-pay'   phone-as-terminal (no hardware)
 *                   'terminal-app' Viva Terminal app on the staff phone
 *                   'none'         not available
 */
import type { SelectableProvider } from '../payment-refs'

export type CardPresentKind = 'none' | 'terminal-app' | 'tap-to-pay'

export interface ProviderAvailability {
  online: boolean
  cardPresent: CardPresentKind
  note?: string
}

export const PROVIDER_LABELS: Record<SelectableProvider, string> = {
  mollie: 'Mollie',
  viva: 'Viva',
  stripe: 'Stripe',
}

const words = (s: string): string[] => s.trim().split(/\s+/)

function build(
  online: string,
  cardPresent: { countries: string; kind: CardPresentKind; note?: string },
  otherNotes: Record<string, string> = {}
): Record<string, ProviderAvailability> {
  const cp = new Set(words(cardPresent.countries))
  const out: Record<string, ProviderAvailability> = {}
  for (const c of words(online)) {
    out[c] = cp.has(c)
      ? { online: true, cardPresent: cardPresent.kind, ...(cardPresent.note ? { note: cardPresent.note } : {}) }
      : { online: true, cardPresent: 'none', ...(otherNotes[c] ? { note: otherNotes[c] } : {}) }
  }
  return out
}

const MOLLIE_ONLINE =
  'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LI LT LU MT NL NO PL PT RO SK SI ES SE CH GB IS'
const STRIPE_ONLINE =
  'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LI LT LU MT NL NO PL PT RO SK SI ES SE CH GB'

export const PROVIDER_AVAILABILITY: Record<SelectableProvider, Record<string, ProviderAvailability>> = {
  mollie: build(
    MOLLIE_ONLINE,
    { countries: 'NL BE DE FI PL PT CH DK LU', kind: 'tap-to-pay', note: 'Mollie Tap to Pay on iPhone' },
    { ES: 'Mollie Tap to Pay is not available in Spain' }
  ),
  viva: build('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LU MT NL PL PT RO ES SE GB', {
    countries: 'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LU MT NL PL PT RO ES SE GB',
    kind: 'terminal-app',
    note: 'Viva.com Terminal app on the staff phone',
  }),
  stripe: build(STRIPE_ONLINE, {
    countries: 'AT BE CH CZ DE DK ES FI FR GB IE IT LU NL PL PT SE',
    kind: 'tap-to-pay',
    note: 'Tap to Pay in the Sunbnb Floor app',
  }),
}

const PROVIDER_ORDER: SelectableProvider[] = ['mollie', 'viva', 'stripe']

export function availabilityFor(
  provider: SelectableProvider,
  country: string | null | undefined
): ProviderAvailability {
  const code = typeof country === 'string' ? country.trim().toUpperCase() : ''
  if (!code) return { online: false, cardPresent: 'none', note: 'country-unknown' }
  return (
    PROVIDER_AVAILABILITY[provider][code] ?? { online: false, cardPresent: 'none', note: 'not-available' }
  )
}

/** Providers that can take online payments in `country`, in display order. */
export function availableProviders(country: string | null | undefined): SelectableProvider[] {
  return PROVIDER_ORDER.filter((p) => availabilityFor(p, country).online)
}
