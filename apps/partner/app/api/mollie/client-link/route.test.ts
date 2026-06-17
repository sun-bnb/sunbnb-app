/**
 * Tests for POST /api/mollie/client-link
 *
 * Covers: auth gate, Zod validation, happy path (URL + CSRF cookie),
 * Mollie 403 (partner status required), auth errors (422), generic 500.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/app/api/_lib/mollie', () => ({
  createClientLink: vi.fn(),
  getMollieClientId: vi.fn(),
  OAUTH_SCOPES: 'payments.read+payments.write+profiles.read',
}))

import { POST } from './route'
import { auth } from '@/app/auth'
import { createClientLink, getMollieClientId } from '@/app/api/_lib/mollie'
import { NextRequest } from 'next/server'

const mockAuth = vi.mocked(auth)
const mockCreateClientLink = vi.mocked(createClientLink)
const mockGetClientId = vi.mocked(getMollieClientId)

const VALID_BODY = {
  email: 'owner@example.com',
  givenName: 'Jan',
  familyName: 'de Vries',
  organizationName: 'Beach Club BV',
  country: 'NL',
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/mollie/client-link', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  mockGetClientId.mockReturnValue('app_test_client_id')
  mockCreateClientLink.mockResolvedValue('https://my.mollie.com/clientlink/abc123')
})

describe('POST /api/mollie/client-link', () => {
  // ── Auth gate ────────────────────────────────────────────────────────────────

  it('returns 401 when not authenticated — does not call Mollie API', async () => {
    const response = await POST(makeRequest(VALID_BODY))
    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data.error).toBe('Not authenticated')
    expect(mockCreateClientLink).not.toHaveBeenCalled()
  })

  // ── Input validation (Zod) ────────────────────────────────────────────────────

  it('returns 400 with validation_error when email is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const { email: _omit, ...noEmail } = VALID_BODY
    const response = await POST(makeRequest(noEmail))
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.code).toBe('validation_error')
    expect(mockCreateClientLink).not.toHaveBeenCalled()
  })

  it('returns 400 with validation_error when email format is invalid', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const response = await POST(makeRequest({ ...VALID_BODY, email: 'not-an-email' }))
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.code).toBe('validation_error')
  })

  it('returns 400 with validation_error when country is not a 2-letter ISO code', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const response = await POST(makeRequest({ ...VALID_BODY, country: 'NLD' }))
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.code).toBe('validation_error')
  })

  it('returns 400 with validation_error when organizationName is blank', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const response = await POST(makeRequest({ ...VALID_BODY, organizationName: '' }))
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.code).toBe('validation_error')
  })

  // ── Happy path ────────────────────────────────────────────────────────────────

  it('returns 200 with url containing the client link', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)

    const response = await POST(makeRequest(VALID_BODY))
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.url).toContain('my.mollie.com/clientlink/abc123')
  })

  it('appends OAuth state, client_id, and scope to the returned URL', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)

    const response = await POST(makeRequest(VALID_BODY))
    const data = await response.json()

    expect(data.url).toContain('client_id=app_test_client_id')
    expect(data.url).toContain('state=')   // CSRF token appended
    expect(data.url).toContain('scope=')
    expect(data.url).toContain('redirect_uri=')
  })

  it('sets an httpOnly mollie_oauth_state CSRF cookie on the response', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)

    const response = await POST(makeRequest(VALID_BODY))

    const setCookie = response.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('mollie_oauth_state=')
    expect(setCookie).toContain('HttpOnly')
  })

  it('passes validated body fields to createClientLink', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)

    await POST(
      makeRequest({
        ...VALID_BODY,
        vatNumber: 'NL000099998B57',
        registrationNumber: 'KVK-12345678',
      }),
    )

    expect(mockCreateClientLink).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: expect.objectContaining({
          email: 'owner@example.com',
          givenName: 'Jan',
          familyName: 'de Vries',
        }),
        name: 'Beach Club BV',
        address: expect.objectContaining({ country: 'NL' }),
        vatNumber: 'NL000099998B57',
        registrationNumber: 'KVK-12345678',
      }),
    )
  })

  // ── Mollie error paths ────────────────────────────────────────────────────────

  it('returns 403 with partner_status_required when Mollie returns 403 (account lacks Partner status)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockCreateClientLink.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { statusCode: 403 }),
    )

    const response = await POST(makeRequest(VALID_BODY))
    expect(response.status).toBe(403)
    const data = await response.json()
    expect(data.code).toBe('partner_status_required')
  })

  it('returns 422 with client_links_unavailable when MOLLIE_ORG_TOKEN is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockCreateClientLink.mockRejectedValue(new Error('MOLLIE_ORG_TOKEN is not set'))

    const response = await POST(makeRequest(VALID_BODY))
    expect(response.status).toBe(422)
    const data = await response.json()
    expect(data.code).toBe('client_links_unavailable')
  })

  it('returns 422 with client_links_unavailable when Mollie returns 401 on client link creation', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockCreateClientLink.mockRejectedValue(
      Object.assign(new Error('Unauthorized'), { statusCode: 401 }),
    )

    const response = await POST(makeRequest(VALID_BODY))
    expect(response.status).toBe(422)
    const data = await response.json()
    expect(data.code).toBe('client_links_unavailable')
  })

  it('returns 422 with client_links_unavailable when error mentions Organization Access Token', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockCreateClientLink.mockRejectedValue(
      new Error('Organization Access Token required for this endpoint'),
    )

    const response = await POST(makeRequest(VALID_BODY))
    expect(response.status).toBe(422)
    const data = await response.json()
    expect(data.code).toBe('client_links_unavailable')
  })

  it('returns 500 with create_failed on unexpected errors', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockCreateClientLink.mockRejectedValue(new Error('Network timeout'))

    const response = await POST(makeRequest(VALID_BODY))
    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.code).toBe('create_failed')
  })
})
