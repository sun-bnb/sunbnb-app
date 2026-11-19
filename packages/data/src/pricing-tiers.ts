/**
 * Pricing Plan Catalog — Free / Pro / Business (CR-002, decision F-9; shown as
 * Gratis / Temporada / Grupo until 2026-11-19, the code keys still carry those names).
 *
 * CLIENT-SAFE: pure data, no prisma import (the type import is erased at
 * compile time). The partner landing page and the in-app plan cards are client
 * components and read this directly, so the marketing copy and the seeded
 * database rows can never drift apart. Keep it that way — `subscription.ts`
 * re-exports everything here for server callers.
 *
 * Enum keys: `SubscriptionTier` values are GRATIS / TEMPORADA / GRUPO in code,
 * stored in Postgres under the legacy labels STARTER / PRO / BUSINESS via
 * Prisma `@map` (no enum DDL; clients deployed on the shared TEST DB keep
 * reading the same labels). Renaming the stored labels is optional later
 * cleanup.
 */
import type { SubscriptionTier } from '@prisma/client'

/**
 * Service codes the plan commission applies to — every consumer purchase that
 * flows through Sunbnb. Codes outside this list fall back to the tier-null
 * platform default in the cascade. F&B stays listed so the seed writes an
 * explicit 0% row for it on every plan (otherwise it would fall through to the
 * tier-null default).
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
  /** The site's guest booking pages can carry the partner's own brand (brand tab). */
  brandedBookingPage: boolean
  /** Fixed monthly price (EUR, excl. IVA). Every plan is 0: Temporada is commission-only, Grupo is quote-only. */
  monthlyPrice: number
  /** Sites allowed; `null` = set per agreement (CustomSubscription). */
  maxSites: number | null
  /** Hamacas (loungers, one InventoryItem each) per site; `null` = set per agreement. */
  maxHamacasPerSite: number | null
  /** Platform commission percent per service code, taken on online-paid purchases only. */
  commissionPercent: Record<CommissionedServiceCode, number>
  /** Monthly cap (EUR, excl. IVA) on plan-rate sunbed + rental commission per site; `null` = uncapped / n/a. */
  monthlyCommissionCapPerSite: number | null
  /** Guests can pay online by card on this plan. */
  onlinePayments: boolean
  /** No public price: the card shows a quote request and there is no checkout. */
  quoteOnly: boolean
  /**
   * A partner may switch itself onto this plan from the subscription page.
   * Business is not: it is a custom agreement set up by us in admin.
   */
  selfServe: boolean
}

/**
 * The published plans.
 *
 * This is a SEED source, not a runtime shortcut. `prisma/seed-subscriptions.ts`
 * (and the data-move migration `..._pricing_catalogue_data_move`) project it
 * onto `SubscriptionPlan` rows and onto the platform-level `ServiceFee` rows
 * (one per tier × commissioned service code, on every `Settings` row). Fee
 * resolution during a charge still goes through the site → partnerAccount →
 * settings cascade in `resolveServiceFee` — a negotiated site/account fee keeps
 * winning, and an admin can edit the platform rows without a deploy.
 *
 * Grupo: limits and fees are negotiated per partner (CustomSubscription,
 * account-level ServiceFee). Until a partner's agreement is recorded, its
 * platform rows carry Temporada's rate and cap so no one pays more by moving
 * to Grupo; the DB plan row's `maxSites` falls back to GRUPO_DEFAULT_MAX_SITES.
 */
export const PRICING_TIERS = {
  GRATIS: {
    name: 'Free',
    brandedBookingPage: false,
    monthlyPrice: 0,
    maxSites: 1,
    maxHamacasPerSite: 100,
    commissionPercent: { 'sunbed-rental': 0, 'food-and-beverage': 0, 'equipment-rental': 0 },
    monthlyCommissionCapPerSite: null,
    onlinePayments: false,
    quoteOnly: false,
    selfServe: true,
  },
  TEMPORADA: {
    name: 'Pro',
    brandedBookingPage: false,
    monthlyPrice: 0,
    maxSites: 3,
    maxHamacasPerSite: 300,
    commissionPercent: { 'sunbed-rental': 2, 'food-and-beverage': 0, 'equipment-rental': 2 },
    monthlyCommissionCapPerSite: 199,
    onlinePayments: true,
    quoteOnly: false,
    selfServe: true,
  },
  GRUPO: {
    name: 'Business',
    brandedBookingPage: true,
    monthlyPrice: 0,
    maxSites: null,
    maxHamacasPerSite: null,
    commissionPercent: { 'sunbed-rental': 2, 'food-and-beverage': 0, 'equipment-rental': 2 },
    monthlyCommissionCapPerSite: 199,
    onlinePayments: true,
    quoteOnly: true,
    selfServe: false,
  },
} as const satisfies Record<SubscriptionTier, PricingTierSpec>

/**
 * "No site limit". `SubscriptionPlan.maxSites` is NOT NULL, so a plan without a
 * limit stores this sentinel; screens show any value at or above it as ∞.
 */
export const UNLIMITED_SITES = 999

/**
 * Sites a Business partner gets until its agreement records a limit in a
 * CustomSubscription: unlimited. Written to the Business `SubscriptionPlan.maxSites`
 * row; the resolver reads the catalogue rather than the row, so an old row value
 * (10, before 2026-11-19) does not cap anyone.
 */
export const GRUPO_DEFAULT_MAX_SITES = UNLIMITED_SITES

/** Display order of the plans — free first. Used by the seed, the cards and the tests. */
export const PRICING_TIER_ORDER = ['GRATIS', 'TEMPORADA', 'GRUPO'] as const satisfies readonly SubscriptionTier[]

/** The plan a partner without a subscription is on. */
export const DEFAULT_TIER: SubscriptionTier = 'GRATIS'

/** The tier the plan cards mark as the recommended one. */
export const FEATURED_TIER: SubscriptionTier = 'TEMPORADA'

/** `maxSites` as stored on the `SubscriptionPlan` row (the column is NOT NULL). */
export function planRowMaxSites(tier: SubscriptionTier): number {
  return PRICING_TIERS[tier].maxSites ?? GRUPO_DEFAULT_MAX_SITES
}
