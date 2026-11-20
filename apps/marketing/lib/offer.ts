/**
 * Offer block + founder-led promise (track 027 D8). There is NO public launch offer: the public
 * "30 days free" offer was retired on 2026-11-19 (CR-003). Terms for any individual offer are agreed
 * one to one with the venue and are never published here. `null` hides the block entirely;
 * `offer.test.ts` fails the build if a launch offer or placeholder text reappears.
 */
import type { Locale } from './places.ts'

export interface Offer {
  /** e.g. a launch discount or free setup, with its exact conditions and end date. */
  launchOffer: string | null
  /** The one-glance form for the immersive first screen; the full terms are one tap away. Null iff launchOffer is. */
  launchOfferShort: string | null
  /** e.g. a personal setup guarantee the founder can actually deliver. */
  founderPromise: string | null
}

// Launch-offer billing (`@repo/data/promotion`) still honours partners granted before CR-003,
// but grants no new ones, and nothing public advertises it.
export const OFFERS: Record<Locale, Offer> = {
  en: {
    launchOffer: null,
    launchOfferShort: null,
    founderPromise: null,
  },
  es: {
    launchOffer: null,
    launchOfferShort: null,
    founderPromise: null,
  },
  fi: {
    launchOffer: null,
    launchOfferShort: null,
    founderPromise: null,
  },
}

export function offerFor(locale: Locale): Offer | null {
  const o = OFFERS[locale]
  return o.launchOffer || o.founderPromise ? o : null
}
