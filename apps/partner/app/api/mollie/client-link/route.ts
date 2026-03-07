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
import { z } from 'zod'

// ── Zod Schema ──────────────────────────────────────────────────────────────

const clientLinkSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  givenName: z.string().trim().min(1, 'First name is required'),
  familyName: z.string().trim().min(1, 'Last name is required'),
  organizationName: z.string().trim().min(1, 'Organization name is required'),
  country: z.string().trim().length(2, 'Country must be a 2-letter ISO code'),
  streetAndNumber: z.string().trim().optional().default(''),
  postalCode: z.string().trim().optional().default(''),
  city: z.string().trim().optional().default(''),
  locale: z.string().trim().optional().default('en_US'),
  registrationNumber: z.string().trim().optional(),
  vatNumber: z.string().trim().optional(),
})

// ── Route Handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin

  try {
    const raw = await request.json()

    // Validate with Zod
    const parsed = clientLinkSchema.safeParse(raw)
    if (!parsed.success) {
      const firstError = parsed.error.errors[0]
      return NextResponse.json(
        {
          error: `Validation error: ${firstError?.path.join('.')} — ${firstError?.message}`,
          code: 'validation_error',
          details: parsed.error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 },
      )
    }

    const body = parsed.data

    // Create client link via Mollie API
    const clientLinkUrl = await createClientLink({
      owner: {
        email: body.email,
        givenName: body.givenName,
        familyName: body.familyName,
        locale: body.locale,
      },
      name: body.organizationName,
      address: {
        country: body.country,
        ...(body.streetAndNumber && { streetAndNumber: body.streetAndNumber }),
        ...(body.postalCode && { postalCode: body.postalCode }),
        ...(body.city && { city: body.city }),
      },
      registrationNumber: body.registrationNumber || undefined,
      vatNumber: body.vatNumber || undefined,
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
  } catch (err: any) {
    console.error('[Mollie] Client link error:', err)
    const message = err instanceof Error ? err.message : ''
    const statusCode: number | undefined = err?.statusCode

    // 403 — Mollie account lacks Partner / Marketplace status
    if (statusCode === 403) {
      return NextResponse.json(
        {
          error:
            'Your Mollie account does not have Partner or Marketplace status. ' +
            'Enable this in your Mollie Dashboard before using Client Links.',
          code: 'partner_status_required',
        },
        { status: 403 },
      )
    }

    // Org token missing or wrong type
    const isAuthError =
      message.includes('MOLLIE_ORG_TOKEN is not set') ||
      message.includes('Organization Access Token') ||
      statusCode === 401

    if (isAuthError) {
      return NextResponse.json(
        {
          error:
            'Client Links are not yet configured. Please create your Mollie account manually and use the "I have a Mollie account" option.',
          code: 'client_links_unavailable',
        },
        { status: 422 },
      )
    }

    return NextResponse.json(
      {
        error: 'Failed to create Mollie account link. Please try again.',
        code: 'create_failed',
      },
      { status: 500 },
    )
  }
}
