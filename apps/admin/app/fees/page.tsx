import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { redirect } from 'next/navigation'
import FeesView from './view'

export default async function FeesPage() {
  const session = await auth()
  if (!session?.user) redirect('/api/auth/signin')

  // Gate: only sudo users can access fee management
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sudo: true },
  })
  if (!user?.sudo) redirect('/')

  const platformFees = await prisma.serviceFee.findMany({
    where: {
      siteId: null,
      accountId: null,
    },
    include: {
      settings: true,
      site: { select: { id: true, name: true } },
      account: { select: { userId: true, company: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const settings = await prisma.settings.findMany({
    orderBy: { country: 'asc' },
  })

  const serviceCodes = await prisma.serviceCode.findMany({
    orderBy: { code: 'asc' },
  })

  return (
    <div className="container mx-auto max-w-[768px]">
      <FeesView
        initialPlatformFees={platformFees}
        settings={settings}
        serviceCodes={serviceCodes}
      />
    </div>
  )
}
