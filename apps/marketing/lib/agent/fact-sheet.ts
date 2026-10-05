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
 * Feature facts live in `knowledge.ts` (one verified entry per topic, with its status);
 * this file assembles them with the pricing ladder and the questions that go to the team.
 */
import { PRICING_TIERS, PRICING_TIER_ORDER } from '@repo/data/pricing-tiers'
import { KNOWLEDGE } from './knowledge.ts'
import { renderKnowledge } from './knowledge-schema.ts'

/** Questions the agent must NOT answer from its own knowledge — it routes them to the team. */
export const ASK_THE_TEAM = [
  'how many venues or customers use Sunbnb, and booking volumes',
  'expected revenue increase or any other results',
  'onboarding time and availability in a specific country',
  'custom integrations, discounts or negotiated pricing',
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
    'PRODUCT KNOWLEDGE (verified; each topic says whether it is available today, coming, or not offered)',
    renderKnowledge(KNOWLEDGE),
    '',
    'PRICING',
    plans,
    'Commission is charged only on purchases made through Sunbnb. It is deducted from the venue\'s revenue; guests pay only the venue\'s listed price.',
    'Pro adds off-platform billing and priority support. Business adds the branded booking page and dedicated support.',
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
  for (const e of KNOWLEDGE) for (const f of e.figures ?? []) figures.add(f)
  return [...figures]
}
