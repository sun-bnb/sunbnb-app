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
  mockResetPassword.mockResolvedValue({ ok: true })
})

function makeRequest(body: Record<string, any>, ip?: string): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (ip) headers['x-forwarded-for'] = ip
  return new NextRequest('http://localhost/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  })
}

describe('POST /api/auth/reset-password', () => {
  it('resets password successfully', async () => {
    const request = makeRequest({ token: 'valid-token', password: 'NewPass12' })
    const response = await POST(request)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(mockResetPassword).toHaveBeenCalledWith('valid-token', 'NewPass12')
  })

  it('returns 400 when token is missing', async () => {
    const request = makeRequest({ password: 'NewPass12' })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('Invalid reset link')
  })

  it('returns 400 when password is too short', async () => {
    const request = makeRequest({ token: 'tok', password: 'short' })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('at least 8')
  })

  it('returns 429 when rate limited', async () => {
    mockRateLimit.mockReturnValue({ allowed: false } as any)

    const request = makeRequest({ token: 'tok', password: 'NewPass12' })
    const response = await POST(request)
    expect(response.status).toBe(429)
    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('rate limits by IP address', async () => {
    const request = makeRequest({ token: 'tok', password: 'NewPass12' }, '5.6.7.8')
    await POST(request)

    expect(mockRateLimit).toHaveBeenCalledWith(
      'reset-password:5.6.7.8',
      { maxAttempts: 5, windowMs: 15 * 60 * 1000 },
    )
  })

  it('returns 400 when resetPassword returns not ok', async () => {
    mockResetPassword.mockResolvedValue({ ok: false, error: 'Token expired' } as any)

    const request = makeRequest({ token: 'expired-tok', password: 'NewPass12' })
    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('returns 500 on unexpected error', async () => {
    mockResetPassword.mockRejectedValue(new Error('DB down'))

    const request = makeRequest({ token: 'tok', password: 'NewPass12' })
    const response = await POST(request)
    expect(response.status).toBe(500)
  })
})
