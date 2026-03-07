/**
 * Mollie Connect (OAuth) Utilities for Partner App
 *
 * Handles the OAuth 2.0 flow for Mollie for Platforms:
 * 1. Partner clicks "Connect" → redirect to Mollie's authorization page
 * 2. Partner authorizes → Mollie redirects back with authorization code
 * 3. We exchange the code for access + refresh tokens
 * 4. Tokens stored in PartnerAccount for creating payments on partner's behalf
 *
 * Scopes:
 *  - payments.read   → check payment status
 *  - payments.write  → create payments on partner's account
 *  - profiles.read   → read partner's Mollie profile info
 *  - onboarding.read → check partner's onboarding status
 */

// ── Environment ─────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`${name} is not set`)
  return val
}

export function getMollieClientId() {
  return requireEnv('MOLLIE_CLIENT_ID')
}

export function getMollieClientSecret() {
  return requireEnv('MOLLIE_CLIENT_SECRET')
}

// ── OAuth Constants ─────────────────────────────────────────────────────────

const MOLLIE_AUTH_URL = 'https://my.mollie.com/oauth2/authorize'
const MOLLIE_TOKEN_URL = 'https://api.mollie.com/oauth2/tokens'

export const OAUTH_SCOPES = [
  'payments.read',
  'payments.write',
  'profiles.read',
  'onboarding.read',
].join('+')

// ── Authorization URL ───────────────────────────────────────────────────────

/**
 * Build the Mollie OAuth authorization URL that the partner will be
 * redirected to. Includes a `state` parameter for CSRF protection.
 */
export function buildAuthorizationUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: getMollieClientId(),
    redirect_uri: redirectUri,
    state,
    scope: OAUTH_SCOPES,
    response_type: 'code',
    approval_prompt: 'auto', // 'force' to always show consent screen
  })
  return `${MOLLIE_AUTH_URL}?${params.toString()}`
}

// ── Token Exchange ──────────────────────────────────────────────────────────

export interface MollieTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number // seconds
}

/**
 * Exchange an authorization code for access + refresh tokens.
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<MollieTokens> {
  const res = await fetch(MOLLIE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: getMollieClientId(),
      client_secret: getMollieClientSecret(),
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error('[Mollie OAuth] Token exchange failed:', res.status, body)
    throw new Error(`Mollie token exchange failed (${res.status})`)
  }

  const data = await res.json()
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  }
}

// ── Token Refresh ───────────────────────────────────────────────────────────

/**
 * Use a refresh token to obtain a new access token.
 * Called when the current access token has expired.
 */
export async function refreshAccessToken(refreshToken: string): Promise<MollieTokens> {
  const res = await fetch(MOLLIE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: getMollieClientId(),
      client_secret: getMollieClientSecret(),
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error('[Mollie OAuth] Token refresh failed:', res.status, body)
    throw new Error(`Mollie token refresh failed (${res.status})`)
  }

  const data = await res.json()
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  }
}

// ── Client Links API ────────────────────────────────────────────────────────

import createMollieClient from '@mollie/api-client'

/**
 * Get the Organization Access Token from environment.
 * This is a long-lived token created in the Mollie Dashboard under
 * Developers → Organization access tokens. It replaces the
 * client_credentials grant (which requires special Mollie approval).
 */
export function getOrgAccessToken(): string {
  return requireEnv('MOLLIE_ORG_TOKEN')
}

export interface ClientLinkData {
  owner: {
    email: string
    givenName: string
    familyName: string
    locale?: string
  }
  name: string // organization name
  address: {
    country: string
    streetAndNumber?: string
    postalCode?: string
    city?: string
  }
  registrationNumber?: string
  vatNumber?: string
}

/**
 * Create a Client Link via Mollie's Client Links API.
 * Returns the clientLink URL that the partner should be redirected to.
 *
 * Uses the @mollie/api-client SDK initialized with an Organization
 * Access Token (`access_…`) so no client_credentials grant is needed.
 *
 * This creates a pre-filled Mollie account signup that automatically
 * connects back to our platform after the partner sets their password.
 *
 * @see https://docs.mollie.com/reference/create-client-link
 */
export async function createClientLink(data: ClientLinkData): Promise<string> {
  const orgToken = getOrgAccessToken()

  // Sanity-check: Organisation Access Tokens always start with "access_"
  if (!orgToken.startsWith('access_')) {
    console.error(
      '[Mollie] MOLLIE_ORG_TOKEN does not start with "access_". ' +
      'Client Links require an Organization Access Token, not a standard API key.',
    )
    throw new Error(
      'MOLLIE_ORG_TOKEN must be an Organization Access Token (starts with access_)',
    )
  }

  const mollieClient = createMollieClient({ accessToken: orgToken })

  const params: Parameters<typeof mollieClient.clientLinks.create>[0] = {
    owner: {
      email: data.owner.email,
      givenName: data.owner.givenName,
      familyName: data.owner.familyName,
      locale: (data.owner.locale as any) || 'en_US',
    },
    name: data.name,
    address: {
      country: data.address.country,
      ...(data.address.streetAndNumber && { streetAndNumber: data.address.streetAndNumber }),
      ...(data.address.postalCode && { postalCode: data.address.postalCode }),
      ...(data.address.city && { city: data.address.city }),
    },
    ...(data.registrationNumber && { registrationNumber: data.registrationNumber }),
    ...(data.vatNumber && { vatNumber: data.vatNumber }),
  }

  try {
    const clientLink = await mollieClient.clientLinks.create(params)

    // The SDK returns the resource — extract the clientLink URL from _links
    const linkHref = (clientLink as any)._links?.clientLink?.href
    if (!linkHref) {
      throw new Error('Mollie client link response did not contain a clientLink URL')
    }

    return linkHref
  } catch (err: any) {
    // Log Mollie-specific error fields for easier debugging
    console.error('[Mollie] clientLinks.create failed:', {
      title: err?.title,
      detail: err?.detail,
      field: err?.field,
      statusCode: err?.statusCode,
      message: err?.message,
    })
    throw err
  }
}

// ── Profile / Onboarding Helpers ────────────────────────────────────────────

/**
 * Fetch the partner's Mollie organization/profile info using their access token.
 * Returns the profile ID and onboarding status.
 */
export async function fetchMollieProfile(accessToken: string): Promise<{
  profileId: string
  onboardingStatus: string
}> {
  // Get the current organization's onboarding status
  const onboardingRes = await fetch('https://api.mollie.com/v2/onboarding/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  let onboardingStatus = 'unknown'
  if (onboardingRes.ok) {
    const onboardingData = await onboardingRes.json()
    onboardingStatus = onboardingData.status // 'needs-data', 'in-review', 'completed'
  }

  // Get the first profile (most merchants have one)
  const profilesRes = await fetch('https://api.mollie.com/v2/profiles?limit=1', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  let profileId = ''
  if (profilesRes.ok) {
    const profilesData = await profilesRes.json()
    if (profilesData._embedded?.profiles?.[0]) {
      profileId = profilesData._embedded.profiles[0].id
    }
  }

  return { profileId, onboardingStatus }
}
