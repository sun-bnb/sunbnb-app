import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { compare } from 'bcryptjs'

vi.mock('./email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: 'mock-email' }),
}))

import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import { createTestUser, resetCounter } from './test/fixtures'
import { requestPasswordReset, resetPassword } from './password-reset'
import { sendEmail } from './email'

const mockSendEmail = vi.mocked(sendEmail)

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
  mockSendEmail.mockClear()
})

afterAll(async () => {
  await disconnectDatabase()
})

// ─── requestPasswordReset ───────────────────────────────────────────────────

describe('requestPasswordReset', () => {
  it('creates a hashed token in the database', async () => {
    const user = await createTestUser({
      email: 'reset@test.com',
      password: '$2a$12$hashedpassword', // bcrypt hash placeholder
    })

    const result = await requestPasswordReset(
      'reset@test.com',
      'https://test.sunbnb.app'
    )
    expect(result.ok).toBe(true)

    const tokens = await prisma.passwordResetToken.findMany({
      where: { userId: user.id },
    })
    expect(tokens).toHaveLength(1)
    // Token stored is a SHA-256 hash (64 hex chars), not the raw token
    expect(tokens[0]!.token).toMatch(/^[0-9a-f]{64}$/)
    // Expires roughly 1 hour from now
    const diffMs = tokens[0]!.expiresAt.getTime() - Date.now()
    expect(diffMs).toBeGreaterThan(50 * 60 * 1000)
    expect(diffMs).toBeLessThan(70 * 60 * 1000)
  })

  it('sends email with reset URL containing raw token', async () => {
    await createTestUser({
      email: 'email@test.com',
      password: '$2a$12$hashedpassword',
    })

    await requestPasswordReset('email@test.com', 'https://test.sunbnb.app')

    expect(mockSendEmail).toHaveBeenCalledOnce()
    const call = mockSendEmail.mock.calls[0]![0]
    expect(call.to).toBe('email@test.com')
    expect(call.subject).toContain('Reset')
    // HTML contains the raw token in the URL (not the hash)
    expect(call.html).toContain('https://test.sunbnb.app/reset-password?token=')
  })

  it('invalidates previous tokens for the same user', async () => {
    await createTestUser({
      email: 'multi@test.com',
      password: '$2a$12$hashedpassword',
    })

    await requestPasswordReset('multi@test.com', 'https://test.sunbnb.app')
    await requestPasswordReset('multi@test.com', 'https://test.sunbnb.app')

    const tokens = await prisma.passwordResetToken.findMany({
      orderBy: { createdAt: 'asc' },
    })
    expect(tokens).toHaveLength(2)
    // First token should have been invalidated (usedAt set)
    expect(tokens[0]!.usedAt).not.toBeNull()
    // Second token is still active
    expect(tokens[1]!.usedAt).toBeNull()
  })

  it('rate-limits after 3 requests per hour', async () => {
    await createTestUser({
      email: 'ratelimit@test.com',
      password: '$2a$12$hashedpassword',
    })

    for (let i = 0; i < 3; i++) {
      await requestPasswordReset('ratelimit@test.com', 'https://test.sunbnb.app')
    }

    // 4th request silently succeeds but should not create a new token
    mockSendEmail.mockClear()
    const result = await requestPasswordReset(
      'ratelimit@test.com',
      'https://test.sunbnb.app'
    )
    expect(result.ok).toBe(true)

    const tokens = await prisma.passwordResetToken.findMany()
    expect(tokens).toHaveLength(3) // Still only 3 tokens
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('returns ok for non-existent email (no leak)', async () => {
    const result = await requestPasswordReset(
      'nobody@test.com',
      'https://test.sunbnb.app'
    )
    expect(result.ok).toBe(true)

    const tokens = await prisma.passwordResetToken.findMany()
    expect(tokens).toHaveLength(0)
  })

  it('returns ok for OAuth-only user (no password)', async () => {
    await createTestUser({ email: 'oauth@test.com' }) // no password field

    const result = await requestPasswordReset(
      'oauth@test.com',
      'https://test.sunbnb.app'
    )
    expect(result.ok).toBe(true)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('rejects unrecognized origin silently', async () => {
    await createTestUser({
      email: 'origin@test.com',
      password: '$2a$12$hashedpassword',
    })

    const result = await requestPasswordReset('origin@test.com', 'https://evil.com')
    expect(result.ok).toBe(true)
    expect(mockSendEmail).not.toHaveBeenCalled()

    const tokens = await prisma.passwordResetToken.findMany()
    expect(tokens).toHaveLength(0)
  })
})

// ─── resetPassword ──────────────────────────────────────────────────────────

describe('resetPassword', () => {
  async function requestAndExtractToken(email: string) {
    await requestPasswordReset(email, 'https://test.sunbnb.app')

    // Extract raw token from the email mock
    const call = mockSendEmail.mock.calls[mockSendEmail.mock.calls.length - 1]![0]
    const match = call.html.match(/token=([0-9a-f]{64})/)
    if (!match) throw new Error('Could not extract token from email HTML')
    return match[1]!
  }

  it('successfully resets password with valid token', async () => {
    const user = await createTestUser({
      email: 'valid@test.com',
      password: '$2a$12$hashedpassword',
    })

    const token = await requestAndExtractToken('valid@test.com')
    const result = await resetPassword(token, 'NewPass123')

    expect(result.ok).toBe(true)

    // Verify password was changed
    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    const passwordMatches = await compare('NewPass123', updated!.password!)
    expect(passwordMatches).toBe(true)

    // Token should be marked as used
    const tokens = await prisma.passwordResetToken.findMany({
      where: { userId: user.id },
    })
    expect(tokens.every((t) => t.usedAt !== null)).toBe(true)
  })

  it('rejects already-used token', async () => {
    await createTestUser({
      email: 'used@test.com',
      password: '$2a$12$hashedpassword',
    })

    const token = await requestAndExtractToken('used@test.com')
    await resetPassword(token, 'NewPass123')

    const result = await resetPassword(token, 'AnotherPass1')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('already been used')
  })

  it('rejects expired token', async () => {
    await createTestUser({
      email: 'expired@test.com',
      password: '$2a$12$hashedpassword',
    })

    const token = await requestAndExtractToken('expired@test.com')

    // Manually expire the token
    await prisma.passwordResetToken.updateMany({
      data: {
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null, // ensure it wasn't invalidated
      },
    })

    const result = await resetPassword(token, 'NewPass123')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('expired')
  })

  it('rejects password shorter than 8 characters', async () => {
    const result = await resetPassword('sometoken', 'Short1')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('8 characters')
  })

  it('rejects password without uppercase', async () => {
    const result = await resetPassword('sometoken', 'alllowercase1')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('uppercase')
  })

  it('rejects password without lowercase', async () => {
    const result = await resetPassword('sometoken', 'ALLUPPERCASE1')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('lowercase')
  })

  it('rejects password without digit', async () => {
    const result = await resetPassword('sometoken', 'NoDigitsHere')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('number')
  })

  it('rejects invalid token (not in database)', async () => {
    const result = await resetPassword(
      'a'.repeat(64), // valid-looking but non-existent
      'ValidPass1'
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Invalid or expired')
  })
})
