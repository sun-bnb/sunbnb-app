import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { isSelectableProvider, selectedProvider } from '@repo/data/payment-providers/readiness'
import { AccountProps } from './view'
import AccountView from './view'
  
export default async function Account() {

  const session = await auth()

  if (!session) return null
  const { user } = session

  const dbAccount = await prisma.partnerAccount.findUnique({
    where: { userId: user.id },
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
      mollieOnboardingStatus: true,
      vivaAccountId: true,
      vivaVerificationStatus: true,
      paymentProvider: true,
    },
  })
  const firstSite = await prisma.site.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
    select: { paymentProvider: true },
  })

  let account: AccountProps
  if (!dbAccount) {
    const [ firstName, lastName ] = user.name.split(' ')
    account = {
      firstName,
      lastName,
      email: user.email,
      phoneNumber: '',
      company: '',
      businessId: '',
      websiteUrl: '',
      address: '',
      city: '',
      postalCode: '',
      country: '',
      bankAccount: ''
    }
  } else {
    account = {
      firstName: dbAccount.firstName,
      lastName: dbAccount.lastName,
      email: dbAccount.email,
      phoneNumber: dbAccount.phoneNumber,
      company: dbAccount.company,
      businessId: dbAccount.businessId,
      websiteUrl: dbAccount.websiteUrl,
      address: dbAccount.address,
      city: dbAccount.city,
      postalCode: dbAccount.postalCode,
      country: dbAccount.country,
      bankAccount: dbAccount.bankAccount,
    }
  }

  const mollieStatus = {
    isConnected: !!dbAccount?.mollieAccessToken,
    onboardingStatus: dbAccount?.mollieOnboardingStatus ?? null,
  }

  const vivaStatus = {
    isConnected: !!dbAccount?.vivaAccountId,
    verificationStatus: dbAccount?.vivaVerificationStatus ?? null,
  }

  const providerStatus = {
    selected: selectedProvider({ paymentProvider: dbAccount?.paymentProvider ?? null }),
    effective: isSelectableProvider(firstSite?.paymentProvider) ? firstSite.paymentProvider : null,
  }

  return <AccountView account={account} mollieStatus={mollieStatus} vivaStatus={vivaStatus} providerStatus={providerStatus} />

}
