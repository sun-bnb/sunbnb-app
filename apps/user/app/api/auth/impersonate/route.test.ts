import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockSignIn = vi.fn()
vi.mock('@/app/auth', () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
}))

vi.mock('next-auth', () => {
  class StubAuthError extends Error {
    type = 'AuthError'
  }
  return { AuthError: StubAuthError }
})

import { AuthError } from 'next-auth'
import { GET } from './route'

function req(url: string): NextRequest {
  return new NextRequest(url)
}

beforeEach(() => {
  mockSignIn.mockReset()
})

describe('GET /api/auth/impersonate', () => {
  it('redirects to sign-in with missing_token when token is absent', async () => {
    const res = await GET(req('http://test/api/auth/impersonate'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('error=missing_token')
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('calls signIn with the impersonation provider and the supplied token', async () => {
    mockSignIn.mockImplementation(() => {
      const e = new Error('NEXT_REDIRECT')
      ;(e as { digest?: string }).digest = 'NEXT_REDIRECT;replace;/;307'
      throw e
    })
    try {
      await GET(req('http://test/api/auth/impersonate?token=abc.def'))
      expect.fail('expected signIn to throw NEXT_REDIRECT')
    } catch (err) {
      expect((err as Error).message).toBe('NEXT_REDIRECT')
    }
    expect(mockSignIn).toHaveBeenCalledWith('impersonation', {
      token: 'abc.def',
      redirectTo: '/',
    })
  })

  it('redirects to sign-in with impersonation_failed on AuthError', async () => {
    mockSignIn.mockRejectedValue(new AuthError('credentials'))
    const res = await GET(req('http://test/api/auth/impersonate?token=bad'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('error=impersonation_failed')
  })

  it('rethrows NEXT_REDIRECT so Next.js handles the success path', async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;push;/;307',
    })
    mockSignIn.mockRejectedValue(redirect)
    await expect(
      GET(req('http://test/api/auth/impersonate?token=t')),
    ).rejects.toBe(redirect)
  })
})
