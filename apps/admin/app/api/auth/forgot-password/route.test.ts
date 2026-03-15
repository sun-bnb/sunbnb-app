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
})

function createRequest(body: any, ip = '1.2.3.4') {
  return new NextRequest('http://localhost:3003/api/auth/forgot-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/forgot-password', () => {
  it('rate-limits by IP and returns ok-like response to hide rate limit', async () => {
    mockRateLimit.mockReturnValue({ allowed: false } as any)

    const res = await POST(createRequest({ email: 'test@test.com' }))
    const body = await res.json()

    // Returns { ok: true } to avoid leaking rate limit status to attacker
    expect(body.ok).toBe(true)
    expect(mockRequestPasswordReset).not.toHaveBeenCalled()
  })

  it('validates email is present', async () => {
    const res = await POST(createRequest({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Email is required')
  })

  it('validates email is a string', async () => {
    const res = await POST(createRequest({ email: 123 }))
    expect(res.status).toBe(400)
  })

  it('normalizes email to lowercase and trims', async () => {
    mockRequestPasswordReset.mockResolvedValue({ ok: true } as any)

    await POST(createRequest({ email: '  Test@EXAMPLE.com  ' }))

    expect(mockRequestPasswordReset).toHaveBeenCalledWith(
      'test@example.com',
      expect.any(String)
    )
  })

  it('passes origin header to requestPasswordReset', async () => {
    mockRequestPasswordReset.mockResolvedValue({ ok: true } as any)

    const req = new NextRequest('http://localhost:3003/api/auth/forgot-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'origin': 'https://admin.sunbnb.app',
      },
      body: JSON.stringify({ email: 'test@test.com' }),
    })

    await POST(req)
    expect(mockRequestPasswordReset).toHaveBeenCalledWith(
      'test@test.com',
      'https://admin.sunbnb.app'
    )
  })

  it('returns 500 on unexpected error', async () => {
    mockRequestPasswordReset.mockRejectedValue(new Error('DB error'))

    const res = await POST(createRequest({ email: 'test@test.com' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Something went wrong')
  })
})
