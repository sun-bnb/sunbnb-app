/**
 * The prospect's numbers (track 027 P10) — honest by construction:
 *  - the ONLY figures we supply are the plan catalogue (`@repo/data/pricing-tiers`, the one
 *    billing uses) and arithmetic;
 *  - everything else is the prospect's own input: their sunbed price (set in the guest booking),
 *    and — only if they choose to give it — how many sunbeds they'd sell online on a typical day;
 *  - no default occupancy, no uplift, no "extra revenue" claims;
 *  - every output carries a `trace`: the formula with their numbers, shown on "How is this
 *    calculated?".
 * Commission is charged on the price the guest pays (`calculateServiceFeeAmount` in
 * @repo/data/payment applies the percentage to the listed, VAT-inclusive price).
 */
import { PRICING_TIERS, PRICING_TIER_ORDER } from '@repo/data/pricing-tiers'

export type Tier = (typeof PRICING_TIER_ORDER)[number]

export interface ProjectionInput {
  /** Their price per sunbed per day, in euros (1–500). */
  price: number
  /** Their sunbed count (from the mockup). */
  sunbeds: number
  /** Optional: sunbeds sold online on a typical day. Absent → no monthly figures at all. */
  onlinePerDay?: number | null
}

export interface TierLine {
  tier: Tier
  name: string
  monthlyPrice: number
  commissionPercent: number
  /** Commission on one online-booked sunbed-day, and what the venue keeps of it. */
  commissionPerBed: number
  keepPerBed: number
  /** vs Starter: online sunbed-days a month from which this plan costs less. Null for Starter. */
  breakEvenBedDays: number | null
  /** Only with onlinePerDay: Sunbnb's cost for a 30-day month (plan fee + commission). */
  monthlyCost: number | null
  trace: string[]
}

export interface Projection {
  input: Required<Omit<ProjectionInput, 'onlinePerDay'>> & { onlinePerDay: number | null }
  tiers: TierLine[]
  /** Only with onlinePerDay: online revenue in a 30-day month, and the plan that costs least. */
  monthlyOnline: number | null
  cheapest: Tier | null
  trace: string[]
}

export const MONTH_DAYS = 30
const r2 = (n: number) => Math.round(n * 100) / 100
const eur = (n: number) => `€${n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`

/** Validated input, or null — public data (it is also posted to the server). */
export function parseProjectionInput(raw: unknown): ProjectionInput | null {
  if (!raw || typeof raw !== 'object') return null
  const { price, sunbeds, onlinePerDay } = raw as Record<string, unknown>
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 1 || price > 500) return null
  if (!Number.isInteger(sunbeds) || (sunbeds as number) < 1 || (sunbeds as number) > 5000) return null
  let online: number | null = null
  if (onlinePerDay !== undefined && onlinePerDay !== null) {
    if (!Number.isInteger(onlinePerDay) || (onlinePerDay as number) < 0 || (onlinePerDay as number) > (sunbeds as number)) return null
    online = onlinePerDay as number
  }
  return { price, sunbeds: sunbeds as number, onlinePerDay: online }
}

export function project(input: ProjectionInput): Projection {
  const price = r2(input.price)
  const online = input.onlinePerDay ?? null
  const starter = PRICING_TIERS.STARTER
  const monthlyOnline = online === null ? null : r2(online * price * MONTH_DAYS)

  const tiers: TierLine[] = PRICING_TIER_ORDER.map((tier) => {
    const t = PRICING_TIERS[tier]
    const commissionPerBed = r2((price * t.commissionPercent) / 100)
    const trace = [`${t.name}: ${t.commissionPercent}% × ${eur(price)} = ${eur(commissionPerBed)} commission per online sunbed-day; you keep ${eur(r2(price - commissionPerBed))}.`]
    let breakEvenBedDays: number | null = null
    if (tier !== 'STARTER') {
      const savedPerBed = (price * (starter.commissionPercent - t.commissionPercent)) / 100
      breakEvenBedDays = Math.ceil(t.monthlyPrice / savedPerBed)
      trace.push(
        `${t.name} vs Starter: ${eur(t.monthlyPrice)} a month ÷ (${starter.commissionPercent}% − ${t.commissionPercent}%) × ${eur(price)} = ${breakEvenBedDays} online sunbed-days a month to break even.`,
      )
    }
    let monthlyCost: number | null = null
    if (monthlyOnline !== null) {
      monthlyCost = r2(t.monthlyPrice + (monthlyOnline * t.commissionPercent) / 100)
      trace.push(`${t.name} for a ${MONTH_DAYS}-day month: ${eur(t.monthlyPrice)} + ${t.commissionPercent}% × ${eur(monthlyOnline)} = ${eur(monthlyCost)}.`)
    }
    return { tier, name: t.name, monthlyPrice: t.monthlyPrice, commissionPercent: t.commissionPercent, commissionPerBed, keepPerBed: r2(price - commissionPerBed), breakEvenBedDays, monthlyCost, trace }
  })

  let cheapest: Tier | null = null
  if (monthlyOnline !== null) {
    cheapest = tiers.reduce((best, l) => (l.monthlyCost! < best.monthlyCost! ? l : best)).tier
  }
  const trace = monthlyOnline === null ? [] : [`Online in a ${MONTH_DAYS}-day month: ${online} sunbeds × ${eur(price)} × ${MONTH_DAYS} = ${eur(monthlyOnline)} (your estimate).`]
  return { input: { price, sunbeds: input.sunbeds, onlinePerDay: online }, tiers, monthlyOnline, cheapest, trace }
}
