import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/auth-helpers', () => ({
  requireSiteOwner: vi.fn().mockResolvedValue({ session: null, error: 'Not authenticated' }),
}))

import {
  saveGeneral,
  submitForm,
  deleteSite,
  setSiteStatus,
  setPaymentProvider,
  checkSlug,
  generateSlug,
  saveBrand,
} from './site-actions'
import { auth } from '@/app/auth'
import { requireSiteOwner } from '@/lib/auth-helpers'
import prisma from '@repo/data/PrismaCient'

const mockAuth = vi.mocked(auth)
const mockRequireSiteOwner = vi.mocked(requireSiteOwner)
const OWNER_ID = 'owner-1'
const SITE_ID = 'site-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  mockRequireSiteOwner.mockResolvedValue({ session: null, error: 'Not authenticated' })
})

function authorizeOwner() {
  const session = { user: { id: OWNER_ID } }
  mockAuth.mockResolvedValue(session as any)
  mockRequireSiteOwner.mockResolvedValue({ session, error: null })
}

// ─── saveGeneral ────────────────────────────────────────────────────────────

describe('saveGeneral', () => {
  it('rejects unauthenticated user', async () => {
    const res = await saveGeneral({
      id: SITE_ID,
      name: 'Beach Club',
      type: 'paid',
      price: '25',
      vat: '21',
      locationLat: '40.0',
      locationLng: '3.0',
    })
    expect(res.status).toBe('error')
  })

  it('validates required fields', async () => {
    authorizeOwner()
    const res = await saveGeneral({
      id: SITE_ID,
      name: '',
      type: 'paid',
      price: '25',
      vat: '21',
      locationLat: '',
      locationLng: '',
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Site name is required')
    expect(res.errors).toContain('Location is required')
  })

  it('updates site and PostGIS coords on success', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as any)

    const res = await saveGeneral({
      id: SITE_ID,
      name: 'Beach Club',
      type: 'paid',
      price: '25',
      vat: '21',
      locationLat: '40.0',
      locationLng: '3.0',
    })

    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.site.update)).toHaveBeenCalledWith({
      where: { id: SITE_ID },
      data: expect.objectContaining({
        name: 'Beach Club',
        type: 'paid',
        price: 25,
        vat: 21,
      }),
    })
    expect(vi.mocked(prisma.$executeRaw)).toHaveBeenCalled()
  })

  it('sets price to null when zero or negative', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as any)

    await saveGeneral({
      id: SITE_ID,
      name: 'Free Beach',
      type: 'unpaid',
      price: '0',
      vat: '0',
      locationLat: '40.0',
      locationLng: '3.0',
    })

    const updateCall = vi.mocked(prisma.site.update).mock.calls[0][0]
    expect(updateCall.data.price).toBeNull()
    expect(updateCall.data.vat).toBeNull()
  })
})

// ─── submitForm ─────────────────────────────────────────────────────────────

describe('submitForm', () => {
  it('rejects unauthenticated', async () => {
    const formData = new FormData()
    const res = await submitForm({ status: '' }, formData)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('validates required form fields', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    const formData = new FormData()
    // Missing name, locationLat, locationLng
    const res = await submitForm({ status: '' }, formData)
    expect(res.status).toBe('error')
    expect(res.errors?.some(e => e.includes('is required'))).toBe(true)
  })

  it('validates price is numeric', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    const formData = new FormData()
    formData.set('name', 'Test')
    formData.set('locationLat', '40')
    formData.set('locationLng', '3')
    formData.set('price', 'not-a-number')

    const res = await submitForm({ status: '' }, formData)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Invalid price')
  })

  it('creates new site when no id in formData', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.create).mockResolvedValue({ id: 'new-site-id' } as any)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as any)

    const formData = new FormData()
    formData.set('name', 'New Beach')
    formData.set('locationLat', '40')
    formData.set('locationLng', '3')

    const res = await submitForm({ status: '' }, formData)
    expect(res.status).toBe('ok')
    expect((res as any).siteId).toBe('new-site-id')
  })
})

// ─── deleteSite ─────────────────────────────────────────────────────────────

describe('deleteSite', () => {
  it('rejects non-owner', async () => {
    const res = await deleteSite(SITE_ID)
    expect(res.status).toBe('error')
  })

  it('deletes site on success', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.delete).mockResolvedValue({} as any)

    const res = await deleteSite(SITE_ID)
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.site.delete)).toHaveBeenCalledWith({ where: { id: SITE_ID } })
  })
})

// ─── setSiteStatus ──────────────────────────────────────────────────────────

describe('setSiteStatus', () => {
  it('rejects invalid status', async () => {
    authorizeOwner()
    const res = await setSiteStatus(SITE_ID, 'deleted')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid site status')
  })

  it('accepts valid status', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)
    const res = await setSiteStatus(SITE_ID, 'active')
    expect(res.status).toBe('ok')
  })
})

// ─── setPaymentProvider ─────────────────────────────────────────────────────

describe('setPaymentProvider', () => {
  it('rejects invalid provider', async () => {
    authorizeOwner()
    const res = await setPaymentProvider(SITE_ID, 'paypal')
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Invalid payment provider')
  })

  it('accepts stripe without additional checks', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)
    const res = await setPaymentProvider(SITE_ID, 'stripe')
    expect(res.status).toBe('ok')
  })

  it('rejects mollie when partner has no Mollie token', async () => {
    authorizeOwner()
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({ mollieAccessToken: null } as any)
    const res = await setPaymentProvider(SITE_ID, 'mollie')
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Mollie')
  })

  it('accepts mollie when partner has valid token', async () => {
    authorizeOwner()
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({ mollieAccessToken: 'tok_123' } as any)
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)
    const res = await setPaymentProvider(SITE_ID, 'mollie')
    expect(res.status).toBe('ok')
  })
})

// ─── checkSlug ──────────────────────────────────────────────────────────────

describe('checkSlug', () => {
  it('returns unavailable when not authenticated', async () => {
    const res = await checkSlug('my-beach', SITE_ID)
    expect(res.available).toBe(false)
  })

  it('returns unavailable for too-short slug', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    const res = await checkSlug('ab', SITE_ID)
    expect(res.available).toBe(false)
  })

  it('returns available when slug is free', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findFirst).mockResolvedValue(null)
    const res = await checkSlug('beach-club', SITE_ID)
    expect(res.available).toBe(true)
  })

  it('returns unavailable when slug is taken by another site', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findFirst).mockResolvedValue({ id: 'other-site' } as any)
    const res = await checkSlug('beach-club', SITE_ID)
    expect(res.available).toBe(false)
  })

  it('normalizes slug (strips special chars, lowercases)', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findFirst).mockResolvedValue(null)
    await checkSlug('Beach Club!@#', SITE_ID)
    const findCall = vi.mocked(prisma.site.findFirst).mock.calls[0][0]
    expect(findCall.where.slug).toBe('beachclub')
  })
})

// ─── saveBrand ──────────────────────────────────────────────────────────────

describe('saveBrand', () => {
  it('validates brand name required', async () => {
    authorizeOwner()
    const res = await saveBrand({
      siteId: SITE_ID,
      brandName: '',
      slug: 'my-brand',
      tagline: '',
      bgColor: '#fff',
      fgColor: '#000',
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Brand name is required')
  })

  it('validates slug min length', async () => {
    authorizeOwner()
    const res = await saveBrand({
      siteId: SITE_ID,
      brandName: 'My Brand',
      slug: 'ab',
      tagline: '',
      bgColor: '#fff',
      fgColor: '#000',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('at least 3')
  })

  it('validates slug uniqueness', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.findFirst).mockResolvedValue({ id: 'other-site' } as any)
    const res = await saveBrand({
      siteId: SITE_ID,
      brandName: 'My Brand',
      slug: 'taken-slug',
      tagline: '',
      bgColor: '#fff',
      fgColor: '#000',
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('already taken')
  })

  it('upserts brand and updates slug on success', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.findFirst).mockResolvedValue(null) // slug available
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)
    vi.mocked(prisma.siteBrand.upsert).mockResolvedValue({} as any)

    const res = await saveBrand({
      siteId: SITE_ID,
      brandName: 'Beach Club',
      slug: 'beach-club',
      tagline: 'Best sunbeds',
      bgColor: '#faf9f6',
      fgColor: '#111827',
    })

    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.site.update)).toHaveBeenCalledWith({
      where: { id: SITE_ID },
      data: { slug: 'beach-club' },
    })
    expect(vi.mocked(prisma.siteBrand.upsert)).toHaveBeenCalled()
  })
})
