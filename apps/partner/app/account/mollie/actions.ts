'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { refreshAccessToken, fetchMollieProfile } from '@/app/api/_lib/mollie'

/**
 * Disconnect the partner's Mollie account.
 * Clears all Mollie-related fields from PartnerAccount.
 */
export async function disconnectMollie() {
  const session = await auth()
  if (!session?.user) return { status: 'error', message: 'Not authenticated' }

  await prisma.partnerAccount.update({
    where: { userId: session.user.id },
    data: {
      mollieAccessToken: null,
      mollieRefreshToken: null,
      mollieProfileId: null,
      mollieOnboardingStatus: null,
    },
  })

  revalidatePath('/account/mollie')
  return { status: 'ok' }
}

/**
 * Refresh the Mollie access token using the stored refresh token.
 * Updates the PartnerAccount with new tokens and re-fetches profile/onboarding status.
 */
export async function refreshMollieTokens() {
  const session = await auth()
  if (!session?.user) return { status: 'error', message: 'Not authenticated' }

  const account = await prisma.partnerAccount.findUnique({
    where: { userId: session.user.id },
    select: { mollieRefreshToken: true },
  })

  if (!account?.mollieRefreshToken) {
    return { status: 'error', message: 'No Mollie account connected' }
  }

  try {
    const tokens = await refreshAccessToken(account.mollieRefreshToken)
    const profile = await fetchMollieProfile(tokens.accessToken)

    await prisma.partnerAccount.update({
      where: { userId: session.user.id },
      data: {
        mollieAccessToken: tokens.accessToken,
        mollieRefreshToken: tokens.refreshToken,
        mollieProfileId: profile.profileId || null,
        mollieOnboardingStatus: profile.onboardingStatus,
      },
    })

    revalidatePath('/account/mollie')
    return { status: 'ok' }
  } catch (err) {
    console.error('[Mollie] Token refresh failed:', err)
    return { status: 'error', message: 'Token refresh failed. Please reconnect your Mollie account.' }
  }
}
