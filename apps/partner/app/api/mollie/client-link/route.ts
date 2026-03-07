/**
 * Mollie Client Links – Create & Redirect
 *
 * POST /api/mollie/client-link
 *
 * Creates a Mollie Client Link (pre-filled account signup) using the
 * Client Links API, then returns the redirect URL. The partner is sent
 * to a Mollie signup page where they set a password and consent — then
 * get redirected back to our /api/mollie/callback with an auth code,
 * exactly like the standard OAuth flow.
 *
 * @see https://docs.mollie.com/reference/create-client-link
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/app/auth'
import { createClientLink, getMollieClientId, OAUTH_SCOPES } from '@/app/api/_lib/mollie'
import crypto from 'crypto'

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin

  try {
    const body = await request.json()

    // Validate required fields
    const required = ['email', 'givenName', 'familyName', 'organizationName', 'streetAndNumber', 'postalCode', 'city', 'country']
    for (const field of required) {
      if (!body[field]?.trim()) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 },
        )
      }
    }

    // Create client link via Mollie API
    const clientLinkUrl = await createClientLink({
      owner: {
        email: body.email.trim(),
        givenName: body.givenName.trim(),
        familyName: body.familyName.trim(),
        locale: body.locale || 'en_US',
      },
      name: body.organizationName.trim(),
      address: {
        streetAndNumber: body.streetAndNumber.trim(),
        postalCode: body.postalCode.trim(),
        city: body.city.trim(),
        country: body.country.trim(),
      },
      registrationNumber: body.registrationNumber?.trim() || undefined,
      vatNumber: body.vatNumber?.trim() || undefined,
    })

    // Generate CSRF state (same mechanism as /api/mollie/authorize)
    const state = crypto.randomBytes(16).toString('hex')
    const redirectUri = `${baseUrl}/api/mollie/callback`

    // Append OAuth parameters to the client link URL
    const separator = clientLinkUrl.includes('?') ? '&' : '?'
    const oauthParams = new URLSearchParams({
      client_id: getMollieClientId(),
      redirect_uri: redirectUri,
      state,
      scope: OAUTH_SCOPES,
      approval_prompt: 'auto',
    })
    const finalUrl = `${clientLinkUrl}${separator}${oauthParams.toString()}`

    // Return the redirect URL + set state cookie
    const response = NextResponse.json({ url: finalUrl })
    response.cookies.set('mollie_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
      path: '/',
    })

    return response
  } catch (err) {
    console.error('[Mollie] Client link error:', err)
    const message = err instanceof Error ? err.message : ''
    // Detect when client_credentials grant isn't enabled for this OAuth app
    const isNotEnabled = message.includes('app token request failed')
    return NextResponse.json(
      {
        error: isNotEnabled
          ? 'Client Links are not yet enabled for this app. Please create your Mollie account manually and use the "I have a Mollie account" option.'
          : 'Failed to create Mollie account link. Please try again.',
        code: isNotEnabled ? 'client_links_unavailable' : 'create_failed',
      },
      { status: isNotEnabled ? 422 : 500 },
    )
  }
}
