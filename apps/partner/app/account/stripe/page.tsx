import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import StripeView from './view'

export default async function StripePage() {
  const session = await auth()
  if (!session?.user?.id) return null

  const account = await prisma.partnerAccount.findUnique({
    where: { userId: session.user.id },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      phoneNumber: true,
      company: true,
      address: true,
      city: true,
      postalCode: true,
      country: true,
      businessId: true,
      stripeConnectAccountId: true,
      stripeConnectDetailsSubmitted: true,
      stripeConnectOnboardingStatus: true,
      stripeConnectRequirementsDue: true,
    },
  })

  return (
    <StripeView
      account={{
        email: account?.email || session.user.email || '',
        firstName: account?.firstName ?? '',
        lastName: account?.lastName ?? '',
        phone: account?.phoneNumber ?? '',
        company: account?.company ?? '',
        address: account?.address ?? '',
        city: account?.city ?? '',
        postalCode: account?.postalCode ?? '',
        country: account?.country ?? null,
        businessId: account?.businessId ?? '',
      }}
      stripeConnectAccountId={account?.stripeConnectAccountId ?? null}
      detailsSubmitted={!!account?.stripeConnectDetailsSubmitted}
      onboardingStatus={account?.stripeConnectOnboardingStatus ?? null}
      requirementsDue={account?.stripeConnectRequirementsDue ?? []}
    />
  )
}
