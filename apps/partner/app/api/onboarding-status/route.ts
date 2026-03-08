import { NextResponse } from 'next/server'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ hasAccount: false, hasMollie: false })
  }

  const account = await prisma.partnerAccount.findUnique({
    where: { userId: session.user.id },
    select: {
      company: true,
      mollieAccessToken: true,
    },
  })

  return NextResponse.json({
    hasAccount: !!account?.company,
    hasMollie: !!account?.mollieAccessToken,
  })
}
