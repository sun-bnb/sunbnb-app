import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockLoadManageGrid } = vi.hoisted(() => ({
  mockLoadManageGrid: vi.fn(),
}))

vi.mock('@/app/sites/[id]/manage/load-grid', () => ({
  loadManageGrid: mockLoadManageGrid,
}))

import { GET } from './route'

function makeRequest(qs: string): Request {
  return new Request(`http://localhost/api/manage/grid${qs}`)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/manage/grid', () => {
  it('requires siteId', async () => {
    const response = await GET(makeRequest('?key=abc') as any)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.status).toBe('error')
  })

  it('returns 401 on an invalid/expired key', async () => {
    mockLoadManageGrid.mockResolvedValue({
      ok: false,
      error: { title: 'Invalid or expired access key', message: 'nope' },
    })

    const response = await GET(makeRequest('?siteId=site-1&key=bad-key') as any)
    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data.status).toBe('error')
    expect(data.errors).toContain('nope')
  })

  it('calls loadManageGrid with the parsed siteId and key', async () => {
    mockLoadManageGrid.mockResolvedValue({
      ok: false,
      error: { title: 'x', message: 'x' },
    })

    await GET(makeRequest('?siteId=site-42&key=my-key') as any)

    expect(mockLoadManageGrid).toHaveBeenCalledWith('site-42', 'my-key')
  })

  it('returns 200 with the full payload on success', async () => {
    mockLoadManageGrid.mockResolvedValue({
      ok: true,
      site: { id: 'site-1', name: 'Test Beach' },
      employees: [{ id: 'emp-1', name: 'Ana' }],
      isAdmin: true,
    })

    const response = await GET(makeRequest('?siteId=site-1&key=good-key') as any)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({
      status: 'ok',
      site: { id: 'site-1', name: 'Test Beach' },
      employees: [{ id: 'emp-1', name: 'Ana' }],
      isAdmin: true,
    })
  })
})
