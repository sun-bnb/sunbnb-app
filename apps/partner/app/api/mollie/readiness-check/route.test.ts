/**
 * Tests for GET /api/mollie/readiness-check
 *
 * Covers: auth gate, no Mollie account, scope isolation to session.user.id,
 * invalid token (SDK throws), happy path with all checks green, onboarding sync.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

// The route imports createMollieClient directly (not via _lib/mollie)
vi.mock('@mollie/api-client', () => ({
  default: vi.fn(),
}))

import { GET } from './route'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import createMollieClient from '@mollie/api-client'

const mockAuth = vi.mocked(auth)
const mockCreateMollieClient = vi.mocked(createMollieClient)
const mockAccountFindUnique = vi.mocked(prisma.partnerAccount.findUnique)
const mockAccountUpdate = vi.mocked(prisma.partnerAccount.update)

const USER_ID = 'user-1'

/** Build a minimal Mollie SDK mock. */
function makeMollieClient(overrides: {
  profilesPage?: ReturnType<typeof vi.fn>
  onboardingGet?: ReturnType<typeof vi.fn>
} = {}) {
  return {
    profiles: {
      page: overrides.profilesPage ?? vi.fn().mockResolvedValue([{ id: 'pfl_test', status: 'verified' }]),
    },
    onboarding: {
      get: overrides.onboardingGet ?? vi.fn().mockResolvedValue({ status: 'completed' }),
    },
  }
}

/** Build a minimal Response mock for global fetch. */
function mockFetchResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  vi.stubGlobal('fetch', vi.fn())
  // Default: methods/all returns two enabled methods
  vi.mocked(global.fetch).mockResolvedValue(
    mockFetchResponse(200, {
      _embedded: {
        methods: [
          { id: 'creditcard', status: 'activated' },
          { id: 'ideal', status: 'activated' },
        ],
      },
    }),
  )
  mockAccountUpdate.mockResolvedValue({} as any)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/mollie/readiness-check', () => {
  // ── Auth gate ────────────────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    const response = await GET()
    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data.error).toBe('Not authenticated')
    expect(mockAccountFindUnique).not.toHaveBeenCalled()
    expect(mockCreateMollieClient).not.toHaveBeenCalled()
  })

  // ── No Mollie account ─────────────────────────────────────────────────────────

  it('returns 400 when partner has no Mollie access token', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockAccountFindUnique.mockResolvedValue({
      mollieAccessToken: null,
      mollieProfileId: null,
      mollieOnboardingStatus: null,
    } as any)

    const response = await GET()
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('No Mollie account connected')
    expect(mockCreateMollieClient).not.toHaveBeenCalled()
  })

  // ── Scope isolation to session.user.id ────────────────────────────────────────

  it('scopes the partnerAccount query to session.user.id — cannot inspect another user\'s tokens', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockAccountFindUnique.mockResolvedValue({
      mollieAccessToken: null,
      mollieProfileId: null,
      mollieOnboardingStatus: null,
    } as any)

    await GET()

    expect(mockAccountFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID } }),
    )
  })

  // ── Invalid / expired token ───────────────────────────────────────────────────

  it('returns report with tokenValid=false when Mollie SDK throws on profiles.page (expired token)', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockAccountFindUnique.mockResolvedValue({
      mollieAccessToken: 'access_expired',
      mollieProfileId: null,
      mollieOnboardingStatus: null,
    } as any)
    mockCreateMollieClient.mockReturnValue(
      makeMollieClient({
        profilesPage: vi.fn().mockRejectedValue(Object.assign(new Error('401 Unauthorized'), { statusCode: 401 })),
      }) as any,
    )

    const response = await GET()
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.tokenValid).toBe(false)
    expect(data.profileActive).toBe(false)
    expect(data.ready).toBe(false)
  })

  // ── Happy path ────────────────────────────────────────────────────────────────

  it('creates Mollie client with the access token from the partner account', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockAccountFindUnique.mockResolvedValue({
      mollieAccessToken: 'access_test_token_xyz',
      mollieProfileId: 'pfl_test',
      mollieOnboardingStatus: 'completed',
    } as any)
    mockCreateMollieClient.mockReturnValue(makeMollieClient() as any)

    await GET()

    expect(mockCreateMollieClient).toHaveBeenCalledWith({ accessToken: 'access_test_token_xyz' })
  })

  it('happy path: returns ReadinessReport with tokenValid=true, profileActive=true, ready=true', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockAccountFindUnique.mockResolvedValue({
      mollieAccessToken: 'access_valid',
      mollieProfileId: 'pfl_test',
      mollieOnboardingStatus: 'completed',
    } as any)
    mockCreateMollieClient.mockReturnValue(makeMollieClient() as any)

    const response = await GET()
    expect(response.status).toBe(200)
    const data = await response.json()

    expect(data.tokenValid).toBe(true)
    expect(data.profileActive).toBe(true)
    expect(data.enabledMethods).toContain('creditcard')
    expect(data.enabledMethods).toContain('ideal')
    expect(data.ready).toBe(true)
  })

  it('ready=false when no payment methods are enabled even if token is valid', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockAccountFindUnique.mockResolvedValue({
      mollieAccessToken: 'access_valid',
      mollieProfileId: 'pfl_test',
      mollieOnboardingStatus: 'completed',
    } as any)
    mockCreateMollieClient.mockReturnValue(makeMollieClient() as any)
    // Override fetch to return no enabled methods
    vi.mocked(global.fetch).mockResolvedValue(
      mockFetchResponse(200, {
        _embedded: {
          methods: [
            { id: 'creditcard', status: 'not-activated' },
          ],
        },
      }),
    )

    const response = await GET()
    const data = await response.json()

    expect(data.tokenValid).toBe(true)
    expect(data.enabledMethods).toHaveLength(0)
    expect(data.ready).toBe(false)
  })

  // ── Onboarding status sync ─────────────────────────────────────────────────────

  it('updates onboarding status in DB when Mollie returns a different status than what is cached', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockAccountFindUnique.mockResolvedValue({
      mollieAccessToken: 'access_valid',
      mollieProfileId: 'pfl_test',
      mollieOnboardingStatus: 'needs-data', // stale cached value
    } as any)
    mockCreateMollieClient.mockReturnValue(
      makeMollieClient({
        onboardingGet: vi.fn().mockResolvedValue({ status: 'in-review' }), // live Mollie value
      }) as any,
    )

    const response = await GET()
    const data = await response.json()

    expect(data.onboardingStatus).toBe('in-review')
    expect(mockAccountUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID },
        data: expect.objectContaining({ mollieOnboardingStatus: 'in-review' }),
      }),
    )
  })

  it('skips DB update when live onboarding status matches the cached value', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockAccountFindUnique.mockResolvedValue({
      mollieAccessToken: 'access_valid',
      mollieProfileId: 'pfl_test',
      mollieOnboardingStatus: 'completed',
    } as any)
    mockCreateMollieClient.mockReturnValue(
      makeMollieClient({
        onboardingGet: vi.fn().mockResolvedValue({ status: 'completed' }),
      }) as any,
    )

    await GET()

    // No update needed — status already in sync
    expect(mockAccountUpdate).not.toHaveBeenCalled()
  })
})
