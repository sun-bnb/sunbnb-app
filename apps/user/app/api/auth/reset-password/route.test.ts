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
    const request = makeRequest({ token: 'valid-token', password: 'NewPass1' })
    const response = await POST(request)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(mockResetPassword).toHaveBeenCalledWith('valid-token', 'NewPass1')
  })

  it('returns 400 when token is missing', async () => {
    const request = makeRequest({ password: 'NewPass1' })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('Invalid reset link')
  })

  it('returns 400 when token exceeds 256 chars', async () => {
    const request = makeRequest({ token: 'a'.repeat(257), password: 'NewPass1' })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('Invalid reset link')
    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('returns 400 when password is too short (less than 8 chars)', async () => {
    const request = makeRequest({ token: 'tok', password: 'Short1' })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('at least 8')
  })

  it('returns 400 when password has no uppercase letter', async () => {
    const request = makeRequest({ token: 'tok', password: 'nouppercase1' })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('uppercase')
    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('returns 400 when password has no lowercase letter', async () => {
    const request = makeRequest({ token: 'tok', password: 'NOLOWERCASE1' })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('lowercase')
    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('returns 400 when password has no digit', async () => {
    const request = makeRequest({ token: 'tok', password: 'NoDigitsHere' })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('number')
    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('returns 400 when password exceeds 128 chars', async () => {
    const request = makeRequest({ token: 'tok', password: 'A1' + 'a'.repeat(127) })
    const response = await POST(request)
    expect(response.status).toBe(400)
    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('returns 429 when rate limited', async () => {
    mockRateLimit.mockReturnValue({ allowed: false } as any)

    const request = makeRequest({ token: 'tok', password: 'NewPass1' })
    const response = await POST(request)
    expect(response.status).toBe(429)
    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('rate limits by IP address', async () => {
    const request = makeRequest({ token: 'tok', password: 'NewPass1' }, '5.6.7.8')
    await POST(request)

    expect(mockRateLimit).toHaveBeenCalledWith(
      'reset-password:5.6.7.8',
      { maxAttempts: 5, windowMs: 15 * 60 * 1000 },
    )
  })

  it('returns 400 when resetPassword returns not ok', async () => {
    mockResetPassword.mockResolvedValue({ ok: false, error: 'Token expired' } as any)

    const request = makeRequest({ token: 'expired-tok', password: 'NewPass1' })
    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('returns 500 on unexpected error', async () => {
    mockResetPassword.mockRejectedValue(new Error('DB down'))

    const request = makeRequest({ token: 'tok', password: 'NewPass1' })
    const response = await POST(request)
    expect(response.status).toBe(500)
  })
})
