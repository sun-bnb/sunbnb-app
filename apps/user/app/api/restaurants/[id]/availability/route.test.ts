import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@repo/table-reservations-core', () => ({
  getRestaurantAvailability: vi.fn(),
}))

vi.mock('@/app/flags', () => ({
  isFlagEnabled: vi.fn().mockResolvedValue(true),
}))

import { rateLimit } from '@repo/data/rate-limit'
import { getRestaurantAvailability } from '@repo/table-reservations-core'
import { isFlagEnabled } from '@/app/flags'
import { GET } from './route'

const mockRate = vi.mocked(rateLimit)
const mockAvailability = vi.mocked(getRestaurantAvailability)
const mockIsFlagEnabled = vi.mocked(isFlagEnabled)

function req(url: string): NextRequest {
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRate.mockReturnValue({ allowed: true } as any)
  mockIsFlagEnabled.mockResolvedValue(true)
})

describe('feature flag gate', () => {
  it('returns 404 when restaurants flag is off', async () => {
    mockIsFlagEnabled.mockResolvedValue(false)
    const res = await GET(
      req('http://test/api/restaurants/r1/availability?date=2026-05-13&partySize=2'),
      { params: { id: 'r1' } },
    )
    expect(res.status).toBe(404)
    expect(mockAvailability).not.toHaveBeenCalled()
  })
})

describe('GET /api/restaurants/[id]/availability', () => {
  it('returns slots in ISO form', async () => {
    mockAvailability.mockResolvedValue({
      slots: [
        {
          from: new Date('2026-05-01T17:00:00Z'),
          to: new Date('2026-05-01T19:00:00Z'),
          availableTableIds: ['t1', 't2'],
        },
      ],
      mealDurationMinutes: 120,
    })

    const res = await GET(
      req('https://local.test/api/restaurants/r1/availability?date=2026-05-01&partySize=2'),
      { params: { id: 'r1' } },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.slots).toHaveLength(1)
    expect(body.slots[0].from).toBe('2026-05-01T17:00:00.000Z')
    expect(body.slots[0].availableTableIds).toEqual(['t1', 't2'])
    expect(body.mealDurationMinutes).toBe(120)
  })

  it('rejects an invalid date', async () => {
    const res = await GET(
      req('https://local.test/api/restaurants/r1/availability?date=bad&partySize=2'),
      { params: { id: 'r1' } },
    )
    expect(res.status).toBe(400)
  })

  it('rejects an invalid party size', async () => {
    const res = await GET(
      req('https://local.test/api/restaurants/r1/availability?date=2026-05-01&partySize=0'),
      { params: { id: 'r1' } },
    )
    expect(res.status).toBe(400)
  })

  it('rejects when rate-limited', async () => {
    mockRate.mockReturnValue({ allowed: false } as any)
    const res = await GET(
      req('https://local.test/api/restaurants/r1/availability?date=2026-05-01&partySize=2'),
      { params: { id: 'r1' } },
    )
    expect(res.status).toBe(429)
  })
})
