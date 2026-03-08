import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { redirect } from 'next/navigation'
import UsersView from './view'

export default async function UsersPage() {
  const session = await auth()
  if (!session?.user) redirect('/api/auth/signin')

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sudo: true },
  })
  if (!user?.sudo) redirect('/')

  const adminUsers = await prisma.adminUser.findMany({
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div className="container mx-auto max-w-5xl">
      <UsersView initialUsers={adminUsers} />
    </div>
  )
}
