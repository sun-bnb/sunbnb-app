/**
 * Legacy seat POS page (track 022) — now a redirect to the short
 * `/q/{siteCode}/{parcel}-{row}-{seq}`, with a deliberate fallback.
 *
 * The fallback is the whole point of these tests. Cards printed with the old
 * cuid URL are already glued to loungers, and the short form needs TWO things
 * that not every environment has yet: a backfilled `Site.code`, and track 021's
 * unit address (production has neither column yet). Redirecting unconditionally
 * would send every one of those cards to a URL that resolves to nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Next's redirect throws to halt rendering — model that, so a test can prove
// nothing after the redirect runs.
const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))
vi.mock('next/navigation', () => ({ redirect: mockRedirect }))
vi.mock('./queries', () => ({ loadPosUnitByItem: vi.fn(), posAvailability: vi.fn() }))
vi.mock('./view', () => ({ default: () => null }))
vi.mock('@/components/ErrorCard', () => ({ default: () => null }))

import { loadPosUnitByItem, posAvailability } from './queries'
import PosView from './view'
import ErrorCard from '@/components/ErrorCard'
import Pos from './page'

const mockLoad = vi.mocked(loadPosUnitByItem)
const mockAvailability = vi.mocked(posAvailability)

const ITEMS = [{ id: 'seat-a' }, { id: 'seat-b' }]

function unit(over: Record<string, unknown> = {}) {
  return {
    site: { id: 'site-1', code: 'S-K7M2X9' },
    items: ITEMS,
    address: { parcel: 1, row: 1, seq: 1 },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLoad.mockResolvedValue(unit() as never)
  mockAvailability.mockResolvedValue(['seat-a'])
})

describe('legacy /sites/[id]/pos/[itemId]', () => {
  it('redirects a scanned old card to its short address-keyed URL', async () => {
    await expect(
      Pos({ params: { itemId: 'item-1' }, searchParams: {} }),
    ).rejects.toThrow('NEXT_REDIRECT:/q/S-K7M2X9/1-1-1')
  })

  it('preserves query params across the redirect', async () => {
    await expect(
      Pos({ params: { itemId: 'item-1' }, searchParams: { anonId: 'anon-9' } }),
    ).rejects.toThrow('NEXT_REDIRECT:/q/S-K7M2X9/1-1-1?anonId=anon-9')
  })

  it('never spends the availability query on a request it is redirecting', async () => {
    await expect(
      Pos({ params: { itemId: 'item-1' }, searchParams: {} }),
    ).rejects.toThrow()

    expect(mockAvailability).not.toHaveBeenCalled()
  })

  it('RENDERS instead of redirecting when the site has no code yet', async () => {
    // The window between deploying this and running backfill:site-codes on that
    // environment. Every card at the venue goes through here during it.
    mockLoad.mockResolvedValue(unit({ site: { id: 'site-1', code: null } }) as never)

    const result = await Pos({ params: { itemId: 'item-1' }, searchParams: {} })

    expect(mockRedirect).not.toHaveBeenCalled()
    expect(result.type).toBe(PosView)
    expect(result.props.availableItemIds).toEqual(['seat-a'])
  })

  it('RENDERS instead of redirecting when the unit has no address', async () => {
    // Production has not received track 021's parcel/row columns, so every unit
    // there answers null here until it does.
    mockLoad.mockResolvedValue(unit({ address: null }) as never)

    const result = await Pos({ params: { itemId: 'item-1' }, searchParams: {} })

    expect(mockRedirect).not.toHaveBeenCalled()
    expect(result.type).toBe(PosView)
  })

  it('shows the not-found card for an unknown item, and does not redirect', async () => {
    mockLoad.mockResolvedValue(null)

    const result = await Pos({ params: { itemId: 'nope' }, searchParams: {} })

    expect(result.type).toBe(ErrorCard)
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})
