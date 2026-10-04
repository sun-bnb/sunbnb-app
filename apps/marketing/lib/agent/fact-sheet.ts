/**
 * The ONLY product facts the lead agent may state.
 *
 * The worst failure this feature can have is the agent telling a prospect something untrue —
 * a made-up price, customer count or revenue uplift. So the agent is grounded in this sheet and
 * told to say "I'm not sure, the team can confirm" for anything it doesn't cover. The eval
 * harness (`eval/scorers.ts`) derives its allow-list of figures from here, so a number the agent
 * quotes that is not on this sheet (or said by the prospect) fails the run.
 *
 * Pricing is read from `@repo/data/pricing-tiers` — the same source the billing seed and the
 * partner landing page use — so the agent can never quote a stale price.
 *
 * Keep entries conservative: list what is shipped, not what is planned.
 */
import { PRICING_TIERS, PRICING_TIER_ORDER } from '@repo/data/pricing-tiers'

export const PRODUCT_LANGUAGES = ['English', 'Spanish', 'Finnish'] as const

export const FEATURES = [
  'Interactive sunbed map: the venue lays out its sunbeds, rows and pairs on a satellite map; guests pick their exact sunbed.',
  'Online sunbed reservations by the day, paid by card, with a QR pass the staff can scan on arrival.',
  'Guests can book without creating an account.',
  'Food & drink ordering from the guest\'s phone by scanning a QR code at the sunbed or table, paid in the same flow.',
  'Equipment rentals (surfboards, paddleboards, kayaks, pedal boats, snorkel gear), by the hour or by the day.',
  'Restaurant table reservations with a floor plan and a waitlist.',
  'On-site staff view: walk-ins, check-ins, cash sales and a per-employee till.',
  'Automatic invoicing with VAT handling, and monthly settlement reports.',
  'Branded booking page for the venue (Business plan).',
  'Runs in the browser on phones, tablets and laptops the venue already has; no hardware to buy and no app for guests to download.',
] as const

export const PAYMENTS =
  'Guest payments are processed by Mollie, a licensed European payment provider. The venue connects its own Mollie account and receives the money there. Cash sales can also be recorded.'

/** Questions the agent must NOT answer from its own knowledge — it routes them to the team. */
export const ASK_THE_TEAM = [
  'how many venues or customers use Sunbnb, and booking volumes',
  'expected revenue increase or any other results',
  'onboarding time and availability in a specific country',
  'custom integrations, discounts or negotiated pricing',
  'hardware such as sunbed lights or sensors',
  'legal or tax advice',
] as const

export function renderFactSheet(): string {
  const plans = PRICING_TIER_ORDER.map((tier) => {
    const p = PRICING_TIERS[tier]
    const price = p.monthlyPrice === 0 ? 'free' : `€${p.monthlyPrice} per month`
    const sites = p.maxSites === 1 ? '1 venue' : `up to ${p.maxSites} venues`
    return `- ${p.name}: ${price}, ${p.commissionPercent}% commission on each purchase made through Sunbnb, ${sites}.`
  }).join('\n')

  return [
    'WHAT SUNBNB IS',
    'Sunbnb is software for beach clubs, sunbed concessions, hotels and beach restaurants to take sunbed reservations, food & drink orders and rentals online.',
    '',
    'FEATURES',
    ...FEATURES.map((f) => `- ${f}`),
    '',
    'PRICING',
    plans,
    'Commission is charged only on purchases made through Sunbnb. It is deducted from the venue\'s revenue; guests pay only the venue\'s listed price.',
    'Pro adds off-platform billing and priority support. Business adds the branded booking page and dedicated support.',
    '',
    'PAYMENTS',
    PAYMENTS,
    '',
    'LANGUAGES',
    `The Sunbnb apps are available in ${PRODUCT_LANGUAGES.join(', ')}.`,
    '',
    'ALWAYS REFER TO THE TEAM (never answer yourself)',
    ...ASK_THE_TEAM.map((q) => `- ${q}`),
  ].join('\n')
}

/** Every number the fact sheet states — the allow-list the eval scorer checks quoted figures against. */
export function factSheetFigures(): number[] {
  const figures = new Set<number>()
  for (const tier of PRICING_TIER_ORDER) {
    const p = PRICING_TIERS[tier]
    figures.add(p.monthlyPrice)
    figures.add(p.commissionPercent)
    figures.add(p.maxSites)
  }
  return [...figures]
}
