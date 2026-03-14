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
  'profiles.write',
  'onboarding.read',
  'onboarding.write',
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

// ── Post-Connect Bootstrap ──────────────────────────────────────────────────

/** Payment methods to enable automatically after connecting. */
const DEFAULT_METHODS = [
  'creditcard',
  'ideal',
  'bancontact',
  'banktransfer',
  'applepay',
] as const

export interface BootstrapResult {
  onboardingStatus: string | null
  onboardingSubmitted: boolean
  profileId: string | null
  profileResolved: boolean
  methods: Record<string, string>
}

/**
 * Bootstrap a newly-connected Mollie account:
 *  1. Check onboarding — submit minimal data if status is "needs-data"
 *  2. Resolve profile ID (fetch first profile if not already stored)
 *  3. Enable default payment methods on the profile
 *
 * This is called automatically from the OAuth callback and can also be
 * triggered manually via the setup-test-merchant endpoint.
 *
 * Failures in any step are logged but never bubble — the caller always
 * gets a structured result object.
 */
export async function bootstrapMollieAccount(
  accessToken: string,
  userId: string,
  opts?: { email?: string; profileId?: string | null },
): Promise<BootstrapResult> {
  console.log('[Mollie Bootstrap] Starting bootstrap for user:', userId)
  console.log('[Mollie Bootstrap] Access token prefix:', accessToken.substring(0, 12) + '…')
  console.log('[Mollie Bootstrap] Provided profileId:', opts?.profileId ?? '(none)')

  const mollie = createMollieClient({ accessToken })
  const result: BootstrapResult = {
    onboardingStatus: null,
    onboardingSubmitted: false,
    profileId: opts?.profileId ?? null,
    profileResolved: false,
    methods: {},
  }

  // ── Step 1: Onboarding ──────────────────────────────────────────────────

  try {
    console.log('[Mollie Bootstrap] Fetching onboarding status…')
    const onboarding = await mollie.onboarding.get()
    result.onboardingStatus = (onboarding as any).status
    console.log('[Mollie Bootstrap] Onboarding status:', result.onboardingStatus)

    if ((onboarding as any).status === 'needs-data') {
      console.log('[Mollie Bootstrap] Submitting onboarding data via raw fetch…')

      // Load real partner account data from DB
      let orgData: { name: string; streetAndNumber: string; postalCode: string; city: string; country: string }
      let profileData: { name: string; url: string; email: string }
      try {
        const prismaCl = (await import('@repo/data/PrismaCient')).default
        const partnerAccount = await prismaCl.partnerAccount.findUnique({
          where: { userId },
          select: { company: true, address: true, city: true, postalCode: true, country: true, websiteUrl: true, email: true },
        })
        orgData = {
          name: partnerAccount?.company || 'Platform Operator',
          streetAndNumber: partnerAccount?.address || '',
          postalCode: partnerAccount?.postalCode || '',
          city: partnerAccount?.city || '',
          country: partnerAccount?.country || 'NL',
        }
        profileData = {
          name: partnerAccount?.company || 'Beach Club',
          url: partnerAccount?.websiteUrl || 'https://sunbnb.app',
          email: opts?.email || partnerAccount?.email || 'info@sunbnb.app',
        }
      } catch (dbErr) {
        console.error('[Mollie Bootstrap] Failed to load partner account from DB, using fallback:', dbErr)
        orgData = { name: 'Platform Operator', streetAndNumber: '', postalCode: '', city: '', country: 'NL' }
        profileData = { name: 'Beach Club', url: 'https://sunbnb.app', email: opts?.email || 'info@sunbnb.app' }
      }

      // The SDK fails on onboarding.submit() because Mollie returns 204 No Content
      // which the SDK can't parse as JSON. Use raw fetch instead.
      const submitRes = await fetch('https://api.mollie.com/v2/onboarding/me', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          organization: {
            name: orgData.name,
            address: {
              streetAndNumber: orgData.streetAndNumber,
              postalCode: orgData.postalCode,
              city: orgData.city,
              country: orgData.country,
            },
          },
          profile: {
            name: profileData.name,
            url: profileData.url,
            email: profileData.email,
            description: 'Beach club sunbed rentals, food & beverages',
            categoryCode: 5499,
          },
        }),
      })
      console.log('[Mollie Bootstrap] Onboarding submit response:', submitRes.status)
      if (!submitRes.ok) {
        const errBody = await submitRes.text()
        console.error('[Mollie Bootstrap] Onboarding submit error body:', errBody)
      } else {
        result.onboardingSubmitted = true
        console.log('[Mollie Bootstrap] Onboarding data submitted successfully')

        // Re-check onboarding status after submit
        try {
          const onboarding2 = await mollie.onboarding.get()
          result.onboardingStatus = (onboarding2 as any).status
          console.log('[Mollie Bootstrap] Onboarding status after submit:', result.onboardingStatus)
        } catch (e) {
          console.error('[Mollie Bootstrap] Failed to re-check onboarding:', e)
        }
      }
    } else {
      console.log('[Mollie Bootstrap] Onboarding does not need data, skipping submit')
    }
  } catch (err: any) {
    console.error('[Mollie Bootstrap] Onboarding error:', {
      title: err?.title, detail: err?.detail, field: err?.field,
      statusCode: err?.statusCode, message: err?.message,
    })
  }

  // ── Step 2: Resolve profile ID ──────────────────────────────────────────

  if (!result.profileId) {
    try {
      console.log('[Mollie Bootstrap] No profileId — fetching profiles…')
      const profiles = await mollie.profiles.page()
      console.log('[Mollie Bootstrap] Profiles returned:', profiles.length)
      const first = profiles[0]
      if (first) {
        console.log('[Mollie Bootstrap] Using profile:', first.id, 'status:', (first as any).status, 'mode:', (first as any).mode)
        result.profileId = first.id
        result.profileResolved = true
        const prisma = (await import('@repo/data/PrismaCient')).default
        await prisma.partnerAccount.update({
          where: { userId },
          data: { mollieProfileId: first.id },
        })
      } else {
        console.warn('[Mollie Bootstrap] No profiles found on this Mollie account')
      }
    } catch (err: any) {
      console.error('[Mollie Bootstrap] Profile fetch error:', err?.message)
    }
  } else {
    console.log('[Mollie Bootstrap] Using existing profileId:', result.profileId)
  }

  // ── Step 3: Enable payment methods ──────────────────────────────────────

  if (result.profileId) {
    console.log('[Mollie Bootstrap] Enabling payment methods on profile:', result.profileId)
    for (const methodId of DEFAULT_METHODS) {
      try {
        console.log(`[Mollie Bootstrap] Enabling ${methodId}…`)
        const enableResult = await mollie.profileMethods.enable({
          profileId: result.profileId,
          id: methodId as any,
        })
        console.log(`[Mollie Bootstrap] ${methodId} → enabled`, JSON.stringify(enableResult))
        result.methods[methodId] = 'enabled'
      } catch (err: any) {
        console.error(`[Mollie Bootstrap] Failed to enable ${methodId}:`, {
          title: err?.title, detail: err?.detail, field: err?.field,
          statusCode: err?.statusCode, message: err?.message,
        })
        result.methods[methodId] = err?.detail || err?.message || 'failed'
      }
    }
  } else {
    console.warn('[Mollie Bootstrap] No profileId available — skipping method enablement')
  }

  console.log('[Mollie Bootstrap] Final result:', JSON.stringify(result))
  return result
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
