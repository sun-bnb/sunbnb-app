import prisma from '@repo/data/PrismaCient'
import { getEffectiveSubscriptionForUser } from '@repo/data/subscription'

/**
 * Server-side plan gates for site settings (CR-002). The UI hides gated options but
 * the action is the boundary. Returns an error string, or null when allowed.
 * "Pay on site" (type 'unpaid') is never gated here.
 */
export type GatedFeature = 'ONLINE_PAYMENTS' | 'FOOD_AND_BEVERAGE'

const COPY: Record<GatedFeature, string> = {
  ONLINE_PAYMENTS:
    'Online card payments are not included in your plan. Upgrade your plan to accept online payments.',
  FOOD_AND_BEVERAGE:
    'Food and drink ordering is not included in your plan. Upgrade your plan to enable it.',
}

export async function planGateError(
  userId: string,
  needs: readonly GatedFeature[],
): Promise<string | null> {
  const effective = await getEffectiveSubscriptionForUser(userId)
  for (const feature of needs) {
    if (!effective.features[feature]) return COPY[feature]
  }
  return null
}

/**
 * Site-scoped variant: gates on the SITE OWNER's plan, not the caller's — a sudo admin
 * editing a partner's site must see the partner's entitlements, not their own.
 */
export async function sitePlanGateError(
  siteId: string,
  needs: readonly GatedFeature[],
): Promise<string | null> {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  // A missing site has nothing to gate; the action's own ownership / update path refuses it.
  if (!site?.userId) return null
  return planGateError(site.userId, needs)
}
