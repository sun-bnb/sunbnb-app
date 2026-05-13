import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { redirect } from 'next/navigation'
import AuditView from './view'
import { listImpersonationAudit } from './actions'

export default async function AuditPage({
  searchParams,
}: {
  searchParams: { targetUserId?: string }
}) {
  const session = await auth()
  if (!session?.user) redirect('/api/auth/signin')

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sudo: true },
  })
  if (!user?.sudo) redirect('/')

  const initial = await listImpersonationAudit(1, {
    targetUserId: searchParams.targetUserId,
  })

  return (
    <div className="container mx-auto max-w-6xl">
      <AuditView
        initial={initial}
        initialTargetUserId={searchParams.targetUserId ?? null}
      />
    </div>
  )
}
