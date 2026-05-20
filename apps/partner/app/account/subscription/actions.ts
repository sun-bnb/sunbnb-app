'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getPartnerSubscription, resolveEffectiveSubscription } from '@repo/data/subscription'

export async function getSubscriptionData() {
  const session = await auth()
  if (!session?.user) return null

  const subscription = await getPartnerSubscription(session.user.id!)
  const plans = await prisma.subscriptionPlan.findMany({
    orderBy: { monthlyPrice: 'asc' },
  })

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
