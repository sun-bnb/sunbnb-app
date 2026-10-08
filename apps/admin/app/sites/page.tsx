import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { redirect } from 'next/navigation'
import {
  READINESS_SELECT,
  providerReadiness,
  toReadinessAccount,
} from '@repo/data/payment-providers/readiness'
import type { SelectableProvider } from '@repo/data/payment-refs'
import SitesView from './view'
import { resolveBrandRender } from '@repo/data/brand-manifest'

function readinessFor(
  account: Parameters<typeof toReadinessAccount>[0] | null | undefined,
): Record<SelectableProvider, boolean> {
  // Booleans only — toReadinessAccount drops the Mollie token before anything reaches the client.
  const a = account ? toReadinessAccount(account) : null
  const ok = (p: SelectableProvider) => (a ? providerReadiness(a, p).ready : false)
  return { mollie: ok('mollie'), viva: ok('viva'), stripe: ok('stripe') }
}

export default async function SitesPage() {
  const session = await auth()
  if (!session?.user) redirect('/api/auth/signin')

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sudo: true },
  })
  if (!user?.sudo) redirect('/')

  const sites = await prisma.site.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      paymentProvider: true,
      customBrandEnabled: true,
      customBrandKey: true,
      user: {
        select: {
          name: true,
          email: true,
          partnerAccount: {
            select: {
              company: true,
              ...READINESS_SELECT,
            },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  const sitesData = sites.map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    paymentProvider: s.paymentProvider,
    customBrandEnabled: s.customBrandEnabled,
    customBrandKey: s.customBrandKey,
    // The RESOLVED state, not the stored one: "on" and "live" are different
    // things, and only this side knows which modules exist.
    brandReason: resolveBrandRender(s).reason,
    ownerName: s.user.partnerAccount?.company ?? s.user.name ?? s.user.email,
    readiness: readinessFor(s.user.partnerAccount),
  }))

  return (
    <div className="container mx-auto max-w-5xl">
      <SitesView sites={sitesData} />
    </div>
  )
}
