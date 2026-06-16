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

vi.mock('@vercel/blob', () => ({
  put: vi.fn().mockResolvedValue({ url: 'https://blob.test/image.jpg' }),
}))

vi.mock('sharp', () => ({
  default: vi.fn().mockReturnValue({
    metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
  }),
}))

import {
  toggleAppSales,
  setOrderPaymentType,
  updateProduct,
  deleteProduct,
  toggleProductSoldOut,
  getProducts,
} from './actions'
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

// ─── toggleAppSales ─────────────────────────────────────────────────────────

describe('toggleAppSales', () => {
  it('rejects unauthenticated', async () => {
    const res = await toggleAppSales(SITE_ID, true)
    expect(res.status).toBe('error')
  })

  it('enables app sales', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)
    const res = await toggleAppSales(SITE_ID, true)
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.site.update).mock.calls[0][0].data.appSalesEnabled).toBe(true)
  })
})

// ─── setOrderPaymentType ────────────────────────────────────────────────────

describe('setOrderPaymentType', () => {
  it('rejects invalid payment type', async () => {
    authorizeOwner()
    const res = await setOrderPaymentType(SITE_ID, 'bitcoin')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid order payment type')
  })

  it('accepts valid payment type', async () => {
    authorizeOwner()
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)
    const res = await setOrderPaymentType(SITE_ID, 'paid')
    expect(res.status).toBe('ok')
  })
})

// ─── updateProduct ──────────────────────────────────────────────────────────

describe('updateProduct', () => {
  it('rejects non-owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'other' } } as any)
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      site: { userId: OWNER_ID },
    } as any)

    const res = await updateProduct('prod-1', { name: 'New name' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('recalculates base price from totalPrice and tax', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      site: { userId: OWNER_ID },
    } as any)
    vi.mocked(prisma.product.update).mockResolvedValue({} as any)

    // totalPrice = 12, tax = 20% → price = 12 / 1.20 = 10
    await updateProduct('prod-1', { totalPrice: 12, tax: 20 })

    const updateCall = vi.mocked(prisma.product.update).mock.calls[0][0]
    expect(updateCall.data.price).toBe(10)
    expect(updateCall.data.totalPrice).toBe(12)
    expect(updateCall.data.tax).toBe(20)
  })

  it('recalculates price when only totalPrice changes (existing tax)', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.product.findUnique)
      .mockResolvedValueOnce({ siteId: SITE_ID, site: { userId: OWNER_ID } } as any) // ownership check
      .mockResolvedValueOnce({ tax: 10, totalPrice: 11 } as any) // existing product
    vi.mocked(prisma.product.update).mockResolvedValue({} as any)

    // totalPrice = 22, existing tax = 10% → price = round(22 / 1.10) = 20
    await updateProduct('prod-1', { totalPrice: 22 })

    const updateCall = vi.mocked(prisma.product.update).mock.calls[0][0]
    expect(updateCall.data.price).toBe(20)
  })

  it('recalculates price when only tax changes (existing totalPrice)', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.product.findUnique)
      .mockResolvedValueOnce({ siteId: SITE_ID, site: { userId: OWNER_ID } } as any) // ownership check
      .mockResolvedValueOnce({ tax: 10, totalPrice: 24 } as any) // existing product — totalPrice=24, tax was 10%
    vi.mocked(prisma.product.update).mockResolvedValue({} as any)

    // tax changes to 20%, existing totalPrice = 24 → price = round(24 / 1.20) = 20
    await updateProduct('prod-1', { tax: 20 })

    const updateCall = vi.mocked(prisma.product.update).mock.calls[0][0]
    // price must be the canonical round() result, not a .toFixed string
    expect(updateCall.data.price).toBe(20)
    expect(updateCall.data.tax).toBe(20)
    // totalPrice is unchanged (only tax was provided)
    expect(updateCall.data.totalPrice).toBeUndefined()
  })
})

// ─── deleteProduct ──────────────────────────────────────────────────────────

describe('deleteProduct', () => {
  it('rejects non-owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'other' } } as any)
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      site: { userId: OWNER_ID },
    } as any)

    const res = await deleteProduct('prod-1')
    expect(res.status).toBe('error')
  })

  it('soft-deletes by setting active=false', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      site: { userId: OWNER_ID },
    } as any)
    vi.mocked(prisma.product.update).mockResolvedValue({} as any)

    const res = await deleteProduct('prod-1')
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.product.update).mock.calls[0][0]
    expect(updateCall.data.active).toBe(false)
  })
})

// ─── toggleProductSoldOut ───────────────────────────────────────────────────

describe('toggleProductSoldOut', () => {
  it('rejects non-owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'other' } } as any)
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      site: { userId: OWNER_ID },
    } as any)

    const res = await toggleProductSoldOut('prod-1', true)
    expect(res.status).toBe('error')
  })

  it('marks product as sold out', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      site: { userId: OWNER_ID },
    } as any)
    vi.mocked(prisma.product.update).mockResolvedValue({} as any)

    const res = await toggleProductSoldOut('prod-1', true)
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.product.update).mock.calls[0][0].data.soldOut).toBe(true)
  })
})

// ─── getProducts ────────────────────────────────────────────────────────────

describe('getProducts', () => {
  it('returns empty array for non-owner', async () => {
    const res = await getProducts(SITE_ID)
    expect(res).toEqual([])
  })

  it('returns active products', async () => {
    authorizeOwner()
    vi.mocked(prisma.product.findMany).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }] as any)

    const res = await getProducts(SITE_ID)
    expect(res).toHaveLength(2)

    const findCall = vi.mocked(prisma.product.findMany).mock.calls[0][0]
    expect(findCall.where.active).toBe(true)
  })
})
