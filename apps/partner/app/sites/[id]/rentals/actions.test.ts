/**
 * Behavioral unit tests for rentals/actions.ts
 *
 * Auth dimension (auth-matrix) is already covered by the 107-entry registry in
 * app/test/gated-actions.ts — these tests focus on validation, money, state
 * transitions, and the toggleSiteFeature allowlist. Integration-only concerns
 * (deleteRentalItem active-booking guard, getRentalItems booking count) live in
 * actions.integration.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import {
  createRentalItem,
  updateRentalItem,
  saveRentalVat,
  toggleSiteFeature,
  setRentalPaymentType,
  getRentalItems,
} from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

const mockAuth = vi.mocked(auth)

const OWNER_ID = 'owner-1'
const OTHER_ID = 'other-1'
const SITE_ID = 'site-1'
const ITEM_ID = 'item-1'

/**
 * Simulate a session where the calling user is the site owner.
 *
 * requireSiteOwner call sequence:
 *   1. auth()                    → session with OWNER_ID
 *   2. prisma.user.findUnique   → { sudo: false }  (not a sudo user)
 *   3. prisma.site.findUnique   → { userId: OWNER_ID } (ownership confirmed)
 *
 * Using mockResolvedValue (not Once) so actions that call site.findUnique a
 * second time (for their own data reads) also get a sensible default. For
 * tests where the second call needs different data, use mockResolvedValueOnce
 * sequences instead (see toggleSiteFeature tests).
 */
function authenticateAsOwner() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
  vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
}

beforeEach(() => {
  vi.clearAllMocks()
  // IMPORTANT: clearAllMocks clears call-history but NOT implementations —
  // reset auth to null explicitly so tests don't share session state.
  mockAuth.mockResolvedValue(null)
})

// ═══════════════════════════════════════════════════════════════════════════════
// createRentalItem
// ═══════════════════════════════════════════════════════════════════════════════

describe('createRentalItem validation', () => {
  beforeEach(() => {
    authenticateAsOwner()
  })

  it('rejects empty name', async () => {
    const res = await createRentalItem({
      siteId: SITE_ID, name: '', totalQuantity: 1, pricePerDay: 10,
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Name is required')
  })

  it('rejects whitespace-only name', async () => {
    const res = await createRentalItem({
      siteId: SITE_ID, name: '   ', totalQuantity: 1, pricePerDay: 10,
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Name is required')
  })

  it('rejects name longer than 200 chars', async () => {
    const res = await createRentalItem({
      siteId: SITE_ID, name: 'A'.repeat(201), totalQuantity: 1, pricePerDay: 10,
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Name is too long (max 200)')
  })

  it('accepts name of exactly 200 chars', async () => {
    vi.mocked(prisma.rentalItem.create).mockResolvedValue({ id: ITEM_ID } as any)
    const res = await createRentalItem({
      siteId: SITE_ID, name: 'A'.repeat(200), totalQuantity: 1, pricePerDay: 10,
    })
    expect(res.status).toBe('ok')
  })

  it('rejects description longer than 1000 chars', async () => {
    const res = await createRentalItem({
      siteId: SITE_ID, name: 'Kayak', description: 'X'.repeat(1001),
      totalQuantity: 1, pricePerDay: 10,
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Description is too long (max 1000)')
  })

  it('accepts description of exactly 1000 chars', async () => {
    vi.mocked(prisma.rentalItem.create).mockResolvedValue({ id: ITEM_ID } as any)
    const res = await createRentalItem({
      siteId: SITE_ID, name: 'Kayak', description: 'X'.repeat(1000),
      totalQuantity: 1, pricePerDay: 10,
    })
    expect(res.status).toBe('ok')
  })

  it('rejects quantity below 1', async () => {
    const res = await createRentalItem({
      siteId: SITE_ID, name: 'Kayak', totalQuantity: 0, pricePerDay: 10,
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Quantity must be 1–10,000')
  })

  it('rejects quantity above 10000', async () => {
    const res = await createRentalItem({
      siteId: SITE_ID, name: 'Kayak', totalQuantity: 10001, pricePerDay: 10,
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Quantity must be 1–10,000')
  })

  it('accepts quantity 1 (lower bound)', async () => {
    vi.mocked(prisma.rentalItem.create).mockResolvedValue({ id: ITEM_ID } as any)
    const res = await createRentalItem({
      siteId: SITE_ID, name: 'Kayak', totalQuantity: 1, pricePerDay: 10,
    })
    expect(res.status).toBe('ok')
  })

  it('accepts quantity 10000 (upper bound)', async () => {
    vi.mocked(prisma.rentalItem.create).mockResolvedValue({ id: ITEM_ID } as any)
    const res = await createRentalItem({
      siteId: SITE_ID, name: 'Kayak', totalQuantity: 10000, pricePerDay: 10,
    })
    expect(res.status).toBe('ok')
  })

  it('rejects when neither pricePerHour nor pricePerDay is provided', async () => {
    const res = await createRentalItem({
      siteId: SITE_ID, name: 'Kayak', totalQuantity: 1,
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('At least one price is required')
  })

  it('accepts when only pricePerHour is provided', async () => {
    vi.mocked(prisma.rentalItem.create).mockResolvedValue({ id: ITEM_ID } as any)
    const res = await createRentalItem({
      siteId: SITE_ID, name: 'Kayak', totalQuantity: 5, pricePerHour: 12.5,
    })
    expect(res.status).toBe('ok')
  })

  it('accepts when only pricePerDay is provided', async () => {
    vi.mocked(prisma.rentalItem.create).mockResolvedValue({ id: ITEM_ID } as any)
    const res = await createRentalItem({
      siteId: SITE_ID, name: 'Kayak', totalQuantity: 5, pricePerDay: 50,
    })
    expect(res.status).toBe('ok')
  })

  it('accepts when both pricePerHour and pricePerDay are provided', async () => {
    vi.mocked(prisma.rentalItem.create).mockResolvedValue({ id: ITEM_ID } as any)
    const res = await createRentalItem({
      siteId: SITE_ID, name: 'Kayak', totalQuantity: 5, pricePerHour: 12, pricePerDay: 50,
    })
    expect(res.status).toBe('ok')
  })

  it('rejects negative hourly price', async () => {
    const res = await createRentalItem({
      siteId: SITE_ID, name: 'Kayak', totalQuantity: 1, pricePerHour: -1,
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Hourly price must be 0–100,000')
  })

  it('rejects daily price above 100000', async () => {
    const res = await createRentalItem({
      siteId: SITE_ID, name: 'Kayak', totalQuantity: 1, pricePerDay: 100001,
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Daily price must be 0–100,000')
  })

  it('collects all validation errors in one response', async () => {
    const res = await createRentalItem({
      siteId: SITE_ID, name: '', totalQuantity: 0,
      // no price provided either
    })
    expect(res.status).toBe('error')
    // At minimum: name required + quantity + no price
    expect(res.errors!.length).toBeGreaterThanOrEqual(3)
  })
})

describe('createRentalItem happy path', () => {
  it('creates item and returns it', async () => {
    authenticateAsOwner()
    const created = {
      id: ITEM_ID, siteId: SITE_ID, name: 'Kayak', totalQuantity: 5,
      pricePerDay: 50, pricePerHour: null, active: true,
    }
    vi.mocked(prisma.rentalItem.create).mockResolvedValue(created as any)

    const res = await createRentalItem({
      siteId: SITE_ID, name: '  Kayak  ', totalQuantity: 5, pricePerDay: 50,
    })
    expect(res.status).toBe('ok')
    expect((res as any).item).toEqual(created)

    // Name must be trimmed before being sent to the DB
    const createCall = vi.mocked(prisma.rentalItem.create).mock.calls[0][0]
    expect(createCall.data.name).toBe('Kayak')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// updateRentalItem
// ═══════════════════════════════════════════════════════════════════════════════

describe('updateRentalItem validation', () => {
  beforeEach(() => {
    authenticateAsOwner()
  })

  it('rejects empty name', async () => {
    const res = await updateRentalItem({
      id: ITEM_ID, siteId: SITE_ID, name: '', totalQuantity: 1, pricePerDay: 10, active: true,
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Name is required')
  })

  it('rejects quantity above 10000', async () => {
    const res = await updateRentalItem({
      id: ITEM_ID, siteId: SITE_ID, name: 'Kayak', totalQuantity: 10001, pricePerDay: 10, active: true,
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Quantity must be 1–10,000')
  })

  it('rejects when no price is provided', async () => {
    const res = await updateRentalItem({
      id: ITEM_ID, siteId: SITE_ID, name: 'Kayak', totalQuantity: 1, active: true,
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('At least one price is required')
  })
})

describe('updateRentalItem cross-site check', () => {
  it('rejects when item belongs to a different site', async () => {
    authenticateAsOwner()
    // Validation passes, but the item's siteId does not match the requested siteId
    vi.mocked(prisma.rentalItem.findUnique).mockResolvedValue({ siteId: 'other-site' } as any)

    const res = await updateRentalItem({
      id: ITEM_ID, siteId: SITE_ID, name: 'Kayak', totalQuantity: 1, pricePerDay: 10, active: true,
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Item not found')
  })

  it('rejects when item does not exist (findUnique returns null)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalItem.findUnique).mockResolvedValue(null)

    const res = await updateRentalItem({
      id: ITEM_ID, siteId: SITE_ID, name: 'Kayak', totalQuantity: 1, pricePerDay: 10, active: true,
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Item not found')
  })
})

describe('updateRentalItem happy path', () => {
  it('updates item when it belongs to this site', async () => {
    authenticateAsOwner()
    const updated = {
      id: ITEM_ID, siteId: SITE_ID, name: 'Kayak', totalQuantity: 3,
      pricePerDay: 60, active: false,
    }
    vi.mocked(prisma.rentalItem.findUnique).mockResolvedValue({ siteId: SITE_ID } as any)
    vi.mocked(prisma.rentalItem.update).mockResolvedValue(updated as any)

    const res = await updateRentalItem({
      id: ITEM_ID, siteId: SITE_ID, name: '  Kayak  ', totalQuantity: 3, pricePerDay: 60, active: false,
    })
    expect(res.status).toBe('ok')
    expect((res as any).item).toEqual(updated)

    // Name trimmed before DB write
    const updateCall = vi.mocked(prisma.rentalItem.update).mock.calls[0][0]
    expect(updateCall.data.name).toBe('Kayak')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// saveRentalVat
// ═══════════════════════════════════════════════════════════════════════════════

describe('saveRentalVat value handling', () => {
  beforeEach(() => {
    authenticateAsOwner()
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)
  })

  it('stores the numeric VAT value for a positive rate', async () => {
    const res = await saveRentalVat(SITE_ID, '25.5')
    expect(res.status).toBe('ok')
    const updateCall = vi.mocked(prisma.site.update).mock.calls[0][0]
    expect(updateCall.data.rentalVat).toBe(25.5)
  })

  it('stores null when VAT is 0 (zero becomes null, not 0)', async () => {
    const res = await saveRentalVat(SITE_ID, '0')
    expect(res.status).toBe('ok')
    const updateCall = vi.mocked(prisma.site.update).mock.calls[0][0]
    // Zero VAT must be stored as null (no VAT applicable) — not as 0
    expect(updateCall.data.rentalVat).toBeNull()
  })

  it('rejects negative VAT', async () => {
    const res = await saveRentalVat(SITE_ID, '-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('VAT must be 0–100')
  })

  it('rejects VAT above 100', async () => {
    const res = await saveRentalVat(SITE_ID, '101')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('VAT must be 0–100')
  })

  it('accepts VAT at 100 (upper bound)', async () => {
    const res = await saveRentalVat(SITE_ID, '100')
    expect(res.status).toBe('ok')
    const updateCall = vi.mocked(prisma.site.update).mock.calls[0][0]
    expect(updateCall.data.rentalVat).toBe(100)
  })

  it('rejects non-numeric VAT string', async () => {
    const res = await saveRentalVat(SITE_ID, 'abc')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('VAT must be 0–100')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// toggleSiteFeature
// ═══════════════════════════════════════════════════════════════════════════════

describe('toggleSiteFeature allowlist', () => {
  beforeEach(() => {
    authenticateAsOwner()
  })

  it("rejects feature not in the allowlist ('analytics')", async () => {
    const res = await toggleSiteFeature(SITE_ID, 'analytics', true)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid feature')
  })

  it("rejects feature not in the allowlist ('payments')", async () => {
    const res = await toggleSiteFeature(SITE_ID, 'payments', true)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid feature')
  })

  it("rejects empty string as feature", async () => {
    const res = await toggleSiteFeature(SITE_ID, '', true)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid feature')
  })
})

describe('toggleSiteFeature enable/disable', () => {
  /**
   * requireSiteOwner calls prisma.site.findUnique (call #1) to check ownership.
   * toggleSiteFeature then calls prisma.site.findUnique again (call #2) to fetch
   * the current features array. We use mockResolvedValueOnce to sequence these.
   *
   * Call sequence per test:
   *   1. prisma.user.findUnique  (sudo check inside requireSiteOwner — returns non-sudo)
   *   2. prisma.site.findUnique  (ownership check — returns { userId: OWNER_ID })
   *   3. prisma.site.findUnique  (feature fetch inside toggleSiteFeature)
   */

  function setupOwnerThenFeatures(features: string[]) {
    // auth session
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    // user.findUnique (sudo check) — not sudo
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ sudo: false } as any)
    // site.findUnique call #1: ownership check
    vi.mocked(prisma.site.findUnique).mockResolvedValueOnce({ userId: OWNER_ID } as any)
    // site.findUnique call #2: feature fetch
    vi.mocked(prisma.site.findUnique).mockResolvedValueOnce({ features } as any)
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)
  }

  it("adds 'rentals' to an empty features array", async () => {
    setupOwnerThenFeatures([])

    const res = await toggleSiteFeature(SITE_ID, 'rentals', true)
    expect(res.status).toBe('ok')
    const updateCall = vi.mocked(prisma.site.update).mock.calls[0][0]
    expect(updateCall.data.features).toContain('rentals')
  })

  it("is idempotent: enabling 'rentals' when already enabled does not duplicate it", async () => {
    setupOwnerThenFeatures(['rentals'])

    const res = await toggleSiteFeature(SITE_ID, 'rentals', true)
    expect(res.status).toBe('ok')
    const updateCall = vi.mocked(prisma.site.update).mock.calls[0][0]
    // 'rentals' must appear exactly once
    expect(updateCall.data.features.filter((f: string) => f === 'rentals')).toHaveLength(1)
  })

  it("removes 'rentals' when disabling", async () => {
    setupOwnerThenFeatures(['rentals'])

    const res = await toggleSiteFeature(SITE_ID, 'rentals', false)
    expect(res.status).toBe('ok')
    const updateCall = vi.mocked(prisma.site.update).mock.calls[0][0]
    expect(updateCall.data.features).not.toContain('rentals')
  })

  it("disabling a feature not currently set is a no-op (no error, empty array)", async () => {
    setupOwnerThenFeatures([])

    const res = await toggleSiteFeature(SITE_ID, 'rentals', false)
    expect(res.status).toBe('ok')
    const updateCall = vi.mocked(prisma.site.update).mock.calls[0][0]
    expect(updateCall.data.features).not.toContain('rentals')
  })

  it('preserves existing features other than the toggled one', async () => {
    // Simulate a site that currently has some future/other feature alongside rentals
    setupOwnerThenFeatures(['rentals', 'premium'])

    const res = await toggleSiteFeature(SITE_ID, 'rentals', false)
    expect(res.status).toBe('ok')
    const updateCall = vi.mocked(prisma.site.update).mock.calls[0][0]
    // rentals removed, premium preserved
    expect(updateCall.data.features).not.toContain('rentals')
    expect(updateCall.data.features).toContain('premium')
  })

  it('returns the updated features array in the response', async () => {
    setupOwnerThenFeatures([])

    const res = await toggleSiteFeature(SITE_ID, 'rentals', true)
    expect(res.status).toBe('ok')
    expect((res as any).features).toContain('rentals')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// setRentalPaymentType
// ═══════════════════════════════════════════════════════════════════════════════

describe('setRentalPaymentType validation', () => {
  it("accepts 'paid'", async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)

    const res = await setRentalPaymentType(SITE_ID, 'paid')
    expect(res.status).toBe('ok')
  })

  it("accepts 'unpaid'", async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)

    const res = await setRentalPaymentType(SITE_ID, 'unpaid')
    expect(res.status).toBe('ok')
  })

  it('rejects an arbitrary string', async () => {
    authenticateAsOwner()

    const res = await setRentalPaymentType(SITE_ID, 'stripe')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid rental payment type')
  })

  it("rejects 'free' (not in the enum)", async () => {
    authenticateAsOwner()

    const res = await setRentalPaymentType(SITE_ID, 'free')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid rental payment type')
  })

  it('rejects empty string', async () => {
    authenticateAsOwner()

    const res = await setRentalPaymentType(SITE_ID, '')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid rental payment type')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// getRentalItems
// ═══════════════════════════════════════════════════════════════════════════════

describe('getRentalItems', () => {
  it('returns items for the site ordered by createdAt with booking counts', async () => {
    authenticateAsOwner()
    const fakeItems = [
      { id: 'ri-1', name: 'Kayak', _count: { bookings: 3 } },
      { id: 'ri-2', name: 'Paddleboard', _count: { bookings: 0 } },
    ]
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue(fakeItems as any)

    const res = await getRentalItems(SITE_ID)
    expect(res.status).toBe('ok')
    expect((res as any).items).toEqual(fakeItems)

    // Must filter by siteId and request the bookings count
    const findManyCall = vi.mocked(prisma.rentalItem.findMany).mock.calls[0][0]
    expect(findManyCall?.where).toEqual({ siteId: SITE_ID })
    expect(findManyCall?.include?._count?.select?.bookings).toBe(true)
    expect(findManyCall?.orderBy).toEqual({ createdAt: 'asc' })
  })

  it('returns empty array when no rental items exist for the site', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([])

    const res = await getRentalItems(SITE_ID)
    expect(res.status).toBe('ok')
    expect((res as any).items).toEqual([])
  })
})
