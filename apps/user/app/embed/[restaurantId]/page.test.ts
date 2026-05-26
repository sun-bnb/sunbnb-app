import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))
vi.mock('@/app/flags', () => ({ isFlagEnabled: vi.fn() }))
// Mock the client view so the test doesn't pull in MUI / the UI package.
vi.mock('./view', () => ({ default: () => null }))

import prisma from '@repo/data/PrismaCient'
import { isFlagEnabled } from '@/app/flags'
import { notFound } from 'next/navigation'
import EmbedBookingPage from './page'

const mockFlag = vi.mocked(isFlagEnabled)
const mockNotFound = vi.mocked(notFound)

beforeEach(() => {
  vi.clearAllMocks()
  mockFlag.mockResolvedValue(true)
})

describe('EmbedBookingPage', () => {
  it('404s when the restaurants flag is off', async () => {
    mockFlag.mockResolvedValue(false)
    await expect(
      EmbedBookingPage({ params: { restaurantId: 'r1' }, searchParams: {} }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
    expect(prisma.restaurant.findUnique).not.toHaveBeenCalled()
  })

  it('404s when the restaurant does not exist', async () => {
    vi.mocked(prisma.restaurant.findUnique).mockResolvedValue(null as any)
    await expect(
      EmbedBookingPage({ params: { restaurantId: 'missing' }, searchParams: {} }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })

  it('renders the booking view with restaurant props when found', async () => {
    vi.mocked(prisma.restaurant.findUnique).mockResolvedValue({
      id: 'r1',
      name: 'Vento',
      reservationWindow: 60,
      siteId: 'site-1',
    } as any)

    const el: any = await EmbedBookingPage({
      params: { restaurantId: 'r1' },
      searchParams: { date: '2026-08-01', partySize: '4' },
    })

    expect(mockNotFound).not.toHaveBeenCalled()
    expect(el.props.restaurant).toEqual({
      id: 'r1',
      name: 'Vento',
      reservationWindow: 60,
      siteId: 'site-1',
    })
    expect(el.props.initialDate).toBe('2026-08-01')
    expect(el.props.initialPartySize).toBe(4)
  })
})
