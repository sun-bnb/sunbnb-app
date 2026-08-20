/**
 * Seat QR entry page (track 022) — `/q/{siteCode}/{parcel}-{row}-{seq}`.
 *
 * The page itself is thin by design: resolution is `resolveQrTarget`'s job and
 * availability is the canonical service's. What is worth pinning is that it
 * stays thin — that it hands the URL segments over UNTOUCHED (folding belongs in
 * one place), that it never renders a page for something it could not resolve,
 * and that it asks the shared availability tail rather than deriving anything.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/q/resolve', () => ({ resolveQrTarget: vi.fn() }))
vi.mock('@/app/sites/[id]/pos/[itemId]/queries', () => ({ posAvailability: vi.fn() }))
vi.mock('@/app/sites/[id]/pos/[itemId]/view', () => ({ default: () => null }))
vi.mock('@/components/ErrorCard', () => ({ default: () => null }))

import { resolveQrTarget } from '@/app/q/resolve'
import { posAvailability } from '@/app/sites/[id]/pos/[itemId]/queries'
import PosView from '@/app/sites/[id]/pos/[itemId]/view'
import ErrorCard from '@/components/ErrorCard'
import QrSeatPage from './page'

const mockResolve = vi.mocked(resolveQrTarget)
const mockAvailability = vi.mocked(posAvailability)

const SITE = { id: 'site-1', code: 'S-K7M2X9' }
const ITEMS = [{ id: 'seat-a' }, { id: 'seat-b' }]

beforeEach(() => {
  vi.clearAllMocks()
  mockResolve.mockResolvedValue({ site: SITE, items: ITEMS } as never)
  mockAvailability.mockResolvedValue(['seat-a'])
})

describe('/q/[site]/[unit]', () => {
  it('renders the unit with the seats the canonical service reports free', async () => {
    const result = await QrSeatPage({ params: { site: 'S-K7M2X9', unit: '1-1-1' } })

    expect(result.type).toBe(PosView)
    expect(result.props.site).toBe(SITE)
    expect(result.props.items).toBe(ITEMS)
    expect(result.props.availableItemIds).toEqual(['seat-a'])
    expect(mockAvailability).toHaveBeenCalledWith(SITE, ITEMS)
  })

  it('hands the URL segments to the resolver untouched', async () => {
    // Folding a code and parsing an address happen in ONE place. A page that
    // "helpfully" uppercased or trimmed here would be a second opinion about
    // what the string on the card means.
    await QrSeatPage({ params: { site: 's-k7m2x9', unit: ' 1-1-1-2 ' } })

    expect(mockResolve).toHaveBeenCalledWith('s-k7m2x9', ' 1-1-1-2 ')
  })

  it('shows the not-found card when nothing stands at that address', async () => {
    mockResolve.mockResolvedValue(null)

    const result = await QrSeatPage({ params: { site: 'S-K7M2X9', unit: '9-9-9' } })

    expect(result.type).toBe(ErrorCard)
  })

  it('never asks for availability when resolution failed', async () => {
    // Availability is the expensive half. An unresolved card is the common case
    // for a crawler or a mistyped URL and must not reach it.
    mockResolve.mockResolvedValue(null)

    await QrSeatPage({ params: { site: 'S-K7M2X9', unit: '9-9-9' } })

    expect(mockAvailability).not.toHaveBeenCalled()
  })
})
