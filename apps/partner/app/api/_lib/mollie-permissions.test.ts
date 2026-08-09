/**
 * Tests for Mollie granted-scope detection.
 *
 * The behaviour that matters here is not "does it find missing scopes" — it is
 * that every failure path stays SILENT. This drives a banner telling partners
 * to reconnect their payment provider; a Mollie outage or a bad response must
 * never be able to turn into "you are missing every permission".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  OAUTH_SCOPE_LIST,
  findMissingScopes,
  fetchMollieGrantedScopes,
  resolveMissingMollieScopes,
} from './mollie-permissions'
import prisma from '@repo/data/PrismaCient'

const mockAccountFindUnique = vi.mocked(prisma.partnerAccount.findUnique)

/** Build a Mollie `GET /v2/permissions` body from id → granted pairs. */
function permissionsBody(permissions: Record<string, boolean>) {
  return {
    count: Object.keys(permissions).length,
    _embedded: {
      permissions: Object.entries(permissions).map(([id, granted]) => ({
        resource: 'permission',
        id,
        description: id,
        granted,
      })),
    },
  }
}

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok, status, json: async () => body }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ── OAUTH_SCOPE_LIST ─────────────────────────────────────────────────────────

describe('OAUTH_SCOPE_LIST', () => {
  // This list is the single source of truth for BOTH the authorize URL and the
  // missing-permission check. If they ever drift, partners get sent to Mollie to
  // grant a scope set that does not match what we then check for.
  it('contains exactly the eight scopes the integration requires', () => {
    expect(OAUTH_SCOPE_LIST).toEqual([
      'payments.read',
      'payments.write',
      'refunds.read',
      'refunds.write',
      'profiles.read',
      'profiles.write',
      'onboarding.read',
      'onboarding.write',
    ])
  })
})

// ── findMissingScopes ────────────────────────────────────────────────────────

describe('findMissingScopes', () => {
  it('returns nothing when every required scope is granted', () => {
    expect(findMissingScopes([...OAUTH_SCOPE_LIST])).toEqual([])
  })

  it('reports the refunds scopes a pre-refunds grant lacks', () => {
    const legacyGrant = OAUTH_SCOPE_LIST.filter((s) => !s.startsWith('refunds.'))
    expect(findMissingScopes(legacyGrant)).toEqual(['refunds.read', 'refunds.write'])
  })

  it('returns every required scope when the grant is empty', () => {
    expect(findMissingScopes([])).toEqual(OAUTH_SCOPE_LIST)
  })

  it('ignores granted scopes we do not require', () => {
    expect(findMissingScopes([...OAUTH_SCOPE_LIST, 'settlements.read'])).toEqual([])
  })

  it('returns results in OAUTH_SCOPE_LIST order, not grant order', () => {
    const scrambled = ['onboarding.write', 'payments.write', 'profiles.read']
    expect(findMissingScopes(scrambled)).toEqual([
      'payments.read',
      'refunds.read',
      'refunds.write',
      'profiles.write',
      'onboarding.read',
    ])
  })

  it('honours an explicit required list', () => {
    expect(findMissingScopes(['payments.read'], ['payments.read', 'refunds.write']))
      .toEqual(['refunds.write'])
  })
})

// ── fetchMollieGrantedScopes ─────────────────────────────────────────────────

describe('fetchMollieGrantedScopes', () => {
  it('returns only the permissions Mollie reports as granted', async () => {
    mockFetchOnce(permissionsBody({
      'payments.read': true,
      'payments.write': true,
      'refunds.write': false,
    }))

    await expect(fetchMollieGrantedScopes('access_xxx'))
      .resolves.toEqual(['payments.read', 'payments.write'])
  })

  it('sends the partner access token as a bearer credential', async () => {
    mockFetchOnce(permissionsBody({ 'payments.read': true }))

    await fetchMollieGrantedScopes('access_xxx')

    expect(fetch).toHaveBeenCalledWith(
      'https://api.mollie.com/v2/permissions',
      expect.objectContaining({
        headers: { Authorization: 'Bearer access_xxx' },
      }),
    )
  })

  // A 401/403/500 must be distinguishable from "granted nothing" — see the
  // fail-open tests below, which depend on this throwing rather than returning [].
  it('throws on a non-OK response instead of reporting an empty grant', async () => {
    mockFetchOnce({}, false, 401)
    await expect(fetchMollieGrantedScopes('access_xxx')).rejects.toThrow(/401/)
  })

  it('throws when the response body has no permissions array', async () => {
    mockFetchOnce({ count: 0 })
    await expect(fetchMollieGrantedScopes('access_xxx')).rejects.toThrow(/permissions array/)
  })

  it('skips permission entries with a non-string id', async () => {
    mockFetchOnce({
      _embedded: { permissions: [{ id: 'payments.read', granted: true }, { granted: true }] },
    })
    await expect(fetchMollieGrantedScopes('access_xxx')).resolves.toEqual(['payments.read'])
  })

  it('treats a missing `granted` field as not granted', async () => {
    mockFetchOnce({
      _embedded: { permissions: [{ id: 'payments.read' }, { id: 'refunds.write', granted: true }] },
    })
    await expect(fetchMollieGrantedScopes('access_xxx')).resolves.toEqual(['refunds.write'])
  })
})

// ── resolveMissingMollieScopes ───────────────────────────────────────────────

describe('resolveMissingMollieScopes', () => {
  it('reports the gap for a partner on a pre-refunds grant', async () => {
    mockAccountFindUnique.mockResolvedValue({ mollieAccessToken: 'access_xxx' } as any)
    mockFetchOnce(permissionsBody({
      'payments.read': true,
      'payments.write': true,
      'refunds.read': false,
      'refunds.write': false,
      'profiles.read': true,
      'profiles.write': true,
      'onboarding.read': true,
      'onboarding.write': true,
    }))

    await expect(resolveMissingMollieScopes('user-1'))
      .resolves.toEqual(['refunds.read', 'refunds.write'])
  })

  it('is silent for a partner with no Mollie connection, without calling Mollie', async () => {
    mockAccountFindUnique.mockResolvedValue({ mollieAccessToken: null } as any)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    // The existing "connect Mollie" banner owns this case; flagging missing
    // scopes on top of it would double up on the same problem.
    await expect(resolveMissingMollieScopes('user-1')).resolves.toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('is silent when the partner account does not exist', async () => {
    mockAccountFindUnique.mockResolvedValue(null as any)
    await expect(resolveMissingMollieScopes('user-1')).resolves.toEqual([])
  })

  it('fails open when Mollie rejects the token', async () => {
    mockAccountFindUnique.mockResolvedValue({ mollieAccessToken: 'access_stale' } as any)
    mockFetchOnce({}, false, 401)

    // A stale token must not be reported as "missing every permission".
    await expect(resolveMissingMollieScopes('user-1')).resolves.toEqual([])
  })

  it('fails open when the Mollie call errors or times out', async () => {
    mockAccountFindUnique.mockResolvedValue({ mollieAccessToken: 'access_xxx' } as any)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('The operation was aborted')))

    await expect(resolveMissingMollieScopes('user-1')).resolves.toEqual([])
  })

  it('fails open when the account lookup itself throws', async () => {
    mockAccountFindUnique.mockRejectedValue(new Error('db down'))

    // This runs inside the sign-in path — a DB hiccup must not block login.
    await expect(resolveMissingMollieScopes('user-1')).resolves.toEqual([])
  })
})
