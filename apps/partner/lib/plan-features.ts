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
