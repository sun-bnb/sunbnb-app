import { redirect } from 'next/navigation'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import type { SelectableProvider } from '@repo/data/payment-refs'
import { availabilityFor } from '@repo/data/payment-providers/availability'
import {
  READINESS_SELECT,
  providerReadiness,
  selectedProvider,
  toReadinessAccount,
  isSelectableProvider,
} from '@repo/data/payment-providers/readiness'
import PaymentsView, { type ProviderCardData } from './view'

const PROVIDERS: SelectableProvider[] = ['mollie', 'viva', 'stripe']

export default async function PaymentsPage() {
  const session = await auth()
  if (!session?.user) redirect('/api/auth/signin')

  const row = await prisma.partnerAccount.findUnique({
    where: { userId: session.user.id },
    select: READINESS_SELECT,
  })
  if (!row) redirect('/account')

  const firstSite = await prisma.site.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'asc' },
    select: { paymentProvider: true },
  })

  // toReadinessAccount turns the Mollie token into a boolean — the token never reaches the client.
  const account = toReadinessAccount(row)
  const providers: ProviderCardData[] = PROVIDERS.map((p) => ({
    provider: p,
    readiness: providerReadiness(account, p),
    availability: availabilityFor(p, account.country),
  }))
  const effective = isSelectableProvider(firstSite?.paymentProvider) ? firstSite.paymentProvider : null

  return (
    <PaymentsView
      providers={providers}
      selected={selectedProvider(account)}
      effective={effective}
      country={account.country}
    />
  )
}
