/**
 * Tests for GET /api/mollie/authorize
 *
 * Covers: auth gate, CSRF state generation + cookie, redirect to Mollie
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/app/api/_lib/mollie', () => ({
  buildAuthorizationUrl: vi.fn(),
}))

import { GET } from './route'
import { auth } from '@/app/auth'
import { buildAuthorizationUrl } from '@/app/api/_lib/mollie'
import { NextRequest } from 'next/server'

const mockAuth = vi.mocked(auth)
const mockBuildAuthorizationUrl = vi.mocked(buildAuthorizationUrl)

const MOCK_AUTH_URL =
  'https://my.mollie.com/oauth2/authorize?state=test-state&client_id=app_test'

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/mollie/authorize')
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  mockBuildAuthorizationUrl.mockReturnValue(MOCK_AUTH_URL)
})

describe('GET /api/mollie/authorize', () => {
  // ── Auth gate ────────────────────────────────────────────────────────────────

  it('returns 401 when not authenticated — does not build an auth URL', async () => {
    const response = await GET(makeRequest())
    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data.error).toBe('Not authenticated')
    expect(mockBuildAuthorizationUrl).not.toHaveBeenCalled()
  })

  // ── Happy path ────────────────────────────────────────────────────────────────

  it('redirects to the Mollie authorization URL returned by buildAuthorizationUrl', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', email: 'test@test.com' } } as any)

    const response = await GET(makeRequest())

    // Should be a redirect (307 Temporary Redirect is Next.js default)
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('my.mollie.com/oauth2/authorize')
  })

  it('calls buildAuthorizationUrl with a non-empty state string and a redirectUri', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)

    await GET(makeRequest())

    expect(mockBuildAuthorizationUrl).toHaveBeenCalledTimes(1)
    const [stateArg, redirectUriArg] = mockBuildAuthorizationUrl.mock.calls[0] as [string, string]
    expect(typeof stateArg).toBe('string')
    expect(stateArg.length).toBeGreaterThan(0)
    expect(redirectUriArg).toContain('/api/mollie/callback')
  })

  // ── CSRF state cookie ─────────────────────────────────────────────────────────

  it('sets an httpOnly mollie_oauth_state cookie on the response', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)

    const response = await GET(makeRequest())

    // NextResponse sets cookies as Set-Cookie headers
    const setCookie = response.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('mollie_oauth_state=')
    expect(setCookie).toContain('HttpOnly')
  })

  it('cookie value matches the state passed to buildAuthorizationUrl', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)

    await GET(makeRequest())

    // The state arg passed to buildAuthorizationUrl should be the same value
    // that was set in the cookie
    const [stateArg] = mockBuildAuthorizationUrl.mock.calls[0] as [string, string]
    // stateArg is a 32-char hex string (crypto.randomBytes(16).toString('hex'))
    expect(stateArg).toMatch(/^[0-9a-f]{32}$/)
  })

  it('generates a different state on each call — random CSRF token, not hardcoded', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)

    await GET(makeRequest())
    await GET(makeRequest())

    const state1 = mockBuildAuthorizationUrl.mock.calls[0][0] as string
    const state2 = mockBuildAuthorizationUrl.mock.calls[1][0] as string
    expect(state1).not.toBe(state2)
  })
})
