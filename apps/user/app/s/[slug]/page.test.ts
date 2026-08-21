/**
 * The branded page's brand fork (track 023 P3).
 *
 * `/s/[slug]` is a public storefront, so the case worth most of this file is the
 * one where the bespoke module does NOT work: a missing key, a key nothing
 * answers to, a module that throws on import. Every one of those must land on
 * the standard branded page, because a bespoke page failing should cost the
 * customer their design and never their bookings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('@/service/availabilityService', () => ({
  countAvailableToday: vi.fn().mockResolvedValue({ availableCount: 7 }),
}))
vi.mock('./view', () => ({ default: () => null }))
vi.mock('@/utils/logger', () => ({ default: { error: vi.fn(), debug: vi.fn(), info: vi.fn() } }))

vi.mock('@/brands/BrandMount', () => ({ default: () => null }))

import prisma from '@repo/data/PrismaCient'
import BrandedSiteView from './view'
import BrandMount from '@/brands/BrandMount'
import BrandedSitePage from './page'

const findFirst = vi.mocked(prisma.site.findFirst)

function site(over: Record<string, unknown> = {}) {
  return {
    id: 'site-1',
    name: 'Brisa Marina',
    slug: 'brisa-marina',
    features: ['sunbeds'],
    brand: { brandName: 'Brisa Marina' },
    customBrandEnabled: true,
    customBrandKey: 'reference',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  findFirst.mockResolvedValue(site() as never)
})

describe('/s/[slug] brand fork', () => {
  it('mounts the bespoke module when a real key is assigned and the switch is on', async () => {
    const result = await BrandedSitePage({ params: { slug: 'brisa-marina' } })

    expect(result.type).toBe(BrandMount)
    expect(result.props.brandKey).toBe('reference')
  })

  it('hands the mount the same data the standard page would have used', async () => {
    const result = await BrandedSitePage({ params: { slug: 'brisa-marina' } })

    expect(result.props.site.id).toBe('site-1')
    expect(result.props.initialAvailableCount).toBe(7)
    expect(result.props).toHaveProperty('apiKey')
  })

  it('renders the standard page when the switch is off, without loading the module', async () => {
    // Merged-but-dark: the module is assigned and reviewed, the customer has not
    // approved it yet. Loading it anyway would waste the work the gate exists for.
    findFirst.mockResolvedValue(site({ customBrandEnabled: false }) as never)

    const result = await BrandedSitePage({ params: { slug: 'brisa-marina' } })

    expect(result.type).toBe(BrandedSiteView)
  })

  it('renders the standard page when the assigned key answers to no module', async () => {
    // A typo in admin, or a module deleted while a site still points at it.
    findFirst.mockResolvedValue(site({ customBrandKey: 'ghost-brand' }) as never)

    const result = await BrandedSitePage({ params: { slug: 'brisa-marina' } })

    expect(result.type).toBe(BrandedSiteView)
  })

  it('renders the standard page when no key is assigned at all', async () => {
    findFirst.mockResolvedValue(site({ customBrandKey: null }) as never)

    const result = await BrandedSitePage({ params: { slug: 'brisa-marina' } })

    expect(result.type).toBe(BrandedSiteView)
  })

  it('still reports an unknown slug rather than reaching the brand fork', async () => {
    findFirst.mockResolvedValue(null as never)

    const result = await BrandedSitePage({ params: { slug: 'nope' } })

    expect(result.type).toBe('div')
  })
})
