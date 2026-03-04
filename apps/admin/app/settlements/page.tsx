import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { listSettlements, listUnsettledPartners } from '@repo/data/settlement'
import { redirect } from 'next/navigation'
import SettlementsView from './view'

export default async function SettlementsPage() {
  const session = await auth()
  if (!session?.user) redirect('/api/auth/signin')

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sudo: true },
  })
  if (!user?.sudo) redirect('/')

  const [settlements, unsettled, rawSites] = await Promise.all([
    listSettlements(),
    listUnsettledPartners(),
    prisma.site.findMany({
      select: {
        id: true,
        name: true,
        userId: true,
        user: {
          select: {
            partnerAccount: {
              select: { company: true, bankAccount: true },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    }),
  ])

  // Flatten the nested user → partnerAccount into the shape the view expects
  const deemedProviderSites = rawSites
    .filter((s) => s.user.partnerAccount)
    .map((s) => ({
      id: s.id,
      name: s.name,
      accountId: s.userId,
      account: {
        company: s.user.partnerAccount!.company,
        bankAccount: s.user.partnerAccount!.bankAccount,
      },
    }))

  return (
    <div className="container mx-auto max-w-5xl">
      <SettlementsView
        initialSettlements={settlements}
        unsettledPartners={unsettled}
        deemedProviderSites={deemedProviderSites}
      />
    </div>
  )
}
