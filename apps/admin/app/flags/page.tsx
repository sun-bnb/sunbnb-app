import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { redirect } from 'next/navigation'
import { getFlagAdminRows } from '@repo/data/flags'
import FlagsView from './view'

export default async function FlagsPage() {
  const session = await auth()
  if (!session?.user) redirect('/api/auth/signin')

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sudo: true },
  })
  if (!user?.sudo) redirect('/')

  const rows = await getFlagAdminRows()
  return (
    <div className="container mx-auto max-w-5xl">
      <FlagsView initialRows={rows} />
    </div>
  )
}
