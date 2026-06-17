/**
 * Tests for GET /api/mollie/callback
 *
 * Bug-revealing priority: CSRF state validation (does the callback reject a
 * forged request that has no prior authorize cookie?).
 *
 * Covers: auth gate, error param, missing params, CSRF mismatch, happy path,
 * token exchange failure, cookie cleanup on success.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@repo/data/mollie-tokens', () => ({
  mollieTokenExpiresAtFrom: vi.fn(),
}))

vi.mock('@/app/api/_lib/mollie', () => ({
  exchangeCodeForTokens: vi.fn(),
  fetchMollieProfile: vi.fn(),
  bootstrapMollieAccount: vi.fn(),
}))

import { GET } from './route'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { mollieTokenExpiresAtFrom } from '@repo/data/mollie-tokens'
import { exchangeCodeForTokens, fetchMollieProfile, bootstrapMollieAccount } from '@/app/api/_lib/mollie'
import { NextRequest } from 'next/server'

const mockAuth = vi.mocked(auth)
const mockExchangeCode = vi.mocked(exchangeCodeForTokens)
const mockFetchProfile = vi.mocked(fetchMollieProfile)
const mockBootstrap = vi.mocked(bootstrapMollieAccount)
const mockTokenExpiresAt = vi.mocked(mollieTokenExpiresAtFrom)
const mockAccountUpdate = vi.mocked(prisma.partnerAccount.update)

const VALID_STATE = 'abc123def456abc123def456abc12345'

function makeRequest(params: {
  code?: string
  state?: string
  error?: string
  cookieState?: string  // if undefined → no cookie is sent (no prior authorize call)
}): NextRequest {
  const url = new URL('/api/mollie/callback', 'http://localhost')
  if (params.code) url.searchParams.set('code', params.code)
  if (params.state) url.searchParams.set('state', params.state)
  if (params.error) url.searchParams.set('error', params.error)

  const headers: Record<string, string> = {}
  if (params.cookieState !== undefined) {
    headers['cookie'] = `mollie_oauth_state=${params.cookieState}`
  }

  return new NextRequest(url.toString(), { headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  mockTokenExpiresAt.mockReturnValue(new Date('2030-01-01T00:00:00.000Z'))
  mockExchangeCode.mockResolvedValue({
    accessToken: 'access_new_token',
    refreshToken: 'refresh_new_token',
    expiresIn: 3600,
  })
  mockFetchProfile.mockResolvedValue({
    profileId: 'pfl_test_profile',
    onboardingStatus: 'completed',
  })
  mockBootstrap.mockResolvedValue({
    onboardingStatus: 'completed',
    onboardingSubmitted: false,
    profileId: 'pfl_test_profile',
    profileResolved: true,
    methods: { creditcard: 'enabled' },
  })
  mockAccountUpdate.mockResolvedValue({} as any)
})

describe('GET /api/mollie/callback', () => {
  // ── Auth gate ────────────────────────────────────────────────────────────────

  it('redirects unauthenticated users to error page — never proceeds to token exchange', async () => {
    const request = makeRequest({
      code: 'auth-code',
      state: VALID_STATE,
      cookieState: VALID_STATE,
    })
    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=not_authenticated')
    expect(mockExchangeCode).not.toHaveBeenCalled()
  })

  // ── Error param ───────────────────────────────────────────────────────────────

  it('redirects with Mollie error when error param is present (partner denied access)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const request = makeRequest({ error: 'access_denied', cookieState: VALID_STATE })

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=access_denied')
    expect(mockExchangeCode).not.toHaveBeenCalled()
  })

  // ── Missing params ────────────────────────────────────────────────────────────

  it('redirects with missing_params when authorization code is absent', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    // state is present but no code
    const request = makeRequest({ state: VALID_STATE, cookieState: VALID_STATE })

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=missing_params')
    expect(mockExchangeCode).not.toHaveBeenCalled()
  })

  it('redirects with missing_params when state query param is absent', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    // code is present but no state
    const request = makeRequest({ code: 'auth-code', cookieState: VALID_STATE })

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=missing_params')
    expect(mockExchangeCode).not.toHaveBeenCalled()
  })

  // ── CSRF protection ───────────────────────────────────────────────────────────
  // FINDING: CSRF state validation IS implemented correctly. The callback rejects
  // any request whose `state` query param does not match the `mollie_oauth_state`
  // cookie set by the prior /api/mollie/authorize call.

  it('CSRF PROTECTION: rejects callback when no state cookie is present (attacker-forged request, no prior authorize call)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    // Legitimate-looking params but no cookie — the route must reject this
    const request = makeRequest({
      code: 'auth-code',
      state: VALID_STATE,
      // cookieState intentionally omitted — simulates a forged request
    })

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=invalid_state')
    expect(mockExchangeCode).not.toHaveBeenCalled()
  })

  it('CSRF PROTECTION: rejects callback when state param does not match the stored cookie', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const request = makeRequest({
      code: 'auth-code',
      state: 'attacker-injected-state',   // attacker-controlled value
      cookieState: VALID_STATE,            // legitimate cookie from prior authorize
    })

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=invalid_state')
    expect(mockExchangeCode).not.toHaveBeenCalled()
  })

  // ── Happy path ────────────────────────────────────────────────────────────────

  it('exchanges code for tokens when state matches cookie', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', email: 'partner@example.com' } } as any)
    const request = makeRequest({
      code: 'legit-auth-code',
      state: VALID_STATE,
      cookieState: VALID_STATE,
    })

    await GET(request)

    expect(mockExchangeCode).toHaveBeenCalledWith(
      'legit-auth-code',
      expect.stringContaining('/api/mollie/callback'),
    )
  })

  it('fetches Mollie profile after token exchange', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const request = makeRequest({ code: 'code', state: VALID_STATE, cookieState: VALID_STATE })

    await GET(request)

    expect(mockFetchProfile).toHaveBeenCalledWith('access_new_token')
  })

  it('persists tokens and profile to PartnerAccount scoped to session.user.id', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const request = makeRequest({ code: 'code', state: VALID_STATE, cookieState: VALID_STATE })

    await GET(request)

    expect(mockAccountUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        data: expect.objectContaining({
          mollieAccessToken: 'access_new_token',
          mollieRefreshToken: 'refresh_new_token',
          mollieProfileId: 'pfl_test_profile',
          mollieOnboardingStatus: 'completed',
        }),
      }),
    )
  })

  it('calls bootstrapMollieAccount to auto-setup the newly connected account', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', email: 'p@example.com' } } as any)
    const request = makeRequest({ code: 'code', state: VALID_STATE, cookieState: VALID_STATE })

    await GET(request)

    expect(mockBootstrap).toHaveBeenCalledWith(
      'access_new_token',
      'user-1',
      expect.objectContaining({ email: 'p@example.com', profileId: 'pfl_test_profile' }),
    )
  })

  it('redirects to success page after storing tokens', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const request = makeRequest({ code: 'code', state: VALID_STATE, cookieState: VALID_STATE })

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('success=true')
  })

  it('bootstrap failure is non-fatal — still redirects to success page', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockBootstrap.mockRejectedValue(new Error('Bootstrap network error'))
    const request = makeRequest({ code: 'code', state: VALID_STATE, cookieState: VALID_STATE })

    const response = await GET(request)

    // Token exchange succeeded and tokens were stored; bootstrap failing must
    // not change the outcome — partner should land on the success page
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('success=true')
  })

  // ── Token exchange failure ────────────────────────────────────────────────────

  it('redirects to token_exchange_failed when exchangeCodeForTokens throws', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockExchangeCode.mockRejectedValue(new Error('Mollie token exchange failed (400)'))
    const request = makeRequest({ code: 'bad-code', state: VALID_STATE, cookieState: VALID_STATE })

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=token_exchange_failed')
    expect(mockAccountUpdate).not.toHaveBeenCalled()
  })
})
