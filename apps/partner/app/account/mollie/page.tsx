import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import MollieView from './view'

export default async function MolliePage({ searchParams }: { searchParams: { [key: string]: string } }) {
  const session = await auth()
  if (!session?.user) return null

  const account = await prisma.partnerAccount.findUnique({
    where: { userId: session.user.id },
    select: {
      firstName: true,
      lastName: true,
      email: true,
      company: true,
      address: true,
      mollieProfileId: true,
      mollieAccessToken: true,
      mollieOnboardingStatus: true,
    },
  })

  return (
    <MollieView
      isConnected={!!account?.mollieAccessToken}
      profileId={account?.mollieProfileId ?? null}
      onboardingStatus={account?.mollieOnboardingStatus ?? null}
      success={searchParams.success === 'true'}
      error={searchParams.error ?? null}
      partnerData={account ? {
        firstName: account.firstName,
        lastName: account.lastName,
        email: account.email,
        company: account.company,
        address: account.address,
      } : null}
    />
  )
}
