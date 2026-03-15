import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'
import { resetPassword } from '@repo/data/password-reset'
import { rateLimit } from '@repo/data/rate-limit'
import { NextRequest } from 'next/server'

const mockResetPassword = vi.mocked(resetPassword)
const mockRateLimit = vi.mocked(rateLimit)

beforeEach(() => {
  vi.clearAllMocks()
  mockRateLimit.mockReturnValue({ allowed: true } as any)
})

function createRequest(body: any, ip = '1.2.3.4') {
  return new NextRequest('http://localhost:3003/api/auth/reset-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/reset-password', () => {
  it('rate-limits by IP with 429 response', async () => {
    mockRateLimit.mockReturnValue({ allowed: false } as any)

    const res = await POST(createRequest({ token: 'tok', password: 'Password1' }))
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toContain('Too many attempts')
    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('validates token is present', async () => {
    const res = await POST(createRequest({ password: 'Password1' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid reset link')
  })

  it('validates token is a string', async () => {
    const res = await POST(createRequest({ token: 123, password: 'Password1' }))
    expect(res.status).toBe(400)
  })

  // BUG: API route validates password >= 6 characters but business logic requires 8+
  // with upper+lower+digit. The API-level check should match the real requirement.
  it('rejects password shorter than 8 characters', async () => {
    const res = await POST(createRequest({ token: 'valid-token', password: '1234567' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('8')
  })

  it('rejects 6-char password at API level (should not leak through to business logic)', async () => {
    const res = await POST(createRequest({ token: 'valid-token', password: 'abcdef' }))
    expect(res.status).toBe(400)
    // Should be caught at API level, not forwarded to business logic
    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('succeeds with valid token and strong password', async () => {
    mockResetPassword.mockResolvedValue({ ok: true } as any)

    const res = await POST(createRequest({ token: 'valid-token', password: 'StrongPass1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('returns 400 when resetPassword returns failure', async () => {
    mockResetPassword.mockResolvedValue({ ok: false, error: 'Token expired' } as any)

    const res = await POST(createRequest({ token: 'expired-token', password: 'StrongPass1' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 500 on unexpected error', async () => {
    mockResetPassword.mockRejectedValue(new Error('DB error'))

    const res = await POST(createRequest({ token: 'tok', password: 'StrongPass1' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Something went wrong')
  })
})
