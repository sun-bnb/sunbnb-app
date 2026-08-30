'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getVivaAccountsClient } from '@repo/data/viva'

/**
 * Viva shows this in its own onboarding UI — a fixed platform identity, not
 * the venue's company name (that's what the venue is registering AS a Viva
 * merchant). Mirrors the fixed `partnerName` a Mollie client-link would use.
 */
const VIVA_PARTNER_NAME = 'Sunbnb'
const VIVA_LOGO_PATH = '/logo-lila.png'

function appOrigin(): string | null {
  return process.env.NEXT_PUBLIC_APP_URL ?? null
}

/**
 * Start (or resume) the Viva merchant-connect flow for the signed-in partner.
 *
 * Idempotent: a partner with an existing `vivaAccountId` is NEVER re-created —
 * `POST /isv/v1/accounts` mints a fresh `accountId` every call, so calling it
 * twice would silently orphan the first connected account at Viva. A second
 * call instead refreshes the account's verification status and returns
 * `redirectUrl: null` (the original invitation was emailed to the partner by
 * Viva at creation time; the connected-accounts API has no "reissue
 * invitation" endpoint for this client to call).
 */
export async function connectViva(): Promise<
  | { status: 'ok'; redirectUrl: string | null; alreadyConnected: boolean }
  | { status: 'error'; message: string }
> {
  const session = await auth()
  if (!session?.user) return { status: 'error', message: 'Not authenticated' }

  const origin = appOrigin()
  if (!origin) {
    return {
      status: 'error',
      message: 'Server is missing NEXT_PUBLIC_APP_URL — cannot build the Viva return URL',
    }
  }

  const account = await prisma.partnerAccount.findUnique({
    where: { userId: session.user.id },
    select: { email: true, vivaAccountId: true },
  })
  if (!account) return { status: 'error', message: 'No partner account found' }

  const client = getVivaAccountsClient()

  if (account.vivaAccountId) {
    try {
      const connected = await client.getConnectedAccount(account.vivaAccountId)
      await prisma.partnerAccount.update({
        where: { userId: session.user.id },
        data: {
          vivaVerificationStatus: connected.verificationStatus,
          vivaMerchantId: connected.merchantId ?? null,
        },
      })
      revalidatePath('/account/viva')
      return { status: 'ok', redirectUrl: null, alreadyConnected: true }
    } catch (err) {
      console.error('[Viva] status refresh (during connect) failed:', err)
      return { status: 'error', message: 'Could not refresh Viva status. Please try again.' }
    }
  }

  try {
    const created = await client.createConnectedAccount({
      email: account.email,
      returnUrl: `${origin}/account/viva?connected=1`,
      branding: { partnerName: VIVA_PARTNER_NAME, logoUrl: `${origin}${VIVA_LOGO_PATH}` },
    })

    await prisma.partnerAccount.update({
      where: { userId: session.user.id },
      data: {
        vivaAccountId: created.accountId,
        vivaVerificationStatus: 'pending',
        vivaConnectedAt: new Date(),
      },
    })

    revalidatePath('/account/viva')
    return { status: 'ok', redirectUrl: created.invitation.redirectUrl, alreadyConnected: false }
  } catch (err) {
    console.error('[Viva] connect failed:', err)
    return { status: 'error', message: 'Could not start the Viva connection. Please try again.' }
  }
}

/** Poll Viva for the current verification status and sync it locally. */
export async function refreshVivaStatus(): Promise<
  | { status: 'ok'; verificationStatus: string; merchantId: string | null }
  | { status: 'error'; message: string }
> {
  const session = await auth()
  if (!session?.user) return { status: 'error', message: 'Not authenticated' }

  const account = await prisma.partnerAccount.findUnique({
    where: { userId: session.user.id },
    select: { vivaAccountId: true },
  })
  if (!account?.vivaAccountId) {
    return { status: 'error', message: 'No Viva account connected yet' }
  }

  try {
    const connected = await getVivaAccountsClient().getConnectedAccount(account.vivaAccountId)

    await prisma.partnerAccount.update({
      where: { userId: session.user.id },
      data: {
        vivaVerificationStatus: connected.verificationStatus,
        vivaMerchantId: connected.merchantId ?? null,
      },
    })

    revalidatePath('/account/viva')
    return {
      status: 'ok',
      verificationStatus: connected.verificationStatus,
      merchantId: connected.merchantId ?? null,
    }
  } catch (err) {
    console.error('[Viva] status refresh failed:', err)
    return { status: 'error', message: 'Could not refresh Viva status. Please try again.' }
  }
}

/**
 * Disconnect the partner's Viva account. Clears the five `PartnerAccount.viva*`
 * columns; deliberately does NOT touch `VivaTerminal` rows — a terminal is a
 * physical device binding at the venue, and reconnecting later should not
 * require re-registering every terminal on-site.
 */
export async function disconnectViva(): Promise<
  { status: 'ok' } | { status: 'error'; message: string }
> {
  const session = await auth()
  if (!session?.user) return { status: 'error', message: 'Not authenticated' }

  await prisma.partnerAccount.update({
    where: { userId: session.user.id },
    data: {
      vivaAccountId: null,
      vivaMerchantId: null,
      vivaVerificationStatus: null,
      vivaSourceCode: null,
      vivaConnectedAt: null,
    },
  })

  revalidatePath('/account/viva')
  return { status: 'ok' }
}
