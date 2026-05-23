import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/app/api/_lib/payment-ids', () => ({
  isValidEntityId: () => true,
}))

import { GET } from './route'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

const mockAuth = vi.mocked(auth)
const mockFindUnique = vi.mocked(prisma.site.findUnique)

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

function makeRequest(id: string) {
  return new NextRequest(`http://localhost:3002/api/sites/${id}`, { method: 'GET' })
}

describe('GET /api/sites/[id]', () => {
  it('includes layoutElements in the Prisma query', async () => {
    mockFindUnique.mockResolvedValue({ id: 'site-1', layoutElements: [] } as any)

    await GET(makeRequest('site-1'), { params: { id: 'site-1' } })

    expect(mockFindUnique).toHaveBeenCalledTimes(1)
    const args = mockFindUnique.mock.calls[0][0] as any
    expect(args.include.layoutElements).toBe(true)
  })

  it('returns the site payload including layoutElements', async () => {
    const layoutElements = [
      { id: 'el-1', siteId: 'site-1', type: 'pool', shape: 'ellipse', x: 5, y: 5, width: 10, height: 6, rotation: 0, z: 0 },
    ]
    mockFindUnique.mockResolvedValue({ id: 'site-1', layoutMode: 'schematic', layoutElements } as any)

    const res = await GET(makeRequest('site-1'), { params: { id: 'site-1' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.layoutMode).toBe('schematic')
    expect(body.layoutElements).toHaveLength(1)
    expect(body.layoutElements[0].type).toBe('pool')
  })
})
