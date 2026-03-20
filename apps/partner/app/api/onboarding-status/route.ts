import { NextResponse } from 'next/server'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ hasAccount: false, hasMollie: false })
  }

  const [account, integratedPaymentsSites] = await Promise.all([
    prisma.partnerAccount.findUnique({
      where: { userId: session.user.id },
      select: {
        company: true,
        mollieAccessToken: true,
        mollieOnboardingStatus: true,
      },
    }),
    prisma.site.findMany({
      where: {
        userId: session.user.id,
        OR: [
          { type: 'paid' },
          { orderPaymentType: 'paid' },
          { rentalPaymentType: 'paid' },
        ],
      },
      select: { id: true },
      take: 1,
    }),
  ])

  return NextResponse.json({
    hasAccount: !!account?.company,
    hasMollie: !!account?.mollieAccessToken,
    mollieOnboardingStatus: account?.mollieOnboardingStatus ?? null,
    hasIntegratedPayments: integratedPaymentsSites.length > 0,
  })
}
