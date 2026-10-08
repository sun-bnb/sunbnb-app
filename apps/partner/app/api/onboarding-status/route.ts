import { NextResponse } from 'next/server'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { fetchMollieProfile } from '@/app/api/_lib/mollie'
import { getVivaAccountsClient } from '@repo/data/viva'
import { retrieveAccountSnapshot, snapshotToColumns } from '@repo/data/stripe'
import {
  READINESS_SELECT,
  isSelectableProvider,
  providerReadiness,
  selectedProvider,
  toReadinessAccount,
} from '@repo/data/payment-providers/readiness'
import { syncEffectiveProviderSafe } from '@/app/api/_lib/sync-effective-provider'

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ hasAccount: false, hasMollie: false, hasViva: false })
  }

  const [account, integratedPaymentsSites] = await Promise.all([
    prisma.partnerAccount.findUnique({
      where: { userId: session.user.id },
      select: {
        company: true,
        ...READINESS_SELECT,
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

  // Live-sync the onboarding status while it's not yet completed. Mollie does
  // not push onboarding events, so without this the cached DB value can stay
  // stale until the partner manually visits /account/mollie. Once the partner
  // is 'completed', we stop querying Mollie on every page transition.
  let mollieOnboardingStatus = account?.mollieOnboardingStatus ?? null
  let liveSyncedChange = false
  if (account?.mollieAccessToken && mollieOnboardingStatus !== 'completed') {
    try {
      const profile = await fetchMollieProfile(account.mollieAccessToken)
      if (profile.onboardingStatus && profile.onboardingStatus !== 'unknown') {
        if (profile.onboardingStatus !== mollieOnboardingStatus) {
          await prisma.partnerAccount.update({
            where: { userId: session.user.id },
            data: { mollieOnboardingStatus: profile.onboardingStatus },
          })
          liveSyncedChange = true
        }
        mollieOnboardingStatus = profile.onboardingStatus
      }
    } catch (err: any) {
      console.error('[OnboardingStatus] Live sync failed, using cached value:', err?.message)
    }
  }

  // Same live-sync shape for Viva: no push events for connected-account
  // verification either, so poll while not yet verified and stop once it is.
  let vivaVerificationStatus = account?.vivaVerificationStatus ?? null
  if (account?.vivaAccountId && vivaVerificationStatus !== 'verified') {
    try {
      const connected = await getVivaAccountsClient().getConnectedAccount(account.vivaAccountId)
      if (connected.verificationStatus !== 'unknown' && connected.verificationStatus !== vivaVerificationStatus) {
        await prisma.partnerAccount.update({
          where: { userId: session.user.id },
          data: {
            vivaVerificationStatus: connected.verificationStatus,
            vivaMerchantId: connected.merchantId ?? null,
          },
        })
        liveSyncedChange = true
      }
      vivaVerificationStatus = connected.verificationStatus
    } catch (err: any) {
      console.error('[OnboardingStatus] Viva live sync failed, using cached value:', err?.message)
    }
  }

  // Stripe Connect: webhooks are the primary path, but poll best-effort while onboarding
  // is incomplete so the UI never depends on webhook delivery alone.
  let stripeLive: Record<string, unknown> = {}
  if (account?.stripeConnectAccountId && account.stripeConnectOnboardingStatus !== 'complete') {
    try {
      const snapshot = await retrieveAccountSnapshot(account.stripeConnectAccountId)
      const columns = snapshotToColumns(snapshot)
      await prisma.partnerAccount.update({ where: { userId: session.user.id }, data: columns })
      stripeLive = columns
      liveSyncedChange = true
    } catch (err: any) {
      console.error('[OnboardingStatus] Stripe live sync failed, using cached value:', err?.message)
    }
  }

  // A live-sync just changed connection state: let the sites' EFFECTIVE provider follow
  // before we read it back below (best-effort, never fails the poll).
  if (liveSyncedChange) await syncEffectiveProviderSafe(session.user.id)

  // Readiness is computed from the live-synced values, not the stale cached row.
  const readinessAccount = account
    ? toReadinessAccount({
        ...account,
        mollieOnboardingStatus,
        vivaVerificationStatus,
        ...stripeLive,
      })
    : toReadinessAccount({})
  const selected = selectedProvider(readinessAccount)
  const firstSite = account
    ? await prisma.site.findFirst({
        where: { userId: session.user.id },
        orderBy: { createdAt: 'asc' },
        select: { paymentProvider: true },
      })
    : null
  const provider = isSelectableProvider(firstSite?.paymentProvider) ? firstSite.paymentProvider : selected

  return NextResponse.json({
    hasAccount: !!account?.company,
    hasMollie: !!account?.mollieAccessToken,
    mollieOnboardingStatus,
    hasViva: !!account?.vivaAccountId,
    vivaVerificationStatus,
    hasIntegratedPayments: integratedPaymentsSites.length > 0,
    // Track 028: provider-neutral contract. The fields above are legacy (kept one release).
    provider,
    selected,
    readiness: providerReadiness(readinessAccount, provider),
    selectedReadiness: providerReadiness(readinessAccount, selected),
    selectedDiffersFromEffective: selected !== provider,
  })
}
