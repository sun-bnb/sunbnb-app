/**
 * Pricing Tier Catalog — the published partner pricing ladder.
 *
 * CLIENT-SAFE: pure data, no prisma import (the type import is erased at
 * compile time). The partner landing page and the in-app plan cards are client
 * components and read this directly, so the marketing copy and the seeded
 * database rows can never drift apart. Keep it that way — `subscription.ts`
 * re-exports everything here for server callers.
 */
import type { SubscriptionTier } from '@prisma/client'

/**
 * What each plan costs, how many sites it allows, and the commission the
 * platform takes on every consumer purchase.
 *
 * This is a SEED source, not a runtime shortcut. `prisma/seed-subscriptions.ts`
 * projects it onto `SubscriptionPlan` rows and onto the platform-level
 * `ServiceFee` rows (one per tier × commissioned service code, on every
 * `Settings` row). Fee resolution during a charge still goes through the
 * site → partnerAccount → settings cascade in `resolveServiceFee` — a partner
 * with a negotiated site/account fee keeps it, and an admin can edit the
 * platform rows without a deploy. Nothing here is read while charging.
 */
export const PRICING_TIERS = {
  STARTER:  { name: 'Starter',  monthlyPrice: 0,  maxSites: 1,  commissionPercent: 6   },
  PRO:      { name: 'Pro',      monthlyPrice: 29, maxSites: 3,  commissionPercent: 3   },
  BUSINESS: { name: 'Business', monthlyPrice: 79, maxSites: 10, commissionPercent: 1.5 },
} as const satisfies Record<
  SubscriptionTier,
  { name: string; monthlyPrice: number; maxSites: number; commissionPercent: number }
>

/** Ascending order of the ladder — cheapest first. Used by the seed, the cards and the tests. */
export const PRICING_TIER_ORDER = ['STARTER', 'PRO', 'BUSINESS'] as const satisfies readonly SubscriptionTier[]

/** The tier the plan cards mark as the recommended one. */
export const FEATURED_TIER: SubscriptionTier = 'PRO'

/**
 * Service codes the tier commission applies to — every consumer purchase that
 * flows through Sunbnb. Codes outside this list fall back to the tier-null
 * platform default in the cascade.
 */
export const COMMISSIONED_SERVICE_CODES = [
  'sunbed-rental',
  'food-and-beverage',
  'equipment-rental',
] as const
