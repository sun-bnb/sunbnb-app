import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { redirect } from 'next/navigation'
import SitesView from './view'

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
      user: {
        select: {
          name: true,
          email: true,
          partnerAccount: {
            select: {
              company: true,
              mollieAccessToken: true,
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
    ownerName: s.user.partnerAccount?.company ?? s.user.name ?? s.user.email,
    hasMollie: !!s.user.partnerAccount?.mollieAccessToken,
  }))

  return (
    <div className="container mx-auto max-w-5xl">
      <SitesView sites={sitesData} />
    </div>
  )
}
