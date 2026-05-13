import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockAuth = vi.fn()
const mockSignOut = vi.fn()
vi.mock('@/app/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
}))

const mockEndImpersonation = vi.fn()
vi.mock('@repo/data/impersonation', () => ({
  endImpersonation: (...args: unknown[]) => mockEndImpersonation(...args),
}))

import { GET } from './route'

function req(url = 'http://test/api/auth/end-impersonation'): NextRequest {
  return new NextRequest(url)
}

beforeEach(() => {
  mockAuth.mockReset()
  mockSignOut.mockReset()
  mockEndImpersonation.mockReset()
  // Default: signOut throws a NEXT_REDIRECT (the framework converts to 302).
  mockSignOut.mockImplementation(() => {
    throw Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;push;/;307',
    })
  })
})

describe('GET /api/auth/end-impersonation', () => {
  it('signs out without touching the audit log when no impersonation context', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u-1' } })
    await expect(GET(req())).rejects.toMatchObject({ message: 'NEXT_REDIRECT' })
    expect(mockEndImpersonation).not.toHaveBeenCalled()
    expect(mockSignOut).toHaveBeenCalledWith({ redirectTo: '/' })
  })

  it('marks endedAt then signs out when impersonationTokenId is present', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'u-1', impersonationTokenId: 'jti-1' },
    })
    mockEndImpersonation.mockResolvedValue(1)
    await expect(GET(req())).rejects.toMatchObject({ message: 'NEXT_REDIRECT' })
    expect(mockEndImpersonation).toHaveBeenCalledWith('jti-1')
    expect(mockSignOut).toHaveBeenCalledWith({ redirectTo: '/' })
  })

  it('still signs out if endImpersonation throws (audit close-out is best-effort)', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'u-1', impersonationTokenId: 'jti-1' },
    })
    mockEndImpersonation.mockRejectedValue(new Error('db down'))
    await expect(GET(req())).rejects.toMatchObject({ message: 'NEXT_REDIRECT' })
    expect(mockSignOut).toHaveBeenCalled()
  })

  it('handles no session at all', async () => {
    mockAuth.mockResolvedValue(null)
    await expect(GET(req())).rejects.toMatchObject({ message: 'NEXT_REDIRECT' })
    expect(mockEndImpersonation).not.toHaveBeenCalled()
    expect(mockSignOut).toHaveBeenCalled()
  })
})
