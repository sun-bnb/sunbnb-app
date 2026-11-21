/**
 * Pricing Plan Catalog — Starter / Pro / Business.
 *
 *   Starter   free           6% commission   1 site
 *   Pro       EUR 29 / month  3% commission   up to 3 sites
 *   Business  EUR 79 / month  1.5% commission up to 10 sites
 *
 * The same rate applies to every purchase through Sunbnb (sunbeds, food and
 * drink, rentals). Card payments at the venue (Viva terminal, Tap to Pay) take
 * no commission on any plan (`isCardPresentRef`).
 *
 * History: CR-002 (2026-11-19) replaced this ladder with Gratis / Temporada /
 * Grupo (free, 2% capped at EUR 199, quote-only), shown as Free / Pro /
 * Business; the next day the founder went back to this ladder. The CR-002
 * machinery is kept for later, inert under these values: the per-site sunbed
 * limit (`maxHamacasPerSite`, null = none), the monthly commission cap ledger
 * (`monthlyCommissionCapPerSite`, null = uncapped), quote-only plans
 * (`quoteOnly`), admin-only plans (`selfServe`) and custom agreements
 * (CustomSubscription + account-level ServiceFee rows).
 *
 * CLIENT-SAFE: pure data, no prisma import (the type import is erased at
 * compile time). The partner landing page and the in-app plan cards are client
 * components and read this directly, so the marketing copy and the seeded
 * database rows can never drift apart. Keep it that way — `subscription.ts`
 * re-exports everything here for server callers.
 */
import type { SubscriptionTier } from '@prisma/client'

/**
 * Service codes the plan commission applies to — every consumer purchase that
 * flows through Sunbnb. Codes outside this list fall back to the tier-null
 * platform default in the cascade, so the seed writes an explicit row for each
 * of these on every plan.
 */
export const COMMISSIONED_SERVICE_CODES = [
  'sunbed-rental',
  'food-and-beverage',
  'equipment-rental',
] as const

export type CommissionedServiceCode = (typeof COMMISSIONED_SERVICE_CODES)[number]

/** Service codes the monthly per-site commission cap counts (sunbeds + rentals, never F&B). */
export const CAPPED_SERVICE_CODES = ['sunbed-rental', 'equipment-rental'] as const satisfies readonly CommissionedServiceCode[]

export type PricingTierSpec = {
  /** Plan name shown to partners — identical in every language. */
  name: string
  /** Fixed monthly price (EUR, excl. IVA), billed through Stripe; 0 = free, no checkout. */
  monthlyPrice: number
  /** Sites allowed; `null` = no limit (or set per agreement in a CustomSubscription). */
  maxSites: number | null
  /** Hamacas (loungers, one InventoryItem each) per site; `null` = no limit. */
  maxHamacasPerSite: number | null
  /** Platform commission percent per service code, taken on online-paid purchases only. */
  commissionPercent: Record<CommissionedServiceCode, number>
  /** Monthly cap (EUR, excl. IVA) on plan-rate sunbed + rental commission per site; `null` = uncapped. */
  monthlyCommissionCapPerSite: number | null
  /** Guests can pay online by card on this plan. */
  onlinePayments: boolean
  /** Food and drink ordering (menu, orders, tabs, card-paid table deposits). */
  foodAndBeverage: boolean
  /** Off-platform billing: availability-only (unpaid) sites where guests pay on site. */
  offPlatformBilling: boolean
  /** The site's guest booking pages can carry the partner's own brand (brand tab). */
  brandedBookingPage: boolean
  /** Support level shown on the plan card. */
  support: 'community' | 'priority' | 'dedicated'
  /** No public price: the card shows a quote request and there is no checkout. */
  quoteOnly: boolean
  /** A partner may move onto this plan itself (checkout or downgrade); false = only we set it, in admin. */
  selfServe: boolean
}

/**
 * The published plans.
 *
 * This is a SEED source, not a runtime shortcut. `prisma/seed-subscriptions.ts`
 * (and the data-move migrations) project it onto `SubscriptionPlan` rows and
 * onto the platform-level `ServiceFee` rows (one per tier × commissioned
 * service code, on every `Settings` row). Fee resolution during a charge still
 * goes through the site → partnerAccount → settings cascade in
 * `resolveServiceFee` — a negotiated site/account fee keeps winning, and an
 * admin can edit the platform rows without a deploy. Stripe product / price
 * ids are per environment and set on the plan rows out of band.
 */
export const PRICING_TIERS = {
  STARTER: {
    name: 'Starter',
    monthlyPrice: 0,
    maxSites: 1,
    maxHamacasPerSite: null,
    commissionPercent: { 'sunbed-rental': 6, 'food-and-beverage': 6, 'equipment-rental': 6 },
    monthlyCommissionCapPerSite: null,
    onlinePayments: true,
    foodAndBeverage: true,
    offPlatformBilling: false,
    brandedBookingPage: false,
    support: 'community',
    quoteOnly: false,
    selfServe: true,
  },
  PRO: {
    name: 'Pro',
    monthlyPrice: 29,
    maxSites: 3,
    maxHamacasPerSite: null,
    commissionPercent: { 'sunbed-rental': 3, 'food-and-beverage': 3, 'equipment-rental': 3 },
    monthlyCommissionCapPerSite: null,
    onlinePayments: true,
    foodAndBeverage: true,
    offPlatformBilling: true,
    brandedBookingPage: false,
    support: 'priority',
    quoteOnly: false,
    selfServe: true,
  },
  BUSINESS: {
    name: 'Business',
    monthlyPrice: 79,
    maxSites: 10,
    maxHamacasPerSite: null,
    commissionPercent: { 'sunbed-rental': 1.5, 'food-and-beverage': 1.5, 'equipment-rental': 1.5 },
    monthlyCommissionCapPerSite: null,
    onlinePayments: true,
    foodAndBeverage: true,
    offPlatformBilling: true,
    brandedBookingPage: true,
    support: 'dedicated',
    quoteOnly: false,
    selfServe: true,
  },
} as const satisfies Record<SubscriptionTier, PricingTierSpec>

/**
 * "No site limit". `SubscriptionPlan.maxSites` is NOT NULL, so a plan without a
 * limit stores this sentinel; screens show any value at or above it as ∞.
 */
export const UNLIMITED_SITES = 999

/** Display order of the plans — free first. Used by the seed, the cards and the tests. */
export const PRICING_TIER_ORDER = ['STARTER', 'PRO', 'BUSINESS'] as const satisfies readonly SubscriptionTier[]

/** The plan a partner without a subscription is on. */
export const DEFAULT_TIER: SubscriptionTier = 'STARTER'

/** The tier the plan cards mark as the recommended one. */
export const FEATURED_TIER: SubscriptionTier = 'PRO'

/** `maxSites` as stored on the `SubscriptionPlan` row (the column is NOT NULL). */
export function planRowMaxSites(tier: SubscriptionTier): number {
  return PRICING_TIERS[tier].maxSites ?? UNLIMITED_SITES
}
