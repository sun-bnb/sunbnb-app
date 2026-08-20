/**
 * Legacy venue POS page (track 022) — now a redirect to the short `/q/{siteCode}`,
 * with the same backfill-window fallback as the seat page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))
vi.mock('next/navigation', () => ({ redirect: mockRedirect }))
vi.mock('./queries', () => ({ getPosSite: vi.fn() }))
vi.mock('./view', () => ({ default: () => null }))
vi.mock('@/components/ErrorCard', () => ({ default: () => null }))

import { getPosSite } from './queries'
import PosView from './view'
import ErrorCard from '@/components/ErrorCard'
import SitePos from './page'

const mockGetSite = vi.mocked(getPosSite)

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSite.mockResolvedValue({ id: 'site-1', code: 'S-K7M2X9' } as never)
})

describe('legacy /sites/[id]/pos', () => {
  it('redirects a known site to its short code-keyed URL', async () => {
    await expect(
      SitePos({ params: { id: 'site-1' }, searchParams: {} }),
    ).rejects.toThrow('NEXT_REDIRECT:/q/S-K7M2X9')
  })

  it('preserves query params across the redirect', async () => {
    await expect(
      SitePos({ params: { id: 'site-1' }, searchParams: { anonId: 'anon-9' } }),
    ).rejects.toThrow('NEXT_REDIRECT:/q/S-K7M2X9?anonId=anon-9')
  })

  it('still accepts the branded slug as the legacy key', async () => {
    // The old route matched id OR slug, and printed material may carry either.
    await expect(
      SitePos({ params: { id: 'brisa-marina' }, searchParams: {} }),
    ).rejects.toThrow()

    expect(mockGetSite).toHaveBeenCalledWith({
      OR: [{ id: 'brisa-marina' }, { slug: 'brisa-marina' }],
    })
  })

  it('RENDERS instead of redirecting when the site has no code yet', async () => {
    mockGetSite.mockResolvedValue({ id: 'site-1', code: null } as never)

    const result = await SitePos({ params: { id: 'site-1' }, searchParams: {} })

    expect(mockRedirect).not.toHaveBeenCalled()
    expect(result.type).toBe(PosView)
  })

  it('shows the not-found card for an unknown site', async () => {
    mockGetSite.mockResolvedValue(null as never)

    const result = await SitePos({ params: { id: 'nope' }, searchParams: {} })

    expect(result.type).toBe(ErrorCard)
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})
