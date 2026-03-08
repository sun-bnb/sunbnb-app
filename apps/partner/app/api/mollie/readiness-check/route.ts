/**
 * GET /api/mollie/readiness-check
 *
 * Returns a structured readiness report for the partner's Mollie account.
 * The UI uses this to show checkmarks (✓/✗) for each prerequisite:
 *   - Token is valid (can call Mollie API)
 *   - Profile exists and is active
 *   - At least one payment method is enabled
 *   - Onboarding status
 */

import { NextResponse } from 'next/server'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import createMollieClient from '@mollie/api-client'

export interface ReadinessReport {
  tokenValid: boolean
  profileActive: boolean
  profileId: string | null
  onboardingStatus: string | null
  enabledMethods: string[]
  ready: boolean // all-green shorthand
}

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const account = await prisma.partnerAccount.findUnique({
    where: { userId: session.user.id },
    select: {
      mollieAccessToken: true,
      mollieProfileId: true,
      mollieOnboardingStatus: true,
    },
  })

  if (!account?.mollieAccessToken) {
    return NextResponse.json({ error: 'No Mollie account connected' }, { status: 400 })
  }

  const report: ReadinessReport = {
    tokenValid: false,
    profileActive: false,
    profileId: account.mollieProfileId,
    onboardingStatus: account.mollieOnboardingStatus,
    enabledMethods: [],
    ready: false,
  }

  const mollie = createMollieClient({ accessToken: account.mollieAccessToken })

  // ── Check 1: Token validity (try fetching profiles) ─────────────────────

  try {
    const profiles = await mollie.profiles.page()
    report.tokenValid = true

    const first = profiles[0]
    if (first) {
      report.profileId = first.id
      report.profileActive = (first as any).status === 'verified' || (first as any).status === 'unverified'

      // persist profile ID if it wasn't stored yet
      if (!account.mollieProfileId && first.id) {
        await prisma.partnerAccount.update({
          where: { userId: session.user.id },
          data: { mollieProfileId: first.id },
        })
      }
    }
  } catch (err: any) {
    console.error('[Mollie Readiness] Token check failed:', err?.message)
    // token is invalid — return early with what we have
    return NextResponse.json(report)
  }

  // ── Check 2: Onboarding status (live) ───────────────────────────────────

  try {
    const onboarding = await mollie.onboarding.get()
    report.onboardingStatus = (onboarding as any).status

    // Keep DB in sync
    if (report.onboardingStatus !== account.mollieOnboardingStatus) {
      await prisma.partnerAccount.update({
        where: { userId: session.user.id },
        data: { mollieOnboardingStatus: report.onboardingStatus },
      })
    }
  } catch (err: any) {
    console.error('[Mollie Readiness] Onboarding check failed:', err?.message)
  }

  // ── Check 3: Enabled payment methods ────────────────────────────────────
  // GET /v2/methods/all returns every method Mollie offers, including a
  // `status` field for methods that have been enabled on the account
  // (activated, pending-boarding, pending-review, etc.)

  if (report.profileId) {
    try {
      const res = await fetch(
        `https://api.mollie.com/v2/methods/all?profileId=${report.profileId}`,
        { headers: { Authorization: `Bearer ${account.mollieAccessToken}` } },
      )
      console.log(`[Mollie Readiness] methods/all response: ${res.status}`)
      if (res.ok) {
        const data = await res.json()
        const allMethods = data?._embedded?.methods ?? []
        // A method is "enabled" if it has a status (activated, pending-boarding, etc.)
        const enabled = allMethods.filter((m: any) => m.status && m.status !== 'not-activated')
        report.enabledMethods = enabled.map((m: any) => m.id)
        console.log('[Mollie Readiness] All methods count:', allMethods.length)
        console.log('[Mollie Readiness] Enabled methods:', report.enabledMethods)
        console.log('[Mollie Readiness] Method statuses:', enabled.map((m: any) => `${m.id}=${m.status}`).join(', '))
      } else {
        const body = await res.text()
        console.error('[Mollie Readiness] methods/all error:', res.status, body)
      }
    } catch (err: any) {
      console.error('[Mollie Readiness] Methods check failed:', err?.message)
    }
  }

  // ── Compute readiness ───────────────────────────────────────────────────
  // In test mode, onboarding status doesn't block payments.
  // We only require: valid token, active profile, and at least one method.

  report.ready =
    report.tokenValid &&
    report.profileActive &&
    report.enabledMethods.length > 0

  console.log('[Mollie Readiness] Final report:', JSON.stringify(report))
  return NextResponse.json(report)
}
