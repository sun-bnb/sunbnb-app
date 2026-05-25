'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getValidMollieToken } from '@repo/data/mollie-tokens'
import { fetchMollieProfile } from '@/app/api/_lib/mollie'

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

  try {
    // The centralized manager refreshes (if needed) + persists access/refresh/
    // expiry under a per-partner lock — no independent rotation here. Then we
    // re-sync the profile/onboarding status with the freshly-valid token.
    const validToken = await getValidMollieToken(session.user.id as string)
    const profile = await fetchMollieProfile(validToken)

    await prisma.partnerAccount.update({
      where: { userId: session.user.id },
      data: {
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
