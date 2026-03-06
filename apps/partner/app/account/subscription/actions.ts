'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getPartnerSubscription } from '@repo/data/subscription'

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

  return {
    subscription,
    plans,
    siteCount,
  }
}
