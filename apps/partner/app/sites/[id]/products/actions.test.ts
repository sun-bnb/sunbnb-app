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
  addProduct,
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

// ─── addProduct ─────────────────────────────────────────────────────────────

describe('addProduct', () => {
  function makeFormData(fields: Record<string, string | File | null>): FormData {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) {
      if (v !== null) fd.append(k, v as any)
    }
    return fd
  }

  function validFormData(overrides: Record<string, string> = {}): FormData {
    return makeFormData({
      siteId: SITE_ID,
      name: 'Fresh Lemonade',
      description: 'Cold and refreshing',
      totalPrice: '5.00',
      tax: '14',
      category: 'drink',
      prepTime: '5',
      ...overrides,
    })
  }

  // ── Auth ──

  it('rejects unauthenticated user', async () => {
    // mockAuth returns null (beforeEach default)
    const res = await addProduct(validFormData())
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('rejects non-owner (requireSiteOwner returns error)', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    mockRequireSiteOwner.mockResolvedValue({ session: null, error: 'Not authorized' })
    const res = await addProduct(validFormData())
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  // ── Validation ──

  it('rejects missing name', async () => {
    authorizeOwner()
    const res = await addProduct(validFormData({ name: '' }))
    expect(res.status).toBe('error')
    expect(res.errors![0]).toContain('name')
  })

  it('rejects name over 200 characters', async () => {
    authorizeOwner()
    const res = await addProduct(validFormData({ name: 'x'.repeat(201) }))
    expect(res.status).toBe('error')
    expect(res.errors![0]).toContain('200')
  })

  it('rejects description over 1000 characters', async () => {
    authorizeOwner()
    const res = await addProduct(validFormData({ description: 'd'.repeat(1001) }))
    expect(res.status).toBe('error')
    expect(res.errors![0]).toContain('1000')
  })

  it('rejects zero price', async () => {
    authorizeOwner()
    const res = await addProduct(validFormData({ totalPrice: '0' }))
    expect(res.status).toBe('error')
    expect(res.errors![0]).toContain('Price')
  })

  it('rejects negative price', async () => {
    authorizeOwner()
    const res = await addProduct(validFormData({ totalPrice: '-1' }))
    expect(res.status).toBe('error')
    expect(res.errors![0]).toContain('Price')
  })

  it('rejects price above 100000', async () => {
    authorizeOwner()
    const res = await addProduct(validFormData({ totalPrice: '100001' }))
    expect(res.status).toBe('error')
    expect(res.errors![0]).toContain('Price')
  })

  it('rejects tax above 100', async () => {
    authorizeOwner()
    const res = await addProduct(validFormData({ tax: '101' }))
    expect(res.status).toBe('error')
    expect(res.errors![0]).toContain('Tax')
  })

  it('rejects negative tax', async () => {
    authorizeOwner()
    const res = await addProduct(validFormData({ tax: '-1' }))
    expect(res.status).toBe('error')
    expect(res.errors![0]).toContain('Tax')
  })

  it('rejects invalid product category', async () => {
    authorizeOwner()
    const res = await addProduct(validFormData({ category: 'cigarettes' }))
    expect(res.status).toBe('error')
    expect(res.errors![0]).toContain('category')
  })

  // ── VAT computation — the stored `price` must be the ex-VAT base ──

  it('computes correct ex-VAT base price using computeVatAndBaseAmounts (round real numbers)', async () => {
    authorizeOwner()
    vi.mocked(prisma.product.create).mockResolvedValue({} as any)

    // totalPrice=10.99, tax=14% → baseAmount = round(10.99 / 1.14) = round(9.6403...) = 9.64
    const res = await addProduct(validFormData({ totalPrice: '10.99', tax: '14' }))
    expect(res.status).toBe('ok')

    const createCall = vi.mocked(prisma.product.create).mock.calls[0][0]
    expect(createCall.data.price).toBe(9.64)
    expect(createCall.data.totalPrice).toBe(10.99)
    expect(createCall.data.tax).toBe(14)
  })

  it('computes correct ex-VAT base price with round(12 / 1.20) = 10', async () => {
    authorizeOwner()
    vi.mocked(prisma.product.create).mockResolvedValue({} as any)

    const res = await addProduct(validFormData({ totalPrice: '12', tax: '20' }))
    expect(res.status).toBe('ok')

    const createCall = vi.mocked(prisma.product.create).mock.calls[0][0]
    expect(createCall.data.price).toBe(10)
  })

  it('stores 0-tax correctly: price equals totalPrice when tax is 0', async () => {
    authorizeOwner()
    vi.mocked(prisma.product.create).mockResolvedValue({} as any)

    const res = await addProduct(validFormData({ totalPrice: '8.50', tax: '0' }))
    expect(res.status).toBe('ok')

    const createCall = vi.mocked(prisma.product.create).mock.calls[0][0]
    expect(createCall.data.price).toBe(8.50)
    expect(createCall.data.totalPrice).toBe(8.50)
  })

  // ── Happy path (no image) ──

  it('creates product and returns ok', async () => {
    authorizeOwner()
    vi.mocked(prisma.product.create).mockResolvedValue({} as any)

    const res = await addProduct(validFormData())
    expect(res.status).toBe('ok')

    const createCall = vi.mocked(prisma.product.create).mock.calls[0][0]
    expect(createCall.data.siteId).toBe(SITE_ID)
    expect(createCall.data.name).toBe('Fresh Lemonade')
    expect(createCall.data.category).toBe('drink')
    expect(createCall.data.prepTime).toBe(5)
  })

  it('defaults category to food when not provided', async () => {
    authorizeOwner()
    vi.mocked(prisma.product.create).mockResolvedValue({} as any)

    // Omit category from FormData — addProduct defaults to 'food'
    const fd = makeFormData({
      siteId: SITE_ID,
      name: 'Sandwich',
      totalPrice: '6.00',
      tax: '14',
    })
    const res = await addProduct(fd)
    expect(res.status).toBe('ok')

    const createCall = vi.mocked(prisma.product.create).mock.calls[0][0]
    expect(createCall.data.category).toBe('food')
  })
})
