import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@repo/table-reservations-core', () => ({
  getPublicRestaurantLayout: vi.fn(),
}))

vi.mock('@/app/flags', () => ({
  isFlagEnabled: vi.fn().mockResolvedValue(true),
}))

import { rateLimit } from '@repo/data/rate-limit'
import { getPublicRestaurantLayout } from '@repo/table-reservations-core'
import { isFlagEnabled } from '@/app/flags'
import { GET } from './route'

const mockRate = vi.mocked(rateLimit)
const mockLayout = vi.mocked(getPublicRestaurantLayout)
const mockIsFlagEnabled = vi.mocked(isFlagEnabled)

function req(url: string): NextRequest {
  return new NextRequest(url)
}

const layout = {
  restaurantId: 'r1',
  guestSelectionEnabled: true,
  world: { width: 15, height: 10 },
  elements: [],
  tables: [
    {
      id: 't1',
      label: 'A1',
      capacity: 2,
      shape: 'square',
      width: 1.2,
      height: 1.2,
      schematicX: 3,
      schematicY: 4,
      rotation: 0,
      zone: 'Terrace',
      guestSelectable: true,
      seatsTop: null,
      seatsRight: null,
      seatsBottom: null,
      seatsLeft: null,
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRate.mockReturnValue({ allowed: true } as any)
  mockIsFlagEnabled.mockResolvedValue(true)
})

describe('GET /api/restaurants/[id]/layout', () => {
  it('returns 404 when the restaurants flag is off', async () => {
    mockIsFlagEnabled.mockResolvedValue(false)
    const res = await GET(req('https://test/api/restaurants/r1/layout'), { params: { id: 'r1' } })
    expect(res.status).toBe(404)
    expect(mockLayout).not.toHaveBeenCalled()
  })

  it('returns 429 when rate-limited', async () => {
    mockRate.mockReturnValue({ allowed: false } as any)
    const res = await GET(req('https://test/api/restaurants/r1/layout'), { params: { id: 'r1' } })
    expect(res.status).toBe(429)
  })

  it('returns 404 when the restaurant is missing', async () => {
    mockLayout.mockResolvedValue(null as any)
    const res = await GET(req('https://test/api/restaurants/missing/layout'), {
      params: { id: 'missing' },
    })
    expect(res.status).toBe(404)
  })

  it('returns 404 when guest selection is disabled for the venue', async () => {
    mockLayout.mockResolvedValue({ ...layout, guestSelectionEnabled: false } as any)
    const res = await GET(req('https://test/api/restaurants/r1/layout'), { params: { id: 'r1' } })
    expect(res.status).toBe(404)
  })

  it('returns the sanitized layout when guest selection is enabled', async () => {
    mockLayout.mockResolvedValue(layout as any)
    const res = await GET(req('https://test/api/restaurants/r1/layout'), { params: { id: 'r1' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.guestSelectionEnabled).toBe(true)
    expect(body.world).toEqual({ width: 15, height: 10 })
    expect(body.tables).toHaveLength(1)
    expect(body.tables[0].id).toBe('t1')
    // Sanitized — no partner-internal fields leak.
    expect(body.tables[0].staffNote).toBeUndefined()
    expect(body.tables[0].depositPerGuest).toBeUndefined()
  })
})
