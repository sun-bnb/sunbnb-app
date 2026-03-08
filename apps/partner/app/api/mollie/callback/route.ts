/**
 * Mollie Connect – OAuth Callback Endpoint
 *
 * GET /api/mollie/callback?code=...&state=...
 *
 * Called by Mollie after the partner authorizes our app.
 * 1. Verify CSRF state token (from cookie)
 * 2. Exchange authorization code for access + refresh tokens
 * 3. Fetch partner's Mollie profile (profile ID + onboarding status)
 * 4. Store everything in PartnerAccount
 * 5. Redirect partner back to the onboarding page
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import {
  exchangeCodeForTokens,
  fetchMollieProfile,
  bootstrapMollieAccount,
} from '@/app/api/_lib/mollie'

export async function GET(request: NextRequest) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin

  const session = await auth()
  if (!session?.user) {
    return NextResponse.redirect(new URL('/account/mollie?error=not_authenticated', baseUrl))
  }

  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const errorParam = searchParams.get('error')

  // Partner denied access or Mollie returned an error
  if (errorParam) {
    console.error('[Mollie OAuth] Authorization error:', errorParam)
    return NextResponse.redirect(
      new URL(`/account/mollie?error=${encodeURIComponent(errorParam)}`, baseUrl),
    )
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/account/mollie?error=missing_params', baseUrl))
  }

  // Verify CSRF state
  const storedState = request.cookies.get('mollie_oauth_state')?.value
  if (!storedState || storedState !== state) {
    return NextResponse.redirect(new URL('/account/mollie?error=invalid_state', baseUrl))
  }

  try {
    // Build redirect URI (must match authorize route)
    const redirectUri = `${baseUrl}/api/mollie/callback`

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code, redirectUri)

    // Fetch profile info from Mollie
    const profile = await fetchMollieProfile(tokens.accessToken)

    // Store tokens + profile data in PartnerAccount
    await prisma.partnerAccount.update({
      where: { userId: session.user.id },
      data: {
        mollieAccessToken: tokens.accessToken,
        mollieRefreshToken: tokens.refreshToken,
        mollieProfileId: profile.profileId || null,
        mollieOnboardingStatus: profile.onboardingStatus,
      },
    })

    // ── Auto-bootstrap: submit onboarding data + enable payment methods ──
    // This runs after tokens are stored. Failures are logged but never
    // prevent the success redirect — the partner can re-run manually.
    try {
      const bootstrap = await bootstrapMollieAccount(
        tokens.accessToken,
        session.user.id!,
        {
          email: session.user.email ?? undefined,
          profileId: profile.profileId || null,
        },
      )
      console.log('[Mollie OAuth] Auto-bootstrap result:', JSON.stringify(bootstrap))

      // Persist the updated onboarding status from bootstrap
      if (bootstrap.onboardingStatus || bootstrap.profileId) {
        await prisma.partnerAccount.update({
          where: { userId: session.user.id },
          data: {
            ...(bootstrap.onboardingStatus && {
              mollieOnboardingStatus: bootstrap.onboardingStatus,
            }),
            ...(bootstrap.profileId && !profile.profileId && {
              mollieProfileId: bootstrap.profileId,
            }),
          },
        })
      }
    } catch (err) {
      console.error('[Mollie OAuth] Auto-bootstrap error (non-fatal):', err)
    }

    // Clear the state cookie and redirect to success page
    const response = NextResponse.redirect(new URL('/account/mollie?success=true', baseUrl))
    response.cookies.delete('mollie_oauth_state')
    return response

  } catch (err) {
    console.error('[Mollie OAuth] Callback error:', err)
    return NextResponse.redirect(
      new URL('/account/mollie?error=token_exchange_failed', baseUrl),
    )
  }
}
