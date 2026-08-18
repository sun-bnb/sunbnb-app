import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { redirect } from 'next/navigation'
import { getPreferenceAdminRows } from '@repo/data/preferences'
import PreferencesView from './view'

export default async function PreferencesPage() {
  const session = await auth()
  if (!session?.user) redirect('/api/auth/signin')

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sudo: true },
  })
  if (!user?.sudo) redirect('/')

  const rows = await getPreferenceAdminRows()
  return (
    <div className="container mx-auto max-w-5xl">
      <PreferencesView initialRows={rows} />
    </div>
  )
}
