/**
 * Tests for app/api/_lib/mollie.ts — Partner-side Mollie OAuth + payment utilities.
 *
 * Mocking boundary:
 *  - global fetch (vi.stubGlobal) — raw HTTP calls to api.mollie.com / my.mollie.com
 *  - @mollie/api-client (vi.mock)  — SDK instance (clientLinks, profiles, payments, etc.)
 *  - @repo/data/mollie-tokens (vi.mock) — getValidMollieToken centralized token manager
 *  - @repo/data/env (vi.mock)       — isTestMode flag
 *  - process.env                    — env vars read by requireEnv() at call time (not load time)
 *
 * @repo/data/PrismaCient is aliased to the project mock via vitest.config.ts and is
 * picked up automatically for the dynamic import inside bootstrapMollieAccount.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Module mocks — must precede any import that transitively loads them ──────

vi.mock('@mollie/api-client', () => ({
  default: vi.fn(),
}))

vi.mock('@repo/data/mollie-tokens', () => ({
  getValidMollieToken: vi.fn(),
}))

vi.mock('@repo/data/env', () => ({
  isTestMode: vi.fn(),
}))

// ── Imports (after mocks are declared) ───────────────────────────────────────

import createMollieClient from '@mollie/api-client'
import { getValidMollieToken } from '@repo/data/mollie-tokens'
import { isTestMode } from '@repo/data/env'
import prisma from '@repo/data/PrismaCient'

import {
  getMollieClientId,
  getMollieClientSecret,
  getOrgAccessToken,
  OAUTH_SCOPES,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  createClientLink,
  bootstrapMollieAccount,
  fetchMollieProfile,
  refundDepositPayment,
  type ClientLinkData,
} from '@/app/api/_lib/mollie'

const mockCreateMollieClient = vi.mocked(createMollieClient)
const mockGetValidMollieToken = vi.mocked(getValidMollieToken)
const mockIsTestMode = vi.mocked(isTestMode)
const mockAccountFindUnique = vi.mocked(prisma.partnerAccount.findUnique)
const mockAccountUpdate = vi.mocked(prisma.partnerAccount.update)

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal Response-shaped mock for global fetch. */
function mockResponse(status: number, body: unknown): Response {
  const isOk = status >= 200 && status < 300
  return {
    ok: isOk,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

// ── Global setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn())

  // Env vars read at call time — safe to set/delete per-test or via beforeEach
  process.env.MOLLIE_CLIENT_ID = 'app_test_client_id'
  process.env.MOLLIE_CLIENT_SECRET = 'test_client_secret'
  process.env.MOLLIE_ORG_TOKEN = 'access_test_org_token'

  mockIsTestMode.mockReturnValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.MOLLIE_CLIENT_ID
  delete process.env.MOLLIE_CLIENT_SECRET
  delete process.env.MOLLIE_ORG_TOKEN
})

// ── Config / env helpers ──────────────────────────────────────────────────────

describe('getMollieClientId', () => {
  it('returns MOLLIE_CLIENT_ID when set', () => {
    expect(getMollieClientId()).toBe('app_test_client_id')
  })

  it('throws when MOLLIE_CLIENT_ID is unset — misconfiguration must fail fast', () => {
    delete process.env.MOLLIE_CLIENT_ID
    expect(() => getMollieClientId()).toThrow('MOLLIE_CLIENT_ID is not set')
  })
})

describe('getMollieClientSecret', () => {
  it('returns MOLLIE_CLIENT_SECRET when set', () => {
    expect(getMollieClientSecret()).toBe('test_client_secret')
  })

  it('throws when MOLLIE_CLIENT_SECRET is unset — misconfiguration must fail fast', () => {
    delete process.env.MOLLIE_CLIENT_SECRET
    expect(() => getMollieClientSecret()).toThrow('MOLLIE_CLIENT_SECRET is not set')
  })
})

describe('getOrgAccessToken', () => {
  it('returns MOLLIE_ORG_TOKEN when set', () => {
    expect(getOrgAccessToken()).toBe('access_test_org_token')
  })

  it('throws when MOLLIE_ORG_TOKEN is unset — misconfiguration must fail fast', () => {
    delete process.env.MOLLIE_ORG_TOKEN
    expect(() => getOrgAccessToken()).toThrow('MOLLIE_ORG_TOKEN is not set')
  })
})

// ── OAUTH_SCOPES ──────────────────────────────────────────────────────────────

describe('OAUTH_SCOPES', () => {
  // The file header comment lists only 4 scopes, but bootstrapMollieAccount
  // requires profiles.write (for profileMethods.enable) and onboarding.write
  // (for POST /v2/onboarding/me). All six are legitimately needed.
  it('contains all six required OAuth scopes separated by +', () => {
    const scopes = OAUTH_SCOPES.split('+')
    expect(scopes).toContain('payments.read')
    expect(scopes).toContain('payments.write')
    expect(scopes).toContain('profiles.read')
    expect(scopes).toContain('profiles.write')   // needed for profileMethods.enable
    expect(scopes).toContain('onboarding.read')
    expect(scopes).toContain('onboarding.write') // needed for POST /v2/onboarding/me
    expect(scopes).toHaveLength(6)
  })
})

// ── buildAuthorizationUrl ─────────────────────────────────────────────────────

describe('buildAuthorizationUrl', () => {
  it('returns a URL pointing at the Mollie authorization endpoint', () => {
    const url = buildAuthorizationUrl('csrf-state', 'https://example.com/callback')
    expect(url).toMatch(/^https:\/\/my\.mollie\.com\/oauth2\/authorize/)
  })

  it('includes client_id from MOLLIE_CLIENT_ID env var', () => {
    const url = buildAuthorizationUrl('state', 'https://example.com/callback')
    expect(url).toContain('client_id=app_test_client_id')
  })

  it('includes the redirect_uri', () => {
    const url = buildAuthorizationUrl('state', 'https://partner.example.com/mollie/callback')
    // URLSearchParams percent-encodes the URI
    expect(url).toContain('redirect_uri=')
    expect(url).toContain('partner.example.com')
  })

  it('includes state parameter for CSRF protection', () => {
    const url = buildAuthorizationUrl('my-csrf-state-abc', 'https://example.com/callback')
    expect(url).toContain('state=my-csrf-state-abc')
  })

  it('sets response_type=code for authorization code flow', () => {
    const url = buildAuthorizationUrl('state', 'https://example.com/callback')
    expect(url).toContain('response_type=code')
  })

  it('includes all OAuth scopes in the URL (URLSearchParams encodes + as %2B)', () => {
    // OAUTH_SCOPES joins with '+'; URLSearchParams encodes the literal '+' as '%2B'.
    // Mollie's OAuth parser accepts '%2B'-separated scopes in production — this is
    // functionally correct even though the OAuth spec uses space-separated scopes.
    const url = buildAuthorizationUrl('state', 'https://example.com/callback')
    expect(url).toContain('payments.read')
    expect(url).toContain('payments.write')
    expect(url).toContain('profiles.read')
    expect(url).toContain('profiles.write')
    expect(url).toContain('onboarding.read')
    expect(url).toContain('onboarding.write')
  })

  it('includes approval_prompt parameter', () => {
    const url = buildAuthorizationUrl('state', 'https://example.com/callback')
    expect(url).toContain('approval_prompt=')
  })

  it('uses the state value supplied by the caller (not a hardcoded value)', () => {
    const url1 = buildAuthorizationUrl('state-aaa', 'https://example.com/cb')
    const url2 = buildAuthorizationUrl('state-bbb', 'https://example.com/cb')
    expect(url1).toContain('state=state-aaa')
    expect(url2).toContain('state=state-bbb')
    expect(url1).not.toContain('state=state-bbb')
  })
})

// ── exchangeCodeForTokens ─────────────────────────────────────────────────────

describe('exchangeCodeForTokens', () => {
  it('POSTs to the Mollie token URL with grant_type=authorization_code, code, redirect_uri, and client creds', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse(200, { access_token: 'at', refresh_token: 'rt', expires_in: 3600 })
    )

    await exchangeCodeForTokens('auth-code-xyz', 'https://example.com/callback')

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, options] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.mollie.com/oauth2/tokens')
    expect(options.method).toBe('POST')
    expect((options.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded'
    )

    const body = new URLSearchParams(options.body as string)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('auth-code-xyz')
    expect(body.get('redirect_uri')).toBe('https://example.com/callback')
    expect(body.get('client_id')).toBe('app_test_client_id')
    expect(body.get('client_secret')).toBe('test_client_secret')
  })

  it('returns parsed MollieTokens { accessToken, refreshToken, expiresIn } on success', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse(200, { access_token: 'access_new', refresh_token: 'refresh_new', expires_in: 7200 })
    )

    const tokens = await exchangeCodeForTokens('code-123', 'https://example.com/cb')

    expect(tokens).toEqual({
      accessToken: 'access_new',
      refreshToken: 'refresh_new',
      expiresIn: 7200,
    })
  })

  it('throws on 400 (invalid_grant / bad code) — must not silently return empty tokens', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 400,
      text: vi.fn().mockResolvedValue('{"error":"invalid_grant"}'),
    } as unknown as Response)

    await expect(exchangeCodeForTokens('bad-code', 'https://example.com/cb'))
      .rejects.toThrow('Mollie token exchange failed (400)')
  })

  it('throws on 500 server error — must not silently return empty tokens', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Internal Server Error'),
    } as unknown as Response)

    await expect(exchangeCodeForTokens('code', 'https://example.com/cb'))
      .rejects.toThrow('Mollie token exchange failed (500)')
  })
})

// ── refreshAccessToken ────────────────────────────────────────────────────────
// Money-critical: a silent failure here leaves the partner unable to take
// payments without any visible error. Every error path must throw.

describe('refreshAccessToken', () => {
  it('POSTs to the Mollie token URL with grant_type=refresh_token and the provided refresh token', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse(200, { access_token: 'at_refreshed', refresh_token: 'rt_rotated', expires_in: 3600 })
    )

    await refreshAccessToken('my-refresh-token')

    const [url, options] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.mollie.com/oauth2/tokens')
    expect(options.method).toBe('POST')

    const body = new URLSearchParams(options.body as string)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('my-refresh-token')
    expect(body.get('client_id')).toBe('app_test_client_id')
    expect(body.get('client_secret')).toBe('test_client_secret')
  })

  it('returns the new MollieTokens including the rotated refresh token', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse(200, { access_token: 'at_refreshed', refresh_token: 'rt_rotated', expires_in: 3600 })
    )

    const tokens = await refreshAccessToken('old-refresh-token')

    expect(tokens).toEqual({
      accessToken: 'at_refreshed',
      refreshToken: 'rt_rotated',
      expiresIn: 3600,
    })
  })

  it('throws on 400 invalid_grant (dead token) — must NOT silently return a bad/empty token', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 400,
      text: vi.fn().mockResolvedValue(
        '{"error":"invalid_grant","error_description":"The refresh token is invalid or expired"}'
      ),
    } as unknown as Response)

    // This is the most critical error path: a dead refresh token must surface as
    // an exception, not a silent failure with undefined/null tokens that would
    // cause the partner's payment flow to mysteriously fail later.
    await expect(refreshAccessToken('dead-refresh-token'))
      .rejects.toThrow('Mollie token refresh failed (400)')
  })

  it('throws on 401 unauthorized — must NOT silently return a bad token', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue('Unauthorized'),
    } as unknown as Response)

    await expect(refreshAccessToken('refresh-token'))
      .rejects.toThrow('Mollie token refresh failed (401)')
  })

  it('throws on 500 server error — must NOT silently return a bad token', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Internal Server Error'),
    } as unknown as Response)

    await expect(refreshAccessToken('refresh-token'))
      .rejects.toThrow('Mollie token refresh failed (500)')
  })
})

// ── createClientLink ──────────────────────────────────────────────────────────

describe('createClientLink', () => {
  const validData: ClientLinkData = {
    owner: { email: 'owner@example.com', givenName: 'Jan', familyName: 'de Vries' },
    name: 'Beach Club BV',
    address: { country: 'NL', city: 'Amsterdam', postalCode: '1012 AB' },
  }

  it('throws if MOLLIE_ORG_TOKEN does not start with "access_" (wrong token type)', async () => {
    process.env.MOLLIE_ORG_TOKEN = 'live_xxxxxxxxxxxx' // API key, not org access token

    await expect(createClientLink(validData)).rejects.toThrow(
      'MOLLIE_ORG_TOKEN must be an Organization Access Token (starts with access_)'
    )
    expect(mockCreateMollieClient).not.toHaveBeenCalled()
  })

  it('creates a Mollie client with the org token and returns the clientLink href', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      _links: { clientLink: { href: 'https://my.mollie.com/clientlink/abc123' } },
    })
    mockCreateMollieClient.mockReturnValue({ clientLinks: { create: mockCreate } } as any)

    const result = await createClientLink(validData)

    expect(mockCreateMollieClient).toHaveBeenCalledWith({ accessToken: 'access_test_org_token' })
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(result).toBe('https://my.mollie.com/clientlink/abc123')
  })

  it('passes owner, name, and address to the API', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      _links: { clientLink: { href: 'https://my.mollie.com/clientlink/xyz' } },
    })
    mockCreateMollieClient.mockReturnValue({ clientLinks: { create: mockCreate } } as any)

    await createClientLink(validData)

    const callArg = mockCreate.mock.calls[0][0]
    expect(callArg.owner.email).toBe('owner@example.com')
    expect(callArg.name).toBe('Beach Club BV')
    expect(callArg.address.country).toBe('NL')
  })

  it('includes optional registrationNumber and vatNumber when provided', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      _links: { clientLink: { href: 'https://my.mollie.com/clientlink/xyz' } },
    })
    mockCreateMollieClient.mockReturnValue({ clientLinks: { create: mockCreate } } as any)

    await createClientLink({
      ...validData,
      registrationNumber: 'KVK-12345678',
      vatNumber: 'NL000099998B57',
    })

    const callArg = mockCreate.mock.calls[0][0]
    expect(callArg.registrationNumber).toBe('KVK-12345678')
    expect(callArg.vatNumber).toBe('NL000099998B57')
  })

  it('throws when the SDK response does not contain a clientLink URL', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ _links: {} }) // missing clientLink
    mockCreateMollieClient.mockReturnValue({ clientLinks: { create: mockCreate } } as any)

    await expect(createClientLink(validData)).rejects.toThrow(
      'Mollie client link response did not contain a clientLink URL'
    )
  })

  it('propagates SDK errors so the caller is not silently misled', async () => {
    const sdkErr = Object.assign(new Error('Unauthorized'), { statusCode: 401, title: 'Unauthorized' })
    const mockCreate = vi.fn().mockRejectedValue(sdkErr)
    mockCreateMollieClient.mockReturnValue({ clientLinks: { create: mockCreate } } as any)

    await expect(createClientLink(validData)).rejects.toThrow('Unauthorized')
  })
})

// ── fetchMollieProfile ────────────────────────────────────────────────────────

describe('fetchMollieProfile', () => {
  it('returns profileId and onboardingStatus from the Mollie API', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockResponse(200, { status: 'in-review' }))
      .mockResolvedValueOnce(
        mockResponse(200, { _embedded: { profiles: [{ id: 'pfl_abc123' }] } })
      )

    const result = await fetchMollieProfile('access_user_token')

    expect(result).toEqual({ profileId: 'pfl_abc123', onboardingStatus: 'in-review' })
  })

  it('sends Authorization: Bearer header to both endpoints', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockResponse(200, { status: 'completed' }))
      .mockResolvedValueOnce(
        mockResponse(200, { _embedded: { profiles: [{ id: 'pfl_x' }] } })
      )

    await fetchMollieProfile('access_mytoken')

    const calls = vi.mocked(global.fetch).mock.calls as [string, RequestInit][]
    expect(calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer access_mytoken' } })
    expect(calls[1][1]).toMatchObject({ headers: { Authorization: 'Bearer access_mytoken' } })
  })

  it('returns onboardingStatus=unknown when the onboarding endpoint is non-OK', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: vi.fn(),
        text: vi.fn(),
      } as unknown as Response)
      .mockResolvedValueOnce(
        mockResponse(200, { _embedded: { profiles: [{ id: 'pfl_abc' }] } })
      )

    const result = await fetchMollieProfile('access_token')

    expect(result.onboardingStatus).toBe('unknown')
    expect(result.profileId).toBe('pfl_abc')
  })

  it('returns empty profileId when the profiles endpoint is non-OK', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockResponse(200, { status: 'completed' }))
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: vi.fn(),
        text: vi.fn(),
      } as unknown as Response)

    const result = await fetchMollieProfile('access_token')

    expect(result.profileId).toBe('')
    expect(result.onboardingStatus).toBe('completed')
  })

  it('returns empty profileId when profiles array is empty', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockResponse(200, { status: 'completed' }))
      .mockResolvedValueOnce(mockResponse(200, { _embedded: { profiles: [] } }))

    const result = await fetchMollieProfile('access_token')

    expect(result.profileId).toBe('')
  })

  it('queries profiles endpoint with ?limit=1', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockResponse(200, { status: 'completed' }))
      .mockResolvedValueOnce(mockResponse(200, { _embedded: { profiles: [] } }))

    await fetchMollieProfile('access_token')

    const calls = vi.mocked(global.fetch).mock.calls as [string, RequestInit][]
    expect(calls[1][0]).toContain('?limit=1')
  })
})

// ── refundDepositPayment ──────────────────────────────────────────────────────
// Money-out path. Errors must propagate so the caller doesn't mark the deposit
// as refunded when the money never moved.

describe('refundDepositPayment', () => {
  it('is a no-op for demo payment refs (pi_demo_) — no token fetch, no SDK calls', async () => {
    await refundDepositPayment('pi_demo_1234567890_abc', 'partner-account-id')

    expect(mockGetValidMollieToken).not.toHaveBeenCalled()
    expect(mockCreateMollieClient).not.toHaveBeenCalled()
  })

  it('throws immediately when partnerAccountId is null', async () => {
    await expect(refundDepositPayment('tr_real_payment', null)).rejects.toThrow(
      'Partner has no Mollie connection'
    )
  })

  it('throws immediately when partnerAccountId is undefined', async () => {
    await expect(refundDepositPayment('tr_real_payment', undefined)).rejects.toThrow(
      'Partner has no Mollie connection'
    )
  })

  it('obtains a valid token via getValidMollieToken, then fetches payment and creates refund', async () => {
    mockGetValidMollieToken.mockResolvedValue('access_fresh_token')
    const mockPaymentsGet = vi.fn().mockResolvedValue({
      amount: { value: '25.00', currency: 'EUR' },
    })
    const mockRefundsCreate = vi.fn().mockResolvedValue({})
    mockCreateMollieClient.mockReturnValue({
      payments: { get: mockPaymentsGet },
      paymentRefunds: { create: mockRefundsCreate },
    } as any)

    await refundDepositPayment('tr_abc123', 'partner-account-id')

    expect(mockGetValidMollieToken).toHaveBeenCalledWith('partner-account-id')
    expect(mockCreateMollieClient).toHaveBeenCalledWith({ accessToken: 'access_fresh_token' })
    expect(mockPaymentsGet).toHaveBeenCalledWith('tr_abc123', expect.objectContaining({ testmode: true }))
    expect(mockRefundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'tr_abc123',
        amount: { value: '25.00', currency: 'EUR' },
      })
    )
  })

  it('propagates errors from getValidMollieToken (reconnect required) — must not be swallowed', async () => {
    mockGetValidMollieToken.mockRejectedValue(
      new Error('Mollie account must be reconnected')
    )

    await expect(refundDepositPayment('tr_payment', 'partner-id')).rejects.toThrow(
      'Mollie account must be reconnected'
    )
  })

  it('propagates errors from paymentRefunds.create — money did not move, must not be swallowed', async () => {
    mockGetValidMollieToken.mockResolvedValue('access_token')
    const mockPaymentsGet = vi.fn().mockResolvedValue({
      amount: { value: '50.00', currency: 'EUR' },
    })
    const refundErr = Object.assign(new Error('Payment is not refundable'), { statusCode: 422 })
    const mockRefundsCreate = vi.fn().mockRejectedValue(refundErr)
    mockCreateMollieClient.mockReturnValue({
      payments: { get: mockPaymentsGet },
      paymentRefunds: { create: mockRefundsCreate },
    } as any)

    await expect(refundDepositPayment('tr_not_refundable', 'partner-id')).rejects.toThrow(
      'Payment is not refundable'
    )
  })

  it('propagates errors from payments.get — refund must not proceed on a missing payment', async () => {
    mockGetValidMollieToken.mockResolvedValue('access_token')
    const mockPaymentsGet = vi.fn().mockRejectedValue(
      Object.assign(new Error('Payment not found'), { statusCode: 404 })
    )
    const mockRefundsCreate = vi.fn()
    mockCreateMollieClient.mockReturnValue({
      payments: { get: mockPaymentsGet },
      paymentRefunds: { create: mockRefundsCreate },
    } as any)

    await expect(refundDepositPayment('tr_unknown', 'partner-id')).rejects.toThrow(
      'Payment not found'
    )
    expect(mockRefundsCreate).not.toHaveBeenCalled()
  })
})

// ── bootstrapMollieAccount ────────────────────────────────────────────────────
// Complex orchestration function. By design it never throws — errors are logged
// and a partial result is returned. Tests assert correct happy paths and confirm
// the no-throw contract.

describe('bootstrapMollieAccount', () => {
  function makeMockClient(overrides: Partial<{
    onboarding: object
    profiles: object
    profileMethods: object
  }> = {}) {
    return {
      onboarding: { get: vi.fn().mockResolvedValue({ status: 'completed' }) },
      profiles: { page: vi.fn().mockResolvedValue([{ id: 'pfl_bootstrap' }]) },
      profileMethods: { enable: vi.fn().mockResolvedValue({}) },
      ...overrides,
    }
  }

  beforeEach(() => {
    // Set a default working client; individual tests override as needed
    mockCreateMollieClient.mockImplementation(() => makeMockClient() as any)
    mockAccountFindUnique.mockResolvedValue(null)
    mockAccountUpdate.mockResolvedValue({} as any)
  })

  it('returns a BootstrapResult with onboardingStatus from Mollie', async () => {
    mockCreateMollieClient.mockReturnValue(
      makeMockClient({ onboarding: { get: vi.fn().mockResolvedValue({ status: 'in-review' }) } }) as any
    )

    const result = await bootstrapMollieAccount('access_token', 'user-1', { profileId: 'pfl_existing' })

    expect(result.onboardingStatus).toBe('in-review')
  })

  it('never throws — catches all errors from every step and returns a partial result', async () => {
    mockCreateMollieClient.mockReturnValue({
      onboarding: { get: vi.fn().mockRejectedValue(new Error('Network error')) },
      profiles: { page: vi.fn().mockRejectedValue(new Error('Network error')) },
      profileMethods: { enable: vi.fn().mockRejectedValue(new Error('Not allowed')) },
    } as any)

    await expect(bootstrapMollieAccount('access_token', 'user-1')).resolves.toBeDefined()
  })

  it("resolves profileId from the partner's first Mollie profile when none is provided", async () => {
    mockCreateMollieClient.mockReturnValue(
      makeMockClient({
        profiles: { page: vi.fn().mockResolvedValue([{ id: 'pfl_fetched' }]) },
      }) as any
    )

    const result = await bootstrapMollieAccount('access_token', 'user-1', { profileId: null })

    expect(result.profileId).toBe('pfl_fetched')
    expect(result.profileResolved).toBe(true)
    // Profile ID is persisted to DB
    expect(mockAccountUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        data: expect.objectContaining({ mollieProfileId: 'pfl_fetched' }),
      })
    )
  })

  it('uses an already-known profileId and does not fetch profiles', async () => {
    const mockPage = vi.fn()
    mockCreateMollieClient.mockReturnValue(
      makeMockClient({ profiles: { page: mockPage } }) as any
    )

    const result = await bootstrapMollieAccount('access_token', 'user-1', { profileId: 'pfl_already_known' })

    expect(result.profileId).toBe('pfl_already_known')
    expect(mockPage).not.toHaveBeenCalled()
  })

  it('enables all default payment methods on the profile', async () => {
    const mockEnable = vi.fn().mockResolvedValue({})
    mockCreateMollieClient.mockReturnValue(
      makeMockClient({ profileMethods: { enable: mockEnable } }) as any
    )

    await bootstrapMollieAccount('access_token', 'user-1', { profileId: 'pfl_test' })

    const enabledIds = mockEnable.mock.calls.map((c) => c[0].id)
    expect(enabledIds).toContain('creditcard')
    expect(enabledIds).toContain('ideal')
    expect(enabledIds).toContain('bancontact')
    expect(enabledIds).toContain('banktransfer')
    expect(enabledIds).toContain('applepay')
  })

  it('submits onboarding data via raw fetch when status is needs-data', async () => {
    const mockFetch = vi.mocked(global.fetch)
    // First onboarding.get returns needs-data; second (re-check after submit) returns in-review
    const mockOnboardingGet = vi.fn()
      .mockResolvedValueOnce({ status: 'needs-data' })
      .mockResolvedValueOnce({ status: 'in-review' })

    mockCreateMollieClient.mockReturnValue(
      makeMockClient({
        onboarding: { get: mockOnboardingGet },
        profiles: { page: vi.fn().mockResolvedValue([{ id: 'pfl_new' }]) },
      }) as any
    )

    // Partner account data for the submit payload
    mockAccountFindUnique.mockResolvedValue({
      company: 'Test Beach Club',
      address: 'Beachfront 1',
      city: 'Barcelona',
      postalCode: '08001',
      country: 'ES',
      websiteUrl: 'https://testclub.com',
      email: 'info@testclub.com',
    } as any)

    // Raw fetch for the onboarding POST — 204 No Content = success
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
      text: vi.fn().mockResolvedValue(''),
    } as unknown as Response)

    const result = await bootstrapMollieAccount('access_token', 'user-1')

    // Should have POSTed to the Mollie onboarding endpoint
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.mollie.com/v2/onboarding/me',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer access_token' }),
      })
    )
    expect(result.onboardingSubmitted).toBe(true)
    expect(result.onboardingStatus).toBe('in-review')
  })

  it('records method enable failures in the result but does not throw', async () => {
    const mockEnable = vi.fn()
      .mockResolvedValueOnce({}) // creditcard succeeds
      .mockRejectedValue(Object.assign(new Error('Method unavailable'), { detail: 'Method not supported' }))
    mockCreateMollieClient.mockReturnValue(
      makeMockClient({ profileMethods: { enable: mockEnable } }) as any
    )

    const result = await bootstrapMollieAccount('access_token', 'user-1', { profileId: 'pfl_test' })

    expect(result.methods['creditcard']).toBe('enabled')
    // Failed methods are recorded by their error detail, not thrown
    expect(result.methods['ideal']).not.toBe('enabled')
  })
})
