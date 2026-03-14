import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { redirect } from 'next/navigation'
import OnboardingView from './view'

export default async function OnboardingPage() {
  const session = await auth()
  if (!session?.user) return null

  const account = await prisma.partnerAccount.findUnique({
    where: { userId: session.user.id },
    select: {
      firstName: true,
      lastName: true,
      email: true,
      phoneNumber: true,
      company: true,
      businessId: true,
      websiteUrl: true,
      address: true,
      city: true,
      postalCode: true,
      country: true,
      bankAccount: true,
      mollieAccessToken: true,
      mollieProfileId: true,
      mollieOnboardingStatus: true,
    },
  })

  // If account exists and Mollie is connected, skip onboarding
  if (account?.company && account?.mollieAccessToken) {
    redirect('/dashboard')
  }

  const hasAccount = !!account?.company

  // Default account data from session user if no account yet
  const defaultAccount = account?.company
    ? {
        firstName: account.firstName,
        lastName: account.lastName,
        email: account.email,
        phoneNumber: account.phoneNumber,
        company: account.company,
        businessId: account.businessId,
        websiteUrl: account.websiteUrl,
        address: account.address,
        city: account.city,
        postalCode: account.postalCode,
        country: account.country,
        bankAccount: account.bankAccount,
      }
    : {
        firstName: session.user.name?.split(' ')[0] ?? '',
        lastName: session.user.name?.split(' ').slice(1).join(' ') ?? '',
        email: session.user.email ?? '',
        phoneNumber: '',
        company: '',
        businessId: '',
        websiteUrl: '',
        address: '',
        city: '',
        postalCode: '',
        country: '',
        bankAccount: '',
      }

  return (
    <OnboardingView
      defaultAccount={defaultAccount}
      hasAccount={hasAccount}
      mollieConnected={!!account?.mollieAccessToken}
      mollieProfileId={account?.mollieProfileId ?? null}
      mollieOnboardingStatus={account?.mollieOnboardingStatus ?? null}
      partnerData={
        account?.company
          ? {
              firstName: account.firstName,
              lastName: account.lastName,
              email: account.email,
              company: account.company,
              address: account.address,
              city: account.city,
              postalCode: account.postalCode,
              country: account.country,
            }
          : null
      }
    />
  )
}
