import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma, cleanDatabase, disconnectDatabase } from './test/setup'
import {
  createImpersonationToken,
  consumeImpersonationToken,
  endImpersonation,
  ImpersonationError,
} from './impersonation'

beforeAll(async () => {
  // setup.ts already sets AUTH_SECRET; defensively set if a parent process
  // running this file in isolation imported it before setup.
  process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? 'integration-test-auth-secret'
})

beforeEach(async () => {
  await cleanDatabase()
})

afterAll(async () => {
  await disconnectDatabase()
})

describe('impersonation integration', () => {
  it('round-trips: createImpersonationToken → consumeImpersonationToken writes a row', async () => {
    const { token, tokenId } = createImpersonationToken({
      adminId: 'admin-1',
      targetUserId: 'user-2',
      app: 'partner',
    })

    const result = await consumeImpersonationToken(token, {
      ip: '203.0.113.42',
      userAgent: 'IntegrationTest/1.0',
    })

    expect(result).toEqual({
      adminId: 'admin-1',
      targetUserId: 'user-2',
      app: 'partner',
      tokenId,
    })

    const rows = await prisma.impersonationLog.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      adminId: 'admin-1',
      targetUserId: 'user-2',
      tokenId,
      app: 'partner',
      ip: '203.0.113.42',
      userAgent: 'IntegrationTest/1.0',
      endedAt: null,
    })
    expect(rows[0]?.startedAt).toBeInstanceOf(Date)
  })

  it('rejects a second consumption attempt with code "replay" (DB unique constraint)', async () => {
    const { token } = createImpersonationToken({
      adminId: 'admin-1',
      targetUserId: 'user-2',
      app: 'partner',
    })

    await consumeImpersonationToken(token)
    try {
      await consumeImpersonationToken(token)
      expect.fail('second consumption should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ImpersonationError)
      expect((err as ImpersonationError).code).toBe('replay')
    }

    // Still exactly one row — the second insert was rejected by the unique
    // constraint, not by an in-memory check.
    const rows = await prisma.impersonationLog.findMany()
    expect(rows).toHaveLength(1)
  })

  it('allows concurrent tokens for the same target user (different JTIs)', async () => {
    const a = createImpersonationToken({
      adminId: 'admin-1',
      targetUserId: 'user-2',
      app: 'partner',
    })
    const b = createImpersonationToken({
      adminId: 'admin-1',
      targetUserId: 'user-2',
      app: 'partner',
    })
    await consumeImpersonationToken(a.token)
    await consumeImpersonationToken(b.token)

    const rows = await prisma.impersonationLog.findMany({ orderBy: { startedAt: 'asc' } })
    expect(rows.map((r) => r.tokenId).sort()).toEqual([a.tokenId, b.tokenId].sort())
  })

  it('endImpersonation stamps endedAt and is idempotent', async () => {
    const { token, tokenId } = createImpersonationToken({
      adminId: 'admin-1',
      targetUserId: 'user-2',
      app: 'user',
    })
    await consumeImpersonationToken(token)

    const first = await endImpersonation(tokenId)
    expect(first).toBe(1)

    const row = await prisma.impersonationLog.findUnique({ where: { tokenId } })
    expect(row?.endedAt).toBeInstanceOf(Date)

    // Second call is a no-op since endedAt is now non-null
    const second = await endImpersonation(tokenId)
    expect(second).toBe(0)
  })

  it('endImpersonation for an unknown tokenId returns 0', async () => {
    const n = await endImpersonation('never-existed')
    expect(n).toBe(0)
  })

  it('persists app=user correctly', async () => {
    const { token } = createImpersonationToken({
      adminId: 'admin-1',
      targetUserId: 'user-2',
      app: 'user',
    })
    await consumeImpersonationToken(token)
    const row = await prisma.impersonationLog.findFirst()
    expect(row?.app).toBe('user')
  })
})
