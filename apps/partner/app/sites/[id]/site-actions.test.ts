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

// Real (pure) module by default — spied so one test can force the "coords
// don't resolve" branch, which real-world valid lat/lng never hits with the
// current tz-lookup version (it only throws for out-of-range coords, which
// saveGeneral's own validation already rejects before reaching this call).
vi.mock('@repo/data/site-day', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/data/site-day')>()
  return { ...actual, deriveTimeZoneFromCoords: vi.fn(actual.deriveTimeZoneFromCoords) }
})

import {
  saveGeneral,
  submitForm,
  deleteSite,
  setSiteStatus,
  setPartialGroupBooking,
  setPaymentProvider,
  checkSlug,
  generateSlug,
  saveBrand,
} from './site-actions'
import { auth } from '@/app/auth'
import { requireSiteOwner } from '@/lib/auth-helpers'
import prisma from '@repo/data/PrismaCient'
import { getEffectiveSubscriptionForUser } from '@repo/data/subscription'
import { deriveTimeZoneFromCoords } from '@repo/data/site-day'

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

  it('derives and persists Site.timeZone from non-Madrid coords', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as any)

    // Athens coords — clearly distinct from the Europe/Madrid fallback, so the
    // assertion actually proves derivation ran (not just "some string").
    const res = await saveGeneral({
      id: SITE_ID,
      name: 'Athens Beach Club',
      type: 'paid',
      price: '25',
      vat: '21',
      locationLat: '37.98',
      locationLng: '23.73',
    })

    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.site.update)).toHaveBeenCalledWith({
      where: { id: SITE_ID },
      data: expect.objectContaining({
        timeZone: 'Europe/Athens',
      }),
    })
  })

  it('does not null out timeZone when coords fail to resolve', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as any)
    // Force the "can't derive" branch (real-world valid lat/lng always resolves
    // with the current tz-lookup version — see comment at the top of this file).
    vi.mocked(deriveTimeZoneFromCoords).mockReturnValueOnce(null)

    const res = await saveGeneral({
      id: SITE_ID,
      name: 'Undetermined Zone Club',
      type: 'paid',
      price: '25',
      vat: '21',
      locationLat: '40.0',
      locationLng: '3.0',
    })

    expect(res.status).toBe('ok')
    // Must omit `timeZone` entirely — never write null over a previously-good
    // stored value just because this save's derivation didn't resolve.
    const updateCall = vi.mocked(prisma.site.update).mock.calls[0][0]
    expect(updateCall.data).not.toHaveProperty('timeZone')
  })

  it('sets price to null when zero or negative', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as any)
    // type:'unpaid' requires the off-platform-billing entitlement; grant it so the
    // update proceeds (this test exercises price-null logic, not the gate).
    vi.mocked(getEffectiveSubscriptionForUser).mockResolvedValueOnce({
      tier: 'BUSINESS', name: 'Business', monthlyPrice: 0, maxSites: 999,
      isCustom: false, features: { OFF_PLATFORM_BILLING: true },
    } as any)

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

  // saveGeneral validates the `type` field against the known values ('paid', 'unpaid').
  // An arbitrary string (e.g. 'hacked') is rejected before the DB is touched.
  it('rejects invalid site type', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as any)

    const res = await saveGeneral({
      id: SITE_ID,
      name: 'Beach Club',
      type: 'hacked',
      price: '25',
      vat: '21',
      locationLat: '40.0',
      locationLng: '3.0',
    })

    expect(res.status).toBe('error')
    expect(res.errors).toBeDefined()
    expect(res.errors!.length).toBeGreaterThan(0)
    // The DB should never be called with an invalid type
    expect(vi.mocked(prisma.site.update)).not.toHaveBeenCalled()
  })

  // saveGeneral validates that price is numeric — Number('abc') → NaN triggers an
  // 'Invalid price' error, preventing a paid site from being saved with a null price.
  it('rejects non-numeric price when type is paid', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as any)

    const res = await saveGeneral({
      id: SITE_ID,
      name: 'Beach Club',
      type: 'paid',
      price: 'abc',
      vat: '21',
      locationLat: '40.0',
      locationLng: '3.0',
    })

    expect(res.status).toBe('error')
    expect(res.errors).toBeDefined()
    expect(res.errors!.some((e) => /price/i.test(e))).toBe(true)
    // The DB should never be updated with NaN/null price for a paid site
    expect(vi.mocked(prisma.site.update)).not.toHaveBeenCalled()
  })

  it('rejects invalid layoutMode value', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)

    const res = await saveGeneral({
      id: SITE_ID,
      name: 'Beach Club',
      type: 'paid',
      price: '25',
      vat: '21',
      locationLat: '40.0',
      locationLng: '3.0',
      layoutMode: 'hexagonal',
    })

    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid layout mode')
    expect(vi.mocked(prisma.site.update)).not.toHaveBeenCalled()
  })

  it('refuses layoutMode switch when inventory items exist (hard-lock)', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      layoutMode: 'geo',
    } as any)
    // Pool-excluded map item count — 12 real sunbeds present
    vi.mocked(prisma.inventoryItem.count).mockResolvedValue(12 as any)
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)

    const res = await saveGeneral({
      id: SITE_ID,
      name: 'Beach Club',
      type: 'paid',
      price: '25',
      vat: '21',
      locationLat: '40.0',
      locationLng: '3.0',
      layoutMode: 'schematic',
    })

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot change layout mode')
    expect(vi.mocked(prisma.site.update)).not.toHaveBeenCalled()
  })

  it('persists layoutMode + width + height when items absent', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      layoutMode: 'geo',
    } as any)
    // Pool-excluded map item count — zero, so mode switch is allowed
    vi.mocked(prisma.inventoryItem.count).mockResolvedValue(0 as any)
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as any)

    const res = await saveGeneral({
      id: SITE_ID,
      name: 'Pool Club',
      type: 'paid',
      price: '15',
      vat: '21',
      locationLat: '40.0',
      locationLng: '3.0',
      layoutMode: 'schematic',
      layoutWidth: '50',
      layoutHeight: '35',
    })

    expect(res.status).toBe('ok')
    const updateData = vi.mocked(prisma.site.update).mock.calls[0]![0].data as any
    expect(updateData.layoutMode).toBe('schematic')
    expect(updateData.layoutWidth).toBe(50)
    expect(updateData.layoutHeight).toBe(35)
  })

  it('rejects layout dimensions outside 1–1000 m', async () => {
    authorizeOwner()
    const res = await saveGeneral({
      id: SITE_ID,
      name: 'Pool Club',
      type: 'paid',
      price: '15',
      vat: '21',
      locationLat: '40.0',
      locationLng: '3.0',
      layoutMode: 'schematic',
      layoutWidth: '0',
      layoutHeight: '5000',
    })

    expect(res.status).toBe('error')
    expect(res.errors?.some((e) => /width/i.test(e))).toBe(true)
    expect(res.errors?.some((e) => /height/i.test(e))).toBe(true)
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

// ─── setPartialGroupBooking ─────────────────────────────────────────────────

describe('setPartialGroupBooking', () => {
  it('rejects unauthenticated user without writing', async () => {
    const res = await setPartialGroupBooking(SITE_ID, true)
    expect(res.status).toBe('error')
    expect(vi.mocked(prisma.site.update)).not.toHaveBeenCalled()
  })

  it('enables partial group booking for the owner', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)
    const res = await setPartialGroupBooking(SITE_ID, true)
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.site.update)).toHaveBeenCalledWith({
      where: { id: SITE_ID },
      data: { partialGroupBookingEnabled: true },
    })
  })

  it('disables it again — the write is the flag, not a toggle of stored state', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)
    const res = await setPartialGroupBooking(SITE_ID, false)
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.site.update)).toHaveBeenCalledWith({
      where: { id: SITE_ID },
      data: { partialGroupBookingEnabled: false },
    })
  })

  it('refuses a non-boolean value rather than coercing it', async () => {
    authorizeOwner()
    const res = await setPartialGroupBooking(SITE_ID, 'yes' as unknown as boolean)
    expect(res.status).toBe('error')
    expect(vi.mocked(prisma.site.update)).not.toHaveBeenCalled()
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

  it('rejects stripe (consumer payments are Mollie-only)', async () => {
    authorizeOwner()
    const res = await setPaymentProvider(SITE_ID, 'stripe')
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Invalid payment provider')
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

// ─── Off-platform billing entitlement (saveGeneral) ─────────────────────────

describe('saveGeneral — off-platform billing entitlement', () => {
  const mockGetEffective = vi.mocked(getEffectiveSubscriptionForUser)

  const baseInput = {
    id: SITE_ID,
    name: 'Beach Club',
    type: 'unpaid',
    price: '',
    vat: '',
    locationLat: '40.0',
    locationLng: '3.0',
  }

  it('rejects type:unpaid when OFF_PLATFORM_BILLING feature is false', async () => {
    authorizeOwner()
    mockGetEffective.mockResolvedValue({
      tier: 'STARTER',
      name: 'Starter',
      monthlyPrice: 0,
      maxSites: 1,
      isCustom: false,
      features: { OFF_PLATFORM_BILLING: false },
    } as any)

    const res = await saveGeneral(baseInput)

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Off-platform billing')
    expect(vi.mocked(prisma.site.update)).not.toHaveBeenCalled()
  })

  it('allows type:unpaid when OFF_PLATFORM_BILLING feature is true', async () => {
    authorizeOwner()
    mockGetEffective.mockResolvedValue({
      tier: 'PRO',
      name: 'Pro',
      monthlyPrice: 49,
      maxSites: 5,
      isCustom: false,
      features: { OFF_PLATFORM_BILLING: true },
    } as any)
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as any)

    const res = await saveGeneral(baseInput)

    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.site.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'unpaid' }) })
    )
  })

  it('allows type:paid regardless of OFF_PLATFORM_BILLING feature', async () => {
    authorizeOwner()
    // Feature is false but type is 'paid' — should not call entitlement check logic
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as any)

    const res = await saveGeneral({ ...baseInput, type: 'paid', price: '20', vat: '21' })

    expect(res.status).toBe('ok')
    // getEffectiveSubscriptionForUser must NOT have been called for type:paid
    expect(mockGetEffective).not.toHaveBeenCalled()
  })

  it('allows editing an already-unpaid site without the entitlement', async () => {
    authorizeOwner()
    // Site is already unpaid → editing it must not require the entitlement
    // (only the transition paid→unpaid is gated). Guards against locking out a
    // downgraded partner from their own existing off-platform site.
    vi.mocked(prisma.site.findUnique).mockResolvedValueOnce({ type: 'unpaid' } as any)
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as any)

    const res = await saveGeneral(baseInput)

    expect(res.status).toBe('ok')
    expect(mockGetEffective).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.site.update)).toHaveBeenCalled()
  })
})

// ─── Off-platform billing entitlement (submitForm) ──────────────────────────

describe('submitForm — off-platform billing entitlement', () => {
  const mockGetEffective = vi.mocked(getEffectiveSubscriptionForUser)

  it('rejects type:unpaid when OFF_PLATFORM_BILLING feature is false', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    mockGetEffective.mockResolvedValue({
      tier: 'STARTER',
      name: 'Starter',
      monthlyPrice: 0,
      maxSites: 1,
      isCustom: false,
      features: { OFF_PLATFORM_BILLING: false },
    } as any)

    const formData = new FormData()
    formData.set('name', 'Beach Club')
    formData.set('locationLat', '40')
    formData.set('locationLng', '3')
    formData.set('type', 'unpaid')

    const res = await submitForm({ status: '' }, formData)

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Off-platform billing')
    expect(vi.mocked(prisma.site.create)).not.toHaveBeenCalled()
  })

  it('allows type:unpaid when OFF_PLATFORM_BILLING feature is true', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    mockGetEffective.mockResolvedValue({
      tier: 'PRO',
      name: 'Pro',
      monthlyPrice: 49,
      maxSites: 5,
      isCustom: false,
      features: { OFF_PLATFORM_BILLING: true },
    } as any)
    vi.mocked(prisma.site.create).mockResolvedValue({ id: 'new-site-id' } as any)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as any)

    const formData = new FormData()
    formData.set('name', 'Beach Club')
    formData.set('locationLat', '40')
    formData.set('locationLng', '3')
    formData.set('type', 'unpaid')

    const res = await submitForm({ status: '' }, formData)

    expect(res.status).toBe('ok')
  })
})
