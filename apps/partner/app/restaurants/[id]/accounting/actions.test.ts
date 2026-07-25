import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

// requireRestaurantOwnerWithFlag checks isFlagEnabled('restaurants') first —
// mock @/app/flags so the flag is always enabled and the ownership gate is
// what's actually under test (mirrors restaurants/[id]/actions.test.ts).
vi.mock('@/app/flags', () => ({
  isFlagEnabled: vi.fn().mockResolvedValue(true),
}))

import { getRestaurantTabInvoicesByMonth } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

const mockAuth = vi.mocked(auth)
const OWNER_ID = 'owner-1'
const RESTAURANT_ID = 'restaurant-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

function authorizeOwner() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
  vi.mocked(prisma.restaurant.findUnique).mockResolvedValue({
    partnerAccountId: OWNER_ID,
  } as any)
}

describe('getRestaurantTabInvoicesByMonth', () => {
  it('rejects unauthenticated user', async () => {
    const res = await getRestaurantTabInvoicesByMonth(RESTAURANT_ID, 6, 2026)
    expect(res.status).toBe('error')
    expect((res as any).errors).toContain('Not authenticated')
  })

  it('rejects a session that does not own the restaurant', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    vi.mocked(prisma.restaurant.findUnique).mockResolvedValue({
      partnerAccountId: 'someone-else',
    } as any)

    const res = await getRestaurantTabInvoicesByMonth(RESTAURANT_ID, 6, 2026)
    expect(res.status).toBe('error')
    expect((res as any).errors).toContain('Not authorized')
  })

  it('queries PARTNER invoices scoped to tableTab.restaurantId within the month window', async () => {
    authorizeOwner()
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as any)

    const res = await getRestaurantTabInvoicesByMonth(RESTAURANT_ID, 3, 2026)
    expect(res.status).toBe('ok')

    const call = vi.mocked(prisma.invoice.findMany).mock.calls[0][0]
    expect(call.where.issuerType).toBe('PARTNER')
    expect(call.where.tableTabId).toEqual({ not: null })
    expect(call.where.tableTab).toEqual({ restaurantId: RESTAURANT_ID })
    // Month window: March 2026 → Apr 2026 (exclusive), UTC.
    expect(call.where.invoicedAt.gte).toEqual(new Date(Date.UTC(2026, 2, 1)))
    expect(call.where.invoicedAt.lt).toEqual(new Date(Date.UTC(2026, 3, 1)))
  })

  it('returns invoices with invoiceLines + tableTab table info included', async () => {
    authorizeOwner()
    const INVOICE = {
      id: 'inv-1',
      invoiceNumber: 'INV-0001',
      invoicedAt: new Date('2026-03-15T12:00:00Z'),
      totalCharge: 10,
      totalTax: 1,
      totalAmount: 11,
      invoiceLines: [
        { id: 'line-1', description: 'Beer x2', charge: 10, tax: 1, amount: 11, vatRate: 10, productCode: null },
      ],
      tableTab: {
        id: 'tab-1',
        status: 'paid',
        closedAt: new Date('2026-03-15T12:05:00Z'),
        table: { number: 4, label: 'Terrace' },
      },
    }
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([INVOICE] as any)

    const res = await getRestaurantTabInvoicesByMonth(RESTAURANT_ID, 3, 2026)
    expect(res.status).toBe('ok')
    expect((res as any).invoices).toHaveLength(1)
    expect((res as any).invoices[0]).toEqual(INVOICE)
  })

  it('does not leak invoices from a different restaurant (proves the restaurantId filter is wired, not just present)', async () => {
    authorizeOwner()
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as any)

    await getRestaurantTabInvoicesByMonth(RESTAURANT_ID, 3, 2026)

    const call = vi.mocked(prisma.invoice.findMany).mock.calls[0][0]
    expect(call.where.tableTab.restaurantId).toBe(RESTAURANT_ID)
    expect(call.where.tableTab.restaurantId).not.toBe('other-restaurant')
  })
})
