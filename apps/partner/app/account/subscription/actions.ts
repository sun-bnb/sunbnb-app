'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { revalidatePath } from 'next/cache'
import type { SubscriptionTier } from '@prisma/client'
import {
  getPartnerSubscription,
  resolveEffectiveSubscription,
  setPartnerPlan,
  type PlanFitIssues,
} from '@repo/data/subscription'
import { PRICING_TIERS, PRICING_TIER_ORDER } from '@repo/data/pricing-tiers'

export async function getSubscriptionData() {
  const session = await auth()
  if (!session?.user) return null

  const subscription = await getPartnerSubscription(session.user.id!)
  // Every plan's monthly price is 0, so order by the catalogue ladder (Free, Pro, Business).
  const plans = (await prisma.subscriptionPlan.findMany()).sort(
    (a, b) => PRICING_TIER_ORDER.indexOf(a.tier) - PRICING_TIER_ORDER.indexOf(b.tier),
  )

  const siteCount = await prisma.site.count({
    where: { userId: session.user.id! },
  })

  const customSubscription = await prisma.customSubscription.findUnique({
    where: { partnerAccountId: session.user.id! },
    select: { maxSites: true },
  })

  const effective = resolveEffectiveSubscription(
    subscription?.plan ?? null,
    customSubscription ?? null,
  )

  return {
    subscription,
    plans,
    siteCount,
    effectiveMaxSites: effective.maxSites,
    isCustomMaxSites: effective.isCustom,
  }
}

/**
 * The partner switches its own plan between the self-serve plans (Free ⇄ Pro).
 * Business is a custom agreement set up by us in admin, so `setPartnerPlan`
 * refuses it here, and refuses a downgrade the partner's venues don't fit
 * (`issues` names what is over). No billing: no plan has a monthly price.
 */
export async function switchPlan(
  tier: string,
): Promise<{ status: 'ok' | 'error'; errors?: string[]; issues?: PlanFitIssues }> {
  const session = await auth()
  if (!session?.user?.id) return { status: 'error', errors: ['Not authenticated'] }
  if (!(tier in PRICING_TIERS)) return { status: 'error', errors: ['Unknown plan'] }

  const result = await setPartnerPlan(session.user.id, tier as SubscriptionTier, 'partner')
  if (result.status === 'error') return { status: 'error', errors: result.errors, issues: result.issues }

  revalidatePath('/account/subscription')
  return { status: 'ok' }
}
