/**
 * Mollie Connect – Authorize Endpoint
 *
 * GET /api/mollie/authorize
 *
 * Generates a random state token (stored in a cookie for CSRF protection)
 * and redirects the partner to Mollie's OAuth consent screen.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/app/auth'
import { buildAuthorizationUrl, sanitizeReturnTo } from '@/app/api/_lib/mollie'
import crypto from 'crypto'

export async function GET(request: NextRequest) {
  // Must be an authenticated partner
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Generate CSRF state token
  const state = crypto.randomBytes(16).toString('hex')

  // Build redirect URI (must match the one registered in Mollie dashboard)
  const origin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
  const redirectUri = `${origin}/api/mollie/callback`

  const authUrl = buildAuthorizationUrl(state, redirectUri)

  // Set state in a short-lived httpOnly cookie for verification in callback
  const response = NextResponse.redirect(authUrl)
  response.cookies.set('mollie_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  })

  // Optional post-connect return path (e.g. the manage page that launched the
  // "Enable refunds" re-consent). Same-origin only, and kept in an httpOnly
  // cookie so the manage URL + access key never travel to Mollie.
  const returnTo = sanitizeReturnTo(request.nextUrl.searchParams.get('returnTo'))
  if (returnTo) {
    response.cookies.set('mollie_oauth_return', returnTo, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    })
  }

  return response
}
