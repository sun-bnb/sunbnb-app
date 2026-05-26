import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import { createTestUser, createTestPartnerAccount, resetCounter } from './test/fixtures'
import { getValidMollieToken, MollieReconnectRequiredError } from './mollie-tokens'

// refreshMollieToken needs these or it throws before reaching fetch.
const ORIG_ENV = { ...process.env }

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
  process.env.MOLLIE_CLIENT_ID = 'app_test'
  process.env.MOLLIE_CLIENT_SECRET = 'secret_test'
  vi.restoreAllMocks()
})

afterAll(async () => {
  process.env = ORIG_ENV
  await disconnectDatabase()
})

/** Seed a partner whose access token is stale, forcing a refresh on next use. */
async function partnerWithStaleToken() {
  const user = await createTestUser()
  await createTestPartnerAccount(user.id, {
    mollieAccessToken: 'at_stale',
    mollieRefreshToken: 'rt_stale',
    // Expired an hour ago → not fresh → getValidMollieToken must refresh.
    mollieTokenExpiresAt: new Date(Date.now() - 3600_000),
  })
  return user.id
}

function mockFetchResponse(status: number, body: string) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(body, { status }) as Response,
  )
}

describe('getValidMollieToken — dead refresh token clears (regression: txn rollback)', () => {
  it('clears the stored tokens AND throws reconnect on invalid_grant', async () => {
    const userId = await partnerWithStaleToken()
    // Mollie rejects the refresh token as dead.
    mockFetchResponse(400, JSON.stringify({ error: 'invalid_grant' }))

    await expect(getValidMollieToken(userId)).rejects.toBeInstanceOf(
      MollieReconnectRequiredError,
    )

    // The clear must have COMMITTED. Before the fix it threw inside the
    // transaction and Prisma rolled the clear back, leaving the tokens present
    // and the partner stuck "connected" but unable to pay.
    const acct = await prisma.partnerAccount.findUnique({
      where: { userId },
      select: {
        mollieAccessToken: true,
        mollieRefreshToken: true,
        mollieTokenExpiresAt: true,
      },
    })
    expect(acct?.mollieAccessToken).toBeNull()
    expect(acct?.mollieRefreshToken).toBeNull()
    expect(acct?.mollieTokenExpiresAt).toBeNull()
  })

  it('keeps the connection on a transient refresh failure (non-invalid_grant)', async () => {
    const userId = await partnerWithStaleToken()
    // A 500 is transient — Mollie may still accept the refresh token later.
    mockFetchResponse(500, 'upstream error')

    await expect(getValidMollieToken(userId)).rejects.toThrow()
    // Not a reconnect error — and the tokens must be preserved for a retry.
    await expect(getValidMollieToken(userId)).rejects.not.toBeInstanceOf(
      MollieReconnectRequiredError,
    )

    const acct = await prisma.partnerAccount.findUnique({
      where: { userId },
      select: { mollieAccessToken: true, mollieRefreshToken: true },
    })
    expect(acct?.mollieAccessToken).toBe('at_stale')
    expect(acct?.mollieRefreshToken).toBe('rt_stale')
  })

  it('refreshes and persists the rotated token + expiry on success', async () => {
    const userId = await partnerWithStaleToken()
    mockFetchResponse(
      200,
      JSON.stringify({
        access_token: 'at_fresh',
        refresh_token: 'rt_rotated',
        expires_in: 3600,
      }),
    )

    const token = await getValidMollieToken(userId)
    expect(token).toBe('at_fresh')

    const acct = await prisma.partnerAccount.findUnique({
      where: { userId },
      select: {
        mollieAccessToken: true,
        mollieRefreshToken: true,
        mollieTokenExpiresAt: true,
      },
    })
    expect(acct?.mollieAccessToken).toBe('at_fresh')
    expect(acct?.mollieRefreshToken).toBe('rt_rotated')
    // ~1h out and comfortably in the future.
    expect(acct?.mollieTokenExpiresAt?.getTime()).toBeGreaterThan(Date.now() + 3000_000)
  })
})
