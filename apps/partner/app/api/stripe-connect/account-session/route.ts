import { NextResponse } from 'next/server'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { createAccountSession } from '@repo/data/stripe'

/** POST /api/stripe-connect/account-session — client secret for embedded Connect components. */
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const account = await prisma.partnerAccount.findUnique({
      where: { userId: session.user.id },
      select: { stripeConnectAccountId: true, stripeConnectDetailsSubmitted: true },
    })
    if (!account?.stripeConnectAccountId || !account.stripeConnectDetailsSubmitted) {
      return NextResponse.json({ error: 'Stripe onboarding not completed' }, { status: 400 })
    }
    const { clientSecret } = await createAccountSession(account.stripeConnectAccountId)
    return NextResponse.json({ clientSecret })
  } catch (err) {
    console.error('[StripeConnect] account session failed:', err)
    return NextResponse.json({ error: 'Could not create session' }, { status: 500 })
  }
}
