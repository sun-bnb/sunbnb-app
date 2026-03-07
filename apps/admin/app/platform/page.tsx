import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { redirect } from 'next/navigation'
import PlatformView from './view'

export default async function PlatformPage() {
  const session = await auth()
  if (!session?.user) redirect('/api/auth/signin')

  // Gate: only sudo users can access platform settings
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sudo: true },
  })
  if (!user?.sudo) redirect('/')

  const paymentProcessingFee = await prisma.paymentProcessingFee.findFirst({
    orderBy: { name: 'asc' },
  })

  return (
    <div className="container mx-auto max-w-[768px]">
      <PlatformView paymentProcessingFee={paymentProcessingFee} />
    </div>
  )
}
