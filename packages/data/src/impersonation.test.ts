import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const create = vi.fn()
const updateMany = vi.fn()

vi.mock('../index', () => ({
  default: {
    impersonationLog: {
      create: (...args: unknown[]) => create(...args),
      updateMany: (...args: unknown[]) => updateMany(...args),
    },
  },
}))

import {
  createImpersonationToken,
  consumeImpersonationToken,
  endImpersonation,
  ImpersonationError,
  __test,
} from './impersonation'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  create.mockReset()
  updateMany.mockReset()
  process.env.AUTH_SECRET = 'test-secret-do-not-use'
  create.mockResolvedValue(undefined)
  updateMany.mockResolvedValue({ count: 1 })
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

// ─── createImpersonationToken ───────────────────────────────────────────────

describe('createImpersonationToken', () => {
  it('returns a signed token, unique tokenId, and absolute expiry', () => {
    const t = createImpersonationToken({
      adminId: 'admin-1',
      targetUserId: 'user-2',
      app: 'partner',
    })
    expect(t.token).toMatch(/^[\w-]+\.[\w-]+$/)
    expect(t.tokenId).toMatch(/^[a-f0-9]{32}$/)
    expect(t.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('generates unique tokenIds across calls', () => {
    const a = createImpersonationToken({ adminId: 'a', targetUserId: 'u', app: 'partner' })
    const b = createImpersonationToken({ adminId: 'a', targetUserId: 'u', app: 'partner' })
    expect(a.tokenId).not.toBe(b.tokenId)
    expect(a.token).not.toBe(b.token)
  })

  it('rejects unknown app values', () => {
    expect(() =>
      createImpersonationToken({ adminId: 'a', targetUserId: 'u', app: 'admin' as never }),
    ).toThrow(ImpersonationError)
  })

  it('rejects empty adminId / targetUserId', () => {
    expect(() =>
      createImpersonationToken({ adminId: '', targetUserId: 'u', app: 'partner' }),
    ).toThrow(/adminId/)
    expect(() =>
      createImpersonationToken({ adminId: 'a', targetUserId: '', app: 'partner' }),
    ).toThrow(/targetUserId/)
  })

  it('rejects negative or absurd ttlSeconds', () => {
    expect(() =>
      createImpersonationToken({ adminId: 'a', targetUserId: 'u', app: 'partner', ttlSeconds: 0 }),
    ).toThrow(/ttlSeconds/)
    expect(() =>
      createImpersonationToken({
        adminId: 'a',
        targetUserId: 'u',
        app: 'partner',
        ttlSeconds: 60 * 60 * 24,
      }),
    ).toThrow(/ttlSeconds/)
  })

  it('throws misconfigured when AUTH_SECRET is unset', () => {
    delete process.env.AUTH_SECRET
    try {
      createImpersonationToken({ adminId: 'a', targetUserId: 'u', app: 'partner' })
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ImpersonationError)
      expect((err as ImpersonationError).code).toBe('misconfigured')
    }
  })
})

// ─── token verify (round-trip + tamper) ─────────────────────────────────────

describe('verifyToken (round-trip)', () => {
  it('accepts a freshly signed token', () => {
    const { token } = createImpersonationToken({
      adminId: 'a',
      targetUserId: 'u',
      app: 'user',
    })
    const payload = __test.verifyToken(token, process.env.AUTH_SECRET!, Math.floor(Date.now() / 1000))
    expect(payload.sub).toBe('u')
    expect(payload.admin).toBe('a')
    expect(payload.app).toBe('user')
  })

  it('rejects a token signed with a different secret', () => {
    const { token } = createImpersonationToken({
      adminId: 'a',
      targetUserId: 'u',
      app: 'partner',
    })
    expect(() => __test.verifyToken(token, 'other-secret', Math.floor(Date.now() / 1000))).toThrow(
      ImpersonationError,
    )
  })

  it('rejects a tampered payload', () => {
    const { token } = createImpersonationToken({
      adminId: 'a',
      targetUserId: 'u',
      app: 'partner',
    })
    const [, sig] = token.split('.')
    const tamperedPayload = Buffer.from(
      JSON.stringify({ v: 1, sub: 'attacker', admin: 'attacker', app: 'partner', jti: 'x', iat: 0, exp: 9_999_999_999 }),
    ).toString('base64url')
    const tampered = `${tamperedPayload}.${sig}`
    expect(() =>
      __test.verifyToken(tampered, process.env.AUTH_SECRET!, Math.floor(Date.now() / 1000)),
    ).toThrow(/signature/i)
  })

  it('rejects malformed token (no dot)', () => {
    expect(() =>
      __test.verifyToken('nodothere', process.env.AUTH_SECRET!, Math.floor(Date.now() / 1000)),
    ).toThrow(/malformed/i)
  })

  it('rejects expired token with code "expired"', () => {
    const { token } = createImpersonationToken({
      adminId: 'a',
      targetUserId: 'u',
      app: 'partner',
      ttlSeconds: 60,
    })
    const future = Math.floor(Date.now() / 1000) + 120
    try {
      __test.verifyToken(token, process.env.AUTH_SECRET!, future)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ImpersonationError)
      expect((err as ImpersonationError).code).toBe('expired')
    }
  })

  it('rejects token with mismatched version', () => {
    // Hand-craft a payload with v=999, signed with the right secret
    const crypto = require('node:crypto')
    const payload = {
      v: 999,
      sub: 'u',
      admin: 'a',
      app: 'partner',
      jti: 'x',
      iat: 0,
      exp: 9_999_999_999,
    }
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const sig = crypto
      .createHmac('sha256', process.env.AUTH_SECRET!)
      .update(encoded)
      .digest()
      .toString('base64url')
    const token = `${encoded}.${sig}`
    expect(() =>
      __test.verifyToken(token, process.env.AUTH_SECRET!, Math.floor(Date.now() / 1000)),
    ).toThrow(/version/i)
  })
})

// ─── consumeImpersonationToken ──────────────────────────────────────────────

describe('consumeImpersonationToken', () => {
  it('writes an ImpersonationLog row and returns the payload fields', async () => {
    const { token, tokenId } = createImpersonationToken({
      adminId: 'admin-1',
      targetUserId: 'user-2',
      app: 'partner',
    })
    const res = await consumeImpersonationToken(token, { ip: '1.2.3.4', userAgent: 'Vitest' })
    expect(res).toEqual({
      adminId: 'admin-1',
      targetUserId: 'user-2',
      app: 'partner',
      tokenId,
    })
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: 'admin-1',
        targetUserId: 'user-2',
        tokenId,
        app: 'partner',
        ip: '1.2.3.4',
        userAgent: 'Vitest',
      }),
    })
  })

  it('translates a P2002 unique violation into a replay error', async () => {
    create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))
    const { token } = createImpersonationToken({
      adminId: 'a',
      targetUserId: 'u',
      app: 'partner',
    })
    try {
      await consumeImpersonationToken(token)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ImpersonationError)
      expect((err as ImpersonationError).code).toBe('replay')
    }
  })

  it('rejects when expectedApp does not match the token', async () => {
    const { token } = createImpersonationToken({
      adminId: 'a',
      targetUserId: 'u',
      app: 'partner',
    })
    try {
      await consumeImpersonationToken(token, { expectedApp: 'user' })
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ImpersonationError)
      expect((err as ImpersonationError).code).toBe('wrong_app')
    }
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects an expired token without writing a log row', async () => {
    const { token } = createImpersonationToken({
      adminId: 'a',
      targetUserId: 'u',
      app: 'partner',
      ttlSeconds: 1,
    })
    // Travel past expiry
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 5_000)
    try {
      await consumeImpersonationToken(token)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ImpersonationError)
      expect((err as ImpersonationError).code).toBe('expired')
    } finally {
      vi.useRealTimers()
    }
    expect(create).not.toHaveBeenCalled()
  })

  it('re-throws unrelated DB errors as-is', async () => {
    create.mockRejectedValueOnce(new Error('connection refused'))
    const { token } = createImpersonationToken({
      adminId: 'a',
      targetUserId: 'u',
      app: 'partner',
    })
    await expect(consumeImpersonationToken(token)).rejects.toThrow('connection refused')
  })
})

// ─── endImpersonation ───────────────────────────────────────────────────────

describe('endImpersonation', () => {
  it('updates only rows where endedAt is null', async () => {
    updateMany.mockResolvedValue({ count: 1 })
    const n = await endImpersonation('jti-1')
    expect(n).toBe(1)
    expect(updateMany).toHaveBeenCalledWith({
      where: { tokenId: 'jti-1', endedAt: null },
      data: { endedAt: expect.any(Date) },
    })
  })

  it('returns 0 when no matching row exists (idempotent)', async () => {
    updateMany.mockResolvedValue({ count: 0 })
    const n = await endImpersonation('unknown')
    expect(n).toBe(0)
  })
})
