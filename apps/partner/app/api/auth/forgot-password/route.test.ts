import { describe, it, expect, vi, beforeEach } from 'vitest'

import { POST } from './route'
import { requestPasswordReset } from '@repo/data/password-reset'
import { rateLimit } from '@repo/data/rate-limit'
import { NextRequest } from 'next/server'

const mockRequestPasswordReset = vi.mocked(requestPasswordReset)
const mockRateLimit = vi.mocked(rateLimit)

beforeEach(() => {
  vi.clearAllMocks()
  mockRateLimit.mockReturnValue({ allowed: true } as any)
  mockRequestPasswordReset.mockResolvedValue({ ok: true })
})

function makeRequest(body: Record<string, any>, ip?: string): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (ip) headers['x-forwarded-for'] = ip
  return new NextRequest('http://localhost/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  })
}

describe('POST /api/auth/forgot-password', () => {
  it('returns success on valid email', async () => {
    const request = makeRequest({ email: 'test@example.com' })
    const response = await POST(request)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(mockRequestPasswordReset).toHaveBeenCalledWith('test@example.com', expect.any(String))
  })

  it('normalizes email to lowercase and trims', async () => {
    const request = makeRequest({ email: '  Test@Example.COM  ' })
    await POST(request)
    expect(mockRequestPasswordReset).toHaveBeenCalledWith('test@example.com', expect.any(String))
  })

  it('returns 400 when email is missing', async () => {
    const request = makeRequest({})
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('Email is required')
  })

  it('returns 400 when email is not a string', async () => {
    const request = makeRequest({ email: 12345 })
    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('silently succeeds when rate limited (no leaking)', async () => {
    mockRateLimit.mockReturnValue({ allowed: false } as any)

    const request = makeRequest({ email: 'test@example.com' })
    const response = await POST(request)
    const data = await response.json()

    // Returns success even when rate limited — prevents enumeration
    expect(data.ok).toBe(true)
    expect(mockRequestPasswordReset).not.toHaveBeenCalled()
  })

  it('rate limits by IP address', async () => {
    const request = makeRequest({ email: 'test@example.com' }, '1.2.3.4')
    await POST(request)

    expect(mockRateLimit).toHaveBeenCalledWith(
      'forgot-password:1.2.3.4',
      { maxAttempts: 5, windowMs: 15 * 60 * 1000 },
    )
  })

  it('returns 500 on unexpected error', async () => {
    mockRequestPasswordReset.mockRejectedValue(new Error('DB down'))

    const request = makeRequest({ email: 'test@example.com' })
    const response = await POST(request)
    expect(response.status).toBe(500)
  })
})
