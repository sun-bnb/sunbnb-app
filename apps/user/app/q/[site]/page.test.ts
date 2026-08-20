/**
 * Venue QR entry page (track 022) — `/q/{siteCode}`, the short `/sites/{id}/pos`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/sites/[id]/pos/queries', () => ({ getPosSite: vi.fn() }))
vi.mock('@/app/sites/[id]/pos/view', () => ({ default: () => null }))
vi.mock('@/components/ErrorCard', () => ({ default: () => null }))

import { getPosSite } from '@/app/sites/[id]/pos/queries'
import PosView from '@/app/sites/[id]/pos/view'
import ErrorCard from '@/components/ErrorCard'
import QrVenuePage from './page'

const mockGetSite = vi.mocked(getPosSite)

const SITE = { id: 'site-1', code: 'S-K7M2X9', inventoryItems: [] }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSite.mockResolvedValue(SITE as never)
})

describe('/q/[site]', () => {
  it('renders the venue map for a known code', async () => {
    const result = await QrVenuePage({ params: { site: 'S-K7M2X9' } })

    expect(result.type).toBe(PosView)
    expect(result.props.site).toBe(SITE)
  })

  it('looks the site up by the FOLDED code', async () => {
    // A card read aloud and typed in arrives lowercase and often without the
    // prefix; querying that verbatim would miss a site that is right there.
    await QrVenuePage({ params: { site: 'k7m2x9' } })

    expect(mockGetSite).toHaveBeenCalledWith({ code: 'S-K7M2X9' })
  })

  it('declines a malformed code without touching the database', async () => {
    const result = await QrVenuePage({ params: { site: 'not-a-code' } })

    expect(result.type).toBe(ErrorCard)
    expect(mockGetSite).not.toHaveBeenCalled()
  })

  it('shows the not-found card for a well-formed but unknown code', async () => {
    mockGetSite.mockResolvedValue(null as never)

    const result = await QrVenuePage({ params: { site: 'S-ZZZZZZ' } })

    expect(result.type).toBe(ErrorCard)
  })
})
