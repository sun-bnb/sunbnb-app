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

// Launch offer: founder decision 2026-10-05, ENFORCED by billing (`@repo/data/promotion`:
// commission waived at every charge point, Stripe plan trial) — change the copy and the code together.
export const OFFERS: Record<Locale, Offer> = {
  en: {
    launchOffer: 'Launch offer: no commission and no monthly fees for 30 days from your first paid booking — for beaches that join by 31 May 2027.',
    founderPromise: null,
  },
  es: {
    launchOffer: 'Oferta de lanzamiento: sin comisión ni cuotas mensuales durante 30 días desde tu primera reserva pagada, para playas que se unan hasta el 31 de mayo de 2027.',
    founderPromise: null,
  },
  fi: {
    launchOffer: 'Lanseeraustarjous: ei provisiota eikä kuukausimaksuja 30 päivään ensimmäisestä maksetusta varauksesta – rannoille, jotka liittyvät 31.5.2027 mennessä.',
    founderPromise: null,
  },
}

export function offerFor(locale: Locale): Offer | null {
  const o = OFFERS[locale]
  return o.launchOffer || o.founderPromise ? o : null
}
