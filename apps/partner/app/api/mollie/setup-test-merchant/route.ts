/**
 * POST /api/mollie/setup-test-merchant
 *
 * Bootstraps a test merchant's Mollie account so it can accept payments:
 *  1. Checks onboarding status — submits minimal data if still "needs-data"
 *  2. Enables common payment methods on the merchant's profile
 *
 * This is only useful in test mode. In production, Mollie handles
 * onboarding verification, and merchants enable methods via their dashboard.
 *
 * Can also be used as a manual re-run if the automatic bootstrap in the
 * OAuth callback didn't fully succeed.
 *
 * Requires the partner to be authenticated and have a connected Mollie account.
 */

import { NextResponse } from 'next/server'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { bootstrapMollieAccount } from '@/app/api/_lib/mollie'

export async function POST() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Load partner's Mollie credentials
  const account = await prisma.partnerAccount.findUnique({
    where: { userId: session.user.id },
    select: {
      mollieAccessToken: true,
      mollieProfileId: true,
    },
  })

  if (!account?.mollieAccessToken) {
    return NextResponse.json(
      { error: 'No Mollie account connected. Please connect your Mollie account first.' },
      { status: 400 },
    )
  }

  const results = await bootstrapMollieAccount(
    account.mollieAccessToken,
    session.user.id!,
    {
      email: session.user.email ?? undefined,
      profileId: account.mollieProfileId,
    },
  )

  return NextResponse.json({
    message: 'Test merchant setup complete',
    results,
  })
}
