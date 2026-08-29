import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockValidateManageToken } = vi.hoisted(() => ({
  mockValidateManageToken: vi.fn(),
}))

vi.mock('@/app/sites/[id]/manage/token', () => ({
  validateManageToken: mockValidateManageToken,
}))

import { GET } from './route'

function makeRequest(qs: string): Request {
  return new Request(`http://localhost/api/manage/context${qs}`)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/manage/context', () => {
  it('requires siteId', async () => {
    const response = await GET(makeRequest('?key=abc') as any)
    expect(response.status).toBe(400)
  })

  it('returns 401 on an invalid/expired key', async () => {
    mockValidateManageToken.mockResolvedValue({
      ok: false,
      error: { title: 'Invalid or expired access key', message: 'This access key is no longer valid.' },
    })

    const response = await GET(makeRequest('?siteId=site-1&key=bad-key') as any)
    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data.status).toBe('error')
    expect(data.errors).toContain('This access key is no longer valid.')
  })

  it('calls validateManageToken with the parsed siteId and key', async () => {
    mockValidateManageToken.mockResolvedValue({
      ok: false,
      error: { title: 'x', message: 'x' },
    })

    await GET(makeRequest('?siteId=site-42&key=my-key') as any)

    expect(mockValidateManageToken).toHaveBeenCalledWith('site-42', 'my-key')
  })

  it('returns 200 with site + isAdmin on success', async () => {
    mockValidateManageToken.mockResolvedValue({
      ok: true,
      token: { id: 'tok-1', resources: ['manage_site', 'admin'] },
      isAdmin: true,
      site: { id: 'site-1', name: 'Test Beach' },
    })

    const response = await GET(makeRequest('?siteId=site-1&key=good-key') as any)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({
      status: 'ok',
      site: { id: 'site-1', name: 'Test Beach' },
      isAdmin: true,
    })
  })
})
