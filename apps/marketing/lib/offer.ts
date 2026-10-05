/**
 * Launch offer + founder-led promise (track 027 D8) — the page's proof, since we use no invented
 * testimonials or numbers. FOUNDER-SUPPLIED TERMS ONLY: `null` hides the block entirely, so the
 * page is honest before the terms exist. Fill per locale; `offer.test.ts` fails the build if any
 * placeholder/TODO text is left in.
 */
import type { Locale } from './places.ts'

export interface Offer {
  /** e.g. a launch discount or free setup, with its exact conditions and end date. */
  launchOffer: string | null
  /** e.g. a personal setup guarantee the founder can actually deliver. */
  founderPromise: string | null
}

export const OFFERS: Record<Locale, Offer> = {
  en: { launchOffer: null, founderPromise: null },
  es: { launchOffer: null, founderPromise: null },
  fi: { launchOffer: null, founderPromise: null },
}

export function offerFor(locale: Locale): Offer | null {
  const o = OFFERS[locale]
  return o.launchOffer || o.founderPromise ? o : null
}
