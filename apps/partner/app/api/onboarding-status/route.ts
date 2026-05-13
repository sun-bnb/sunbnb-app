import { NextResponse } from 'next/server'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { fetchMollieProfile } from '@/app/api/_lib/mollie'

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ hasAccount: false, hasMollie: false })
  }

  const [account, integratedPaymentsSites] = await Promise.all([
    prisma.partnerAccount.findUnique({
      where: { userId: session.user.id },
      select: {
        company: true,
        mollieAccessToken: true,
        mollieOnboardingStatus: true,
      },
    }),
    prisma.site.findMany({
      where: {
        userId: session.user.id,
        OR: [
          { type: 'paid' },
          { orderPaymentType: 'paid' },
          { rentalPaymentType: 'paid' },
        ],
      },
      select: { id: true },
      take: 1,
    }),
  ])

  // Live-sync the onboarding status while it's not yet completed. Mollie does
  // not push onboarding events, so without this the cached DB value can stay
  // stale until the partner manually visits /account/mollie. Once the partner
  // is 'completed', we stop querying Mollie on every page transition.
  let mollieOnboardingStatus = account?.mollieOnboardingStatus ?? null
  if (account?.mollieAccessToken && mollieOnboardingStatus !== 'completed') {
    try {
      const profile = await fetchMollieProfile(account.mollieAccessToken)
      if (profile.onboardingStatus && profile.onboardingStatus !== 'unknown') {
        if (profile.onboardingStatus !== mollieOnboardingStatus) {
          await prisma.partnerAccount.update({
            where: { userId: session.user.id },
            data: { mollieOnboardingStatus: profile.onboardingStatus },
          })
        }
        mollieOnboardingStatus = profile.onboardingStatus
      }
    } catch (err: any) {
      console.error('[OnboardingStatus] Live sync failed, using cached value:', err?.message)
    }
  }

  return NextResponse.json({
    hasAccount: !!account?.company,
    hasMollie: !!account?.mollieAccessToken,
    mollieOnboardingStatus,
    hasIntegratedPayments: integratedPaymentsSites.length > 0,
  })
}
