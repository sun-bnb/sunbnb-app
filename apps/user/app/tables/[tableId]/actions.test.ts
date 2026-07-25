import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn() }))
vi.mock('@/app/flags', () => ({ isFlagEnabled: vi.fn().mockResolvedValue(true) }))
vi.mock('@/app/api/_lib/payment-ids', () => ({
  isValidEntityId: vi.fn().mockReturnValue(true),
}))

import prisma from '@repo/data/PrismaCient'
import { calculateTabTotal } from '@repo/data/payment'
import { auth } from '@/app/auth'
import { isFlagEnabled } from '@/app/flags'
import { isValidEntityId } from '@/app/api/_lib/payment-ids'
import { placeTabOrder, getTabState, getDineContext } from './actions'

const mockAuth = vi.mocked(auth)
const mockIsFlagEnabled = vi.mocked(isFlagEnabled)
const mockIsValidEntityId = vi.mocked(isValidEntityId)
const mockCalculateTabTotal = vi.mocked(calculateTabTotal)

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const SITE_ID = 'site-1'
const TABLE_ID = 'table-1'
const RESTAURANT_ID = 'rest-1'
const PARTNER_ACCOUNT_USER_ID = 'owner-1'
const PRODUCT_ID = 'prod-1'
const ANON_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const TAB_ID = 'tab-1'
const ORDER_ID = 'order-1'

function mockTable(overrides: Record<string, unknown> = {}) {
  vi.mocked(prisma.table.findUnique).mockResolvedValueOnce({
    id: TABLE_ID,
    number: 5,
    label: 'T5',
    status: 'active',
    restaurant: {
      id: RESTAURANT_ID,
      name: 'Chiringuito',
      siteId: SITE_ID,
      dineInEnabled: true,
      partnerAccountId: PARTNER_ACCOUNT_USER_ID,
    },
    ...overrides,
  } as any)
}

function mockMenuItem(overrides: Record<string, unknown> = {}) {
  vi.mocked(prisma.menuItem.findMany).mockResolvedValueOnce([
    {
      id: PRODUCT_ID,
      name: 'Water',
      price: 2.0,
      totalPrice: 2.4,
      tax: 14,
      category: 'drink',
      soldOut: false,
      active: true,
      imageUrl: null,
      displayOrder: 0,
      ...overrides,
    },
  ] as any)
}

function mockTabNotFound() {
  vi.mocked(prisma.tableTab.findFirst).mockResolvedValueOnce(null)
}

function mockTabCreate(overrides: Record<string, unknown> = {}) {
  vi.mocked(prisma.tableTab.create).mockResolvedValueOnce({
    id: TAB_ID,
    ...overrides,
  } as any)
}

function mockOrderCreate(overrides: Record<string, unknown> = {}) {
  vi.mocked(prisma.order.create).mockResolvedValueOnce({
    id: ORDER_ID,
    ...overrides,
  } as any)
}

function validItems() {
  return [{ product: { id: PRODUCT_ID }, quantity: 2 }]
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    tableId: TABLE_ID,
    anonId: ANON_ID,
    items: validItems(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null as any)
  mockIsValidEntityId.mockReturnValue(true)
  mockIsFlagEnabled.mockResolvedValue(true)
  mockCalculateTabTotal.mockResolvedValue({
    ordersTotal: 4.8,
    serviceFee: 0,
    payableTotal: 4.8,
    orderIds: [ORDER_ID],
  })
})

// ─── placeTabOrder ────────────────────────────────────────────────────────────

describe('placeTabOrder — feature flag', () => {
  it('returns feature_disabled when restaurants flag is off', async () => {
    mockIsFlagEnabled.mockResolvedValueOnce(false)

    const res = await placeTabOrder(validInput())

    expect(res.status).toBe('error')
    expect((res as any).errors).toContain('feature_disabled')
    expect(prisma.table.findUnique).not.toHaveBeenCalled()
  })
})

describe('placeTabOrder — validation', () => {
  it('rejects missing tableId', async () => {
    const res = await placeTabOrder(validInput({ tableId: '' }))
    expect(res.status).toBe('error')
    expect((res as any).errors).toContain('tableId is required')
  })

  it('rejects empty items', async () => {
    const res = await placeTabOrder(validInput({ items: [] }))
    expect(res.status).toBe('error')
    expect((res as any).errors).toContain('At least one item is required')
  })

  it('rejects more than 50 distinct items', async () => {
    const items = Array.from({ length: 51 }, (_, i) => ({
      product: { id: `prod-${i}` },
      quantity: 1,
    }))
    const res = await placeTabOrder(validInput({ items }))
    expect(res.status).toBe('error')
    expect((res as any).errors).toContain('Too many distinct items')
  })

  it('rejects total quantity > 200', async () => {
    const items = [{ product: { id: PRODUCT_ID }, quantity: 201 }]
    const res = await placeTabOrder(validInput({ items }))
    expect(res.status).toBe('error')
    expect((res as any).errors).toContain('Total quantity exceeds limit')
  })

  it('rejects non-integer item quantity', async () => {
    const items = [{ product: { id: PRODUCT_ID }, quantity: 1.5 }]
    const res = await placeTabOrder(validInput({ items }))
    expect(res.status).toBe('error')
    expect((res as any).errors).toContain('Invalid item quantity')
  })

  it('rejects zero quantity', async () => {
    const items = [{ product: { id: PRODUCT_ID }, quantity: 0 }]
    const res = await placeTabOrder(validInput({ items }))
    expect(res.status).toBe('error')
    expect((res as any).errors).toContain('Invalid item quantity')
  })

  it('rejects invalid tableId via isValidEntityId', async () => {
    mockIsValidEntityId.mockReturnValueOnce(false) // tableId check
    const res = await placeTabOrder(validInput())
    expect(res.status).toBe('error')
    expect((res as any).errors).toContain('Invalid table ID')
  })

  it('rejects invalid product id via isValidEntityId', async () => {
    mockIsValidEntityId
      .mockReturnValueOnce(true) // tableId
      .mockReturnValueOnce(false) // product id
    const res = await placeTabOrder(validInput())
    expect(res.status).toBe('error')
    expect((res as any).errors).toContain('Invalid product ID')
  })
})

describe('placeTabOrder — identity', () => {
  it('returns auth error when no session and no anonId', async () => {
    mockTable()

    const res = await placeTabOrder(validInput({ anonId: undefined }))

    expect(res.status).toBe('error')
    expect((res as any).errors).toContain('Authentication required')
  })

  it('accepts anonId in place of session', async () => {
    mockTable()
    mockMenuItem()
    mockTabNotFound()
    mockTabCreate()
    mockOrderCreate()

    const res = await placeTabOrder(validInput())

    expect(res.status).toBe('ok')
  })

  it('accepts session user when present', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockTable()
    mockMenuItem()
    mockTabNotFound()
    mockTabCreate()
    mockOrderCreate()

    const res = await placeTabOrder(validInput({ anonId: undefined }))

    expect(res.status).toBe('ok')
  })

  it('anonymous order userId falls back to restaurant.partnerAccountId', async () => {
    mockTable()
    mockMenuItem()
    mockTabNotFound()
    mockTabCreate()
    mockOrderCreate()

    await placeTabOrder(validInput())

    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user: { connect: { id: PARTNER_ACCOUNT_USER_ID } },
        }),
      }),
    )
  })
})

describe('placeTabOrder — table gate', () => {
  it('returns error when table is not found', async () => {
    vi.mocked(prisma.table.findUnique).mockResolvedValueOnce(null)

    const res = await placeTabOrder(validInput())

    expect(res.status).toBe('error')
    expect((res as any).errors).toContain('Table not found or unavailable')
  })

  it('returns error when table status is not active', async () => {
    mockTable({ status: 'inactive' })

    const res = await placeTabOrder(validInput())

    expect(res.status).toBe('error')
    expect((res as any).errors).toContain('Table not found or unavailable')
  })

  it('returns error when table has no restaurant', async () => {
    mockTable({ restaurant: null })

    const res = await placeTabOrder(validInput())

    expect(res.status).toBe('error')
    expect((res as any).errors).toContain('Table not found or unavailable')
  })

  it('returns error when restaurant.dineInEnabled is false', async () => {
    mockTable({
      restaurant: {
        id: RESTAURANT_ID,
        siteId: SITE_ID,
        dineInEnabled: false,
        partnerAccountId: PARTNER_ACCOUNT_USER_ID,
      },
    })

    const res = await placeTabOrder(validInput())

    expect(res.status).toBe('error')
    expect((res as any).errors[0]).toContain('not available')
  })
})

describe('placeTabOrder — products', () => {
  it('rejects when menu item is not found (not in restaurant / not active)', async () => {
    mockTable()
    // DB returns empty — menu item not active or wrong restaurant
    vi.mocked(prisma.menuItem.findMany).mockResolvedValueOnce([])

    const res = await placeTabOrder(validInput())

    expect(res.status).toBe('error')
    expect((res as any).errors).toContain('One or more products are unavailable')
    expect(prisma.tableTab.findFirst).not.toHaveBeenCalled()
  })

  it('rejects when menu item is sold out', async () => {
    mockTable()
    mockMenuItem({ soldOut: true })

    const res = await placeTabOrder(validInput())

    expect(res.status).toBe('error')
    expect((res as any).errors[0]).toContain('sold out')
    expect(prisma.tableTab.findFirst).not.toHaveBeenCalled()
  })

  it('uses DB prices, never client-supplied prices', async () => {
    mockTable()
    // DB price differs from any "client" price — only DB values should be used
    vi.mocked(prisma.menuItem.findMany).mockResolvedValueOnce([
      {
        id: PRODUCT_ID,
        name: 'Water',
        price: 2.0,
        totalPrice: 2.4,
        tax: 14,
        category: 'drink',
        soldOut: false,
        active: true,
        imageUrl: null,
      },
    ] as any)
    mockTabNotFound()
    mockTabCreate()
    mockOrderCreate()

    const res = await placeTabOrder(validInput({ items: [{ product: { id: PRODUCT_ID }, quantity: 3 }] }))

    // Verify order.create was called with DB-derived price (2.0 × 3 = 6)
    // totalPrice may be a floating-point representation of 7.2 — check price which is exact
    expect(prisma.order.create).toHaveBeenCalledTimes(1)
    const createCall = vi.mocked(prisma.order.create).mock.calls[0][0] as any
    expect(createCall.data.price).toBe(6)
    // 2.4 × 3: allow floating-point tolerance
    expect(createCall.data.totalPrice).toBeCloseTo(7.2, 5)
    expect(res.status).toBe('ok')
  })

  it('pre-v2 menu item (totalPrice 0) falls back to price for the gross line', async () => {
    mockTable()
    mockMenuItem({ totalPrice: 0, price: 5.0, tax: 0 })
    mockTabNotFound()
    mockTabCreate()
    mockOrderCreate()

    const res = await placeTabOrder(validInput({ items: [{ product: { id: PRODUCT_ID }, quantity: 2 }] }))

    expect(res.status).toBe('ok')
    const createCall = vi.mocked(prisma.order.create).mock.calls[0][0] as any
    // price 5.0 * 2 = 10; totalPrice falls back to price (gross = 10 as well)
    expect(createCall.data.price).toBe(10)
    expect(createCall.data.totalPrice).toBe(10)
  })
})

describe('placeTabOrder — tab state machine', () => {
  it('creates a new tab when no open tab exists (dual-write siteId for linked restaurant)', async () => {
    mockTable()
    mockMenuItem()
    mockTabNotFound()
    mockTabCreate()
    mockOrderCreate()

    const res = await placeTabOrder(validInput())

    expect(res.status).toBe('ok')
    expect((res as any).tabId).toBe(TAB_ID)
    expect((res as any).orderId).toBe(ORDER_ID)
    expect(prisma.tableTab.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tableId: TABLE_ID,
          restaurantId: RESTAURANT_ID,
          siteId: SITE_ID,
          openTableId: TABLE_ID,
          status: 'open',
        }),
      }),
    )
  })

  it('standalone restaurant (siteId null) creates a tab with siteId null and no site connect on the order', async () => {
    mockTable({
      restaurant: {
        id: RESTAURANT_ID,
        siteId: null,
        dineInEnabled: true,
        partnerAccountId: PARTNER_ACCOUNT_USER_ID,
      },
    })
    mockMenuItem()
    mockTabNotFound()
    mockTabCreate()
    mockOrderCreate()

    const res = await placeTabOrder(validInput())

    expect(res.status).toBe('ok')
    expect(prisma.tableTab.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          restaurantId: RESTAURANT_ID,
          siteId: null,
        }),
      }),
    )
    const createCall = vi.mocked(prisma.order.create).mock.calls[0][0] as any
    expect(createCall.data.restaurant).toEqual({ connect: { id: RESTAURANT_ID } })
    expect(createCall.data.site).toBeUndefined()
  })

  it('linked restaurant (siteId set) dual-writes site connect on the order', async () => {
    mockTable()
    mockMenuItem()
    mockTabNotFound()
    mockTabCreate()
    mockOrderCreate()

    await placeTabOrder(validInput())

    const createCall = vi.mocked(prisma.order.create).mock.calls[0][0] as any
    expect(createCall.data.restaurant).toEqual({ connect: { id: RESTAURANT_ID } })
    expect(createCall.data.site).toEqual({ connect: { id: SITE_ID } })
  })

  it('joins an existing open tab (second round)', async () => {
    mockTable()
    mockMenuItem()
    // Existing open tab — no create needed
    vi.mocked(prisma.tableTab.findFirst).mockResolvedValueOnce({
      id: TAB_ID,
      status: 'open',
    } as any)
    mockOrderCreate()

    const res = await placeTabOrder(validInput())

    expect(res.status).toBe('ok')
    expect((res as any).tabId).toBe(TAB_ID)
    // Tab create must NOT have been called — joined the existing one
    expect(prisma.tableTab.create).not.toHaveBeenCalled()
  })

  it('rejects new orders when tab is pending_payment', async () => {
    mockTable()
    mockMenuItem()
    vi.mocked(prisma.tableTab.findFirst).mockResolvedValueOnce({
      id: TAB_ID,
      status: 'pending_payment',
    } as any)

    const res = await placeTabOrder(validInput())

    expect(res.status).toBe('error')
    expect((res as any).errors[0]).toContain('payment')
    expect(prisma.order.create).not.toHaveBeenCalled()
  })

  it('creates order with ORDER_COMPLETE status and denormalized tableId', async () => {
    mockTable()
    mockMenuItem()
    mockTabNotFound()
    mockTabCreate()
    mockOrderCreate()

    await placeTabOrder(validInput())

    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'complete',
          tableId: TABLE_ID,
        }),
      }),
    )
  })

  it('attaches anonId to the order for anonymous callers', async () => {
    mockTable()
    mockMenuItem()
    mockTabNotFound()
    mockTabCreate()
    mockOrderCreate()

    await placeTabOrder(validInput({ anonId: ANON_ID }))

    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ anonId: ANON_ID }),
      }),
    )
  })

  it('retries and joins winner tab on P2002 (concurrent first-order race)', async () => {
    mockTable()
    mockMenuItem()

    // First $transaction call: tab create throws P2002
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    vi.mocked(prisma.$transaction)
      .mockRejectedValueOnce(p2002)
      // Second $transaction call (retry): succeeds with the winner tab
      .mockResolvedValueOnce({ orderId: ORDER_ID, tabId: TAB_ID })

    // Re-read of winner tab after P2002
    vi.mocked(prisma.tableTab.findFirst).mockResolvedValueOnce({
      id: TAB_ID,
      status: 'open',
    } as any)

    const res = await placeTabOrder(validInput())

    expect(res.status).toBe('ok')
    expect((res as any).tabId).toBe(TAB_ID)
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
  })
})

// ─── getTabState ──────────────────────────────────────────────────────────────

describe('getTabState', () => {
  it('returns tab: null when no open tab exists', async () => {
    vi.mocked(prisma.tableTab.findFirst).mockResolvedValueOnce(null)

    const res = await getTabState(TABLE_ID)

    expect(res.status).toBe('ok')
    expect((res as any).tab).toBeNull()
  })

  it('queries by openTableId only (no siteId filter)', async () => {
    vi.mocked(prisma.tableTab.findFirst).mockResolvedValueOnce(null)

    await getTabState(TABLE_ID)

    expect(prisma.tableTab.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { openTableId: TABLE_ID },
      }),
    )
  })

  it('returns tab with orders and calculateTabTotal totals', async () => {
    vi.mocked(prisma.tableTab.findFirst).mockResolvedValueOnce({
      id: TAB_ID,
      status: 'open',
      openedAt: new Date('2026-01-01T12:00:00Z'),
      orders: [
        {
          id: ORDER_ID,
          status: 'complete',
          notes: null,
          createdAt: new Date('2026-01-01T12:05:00Z'),
          orderItems: [
            {
              id: 'item-1',
              name: 'Water',
              quantity: 2,
              price: 4.0,
              totalPrice: 4.8,
              notes: null,
            },
          ],
        },
      ],
    } as any)

    mockCalculateTabTotal.mockResolvedValueOnce({
      ordersTotal: 4.8,
      serviceFee: 0.5,
      payableTotal: 5.3,
      orderIds: [ORDER_ID],
    })

    const res = await getTabState(TABLE_ID)

    expect(res.status).toBe('ok')
    const tab = (res as any).tab
    expect(tab.id).toBe(TAB_ID)
    expect(tab.status).toBe('open')
    expect(tab.orders).toHaveLength(1)
    expect(tab.orders[0].items).toHaveLength(1)
    expect(tab.totals.ordersTotal).toBe(4.8)
    expect(tab.totals.serviceFee).toBe(0.5)
    expect(tab.totals.payableTotal).toBe(5.3)
  })

  it('returns error on invalid tableId', async () => {
    mockIsValidEntityId.mockReturnValueOnce(false)

    const res = await getTabState('bad')

    expect(res.status).toBe('error')
    expect((res as any).errors).toContain('Invalid table ID')
  })
})

// ─── getDineContext ───────────────────────────────────────────────────────────

describe('getDineContext', () => {
  it('returns feature_disabled when restaurants flag is off', async () => {
    mockIsFlagEnabled.mockResolvedValueOnce(false)

    const res = await getDineContext(TABLE_ID)

    expect(res.status).toBe('error')
    expect((res as any).errors).toContain('feature_disabled')
  })

  it('returns error when table is not found or inactive', async () => {
    vi.mocked(prisma.table.findUnique).mockResolvedValueOnce(null)

    const res = await getDineContext(TABLE_ID)

    expect(res.status).toBe('error')
    expect((res as any).errors).toContain('Table not found or unavailable')
  })

  it('returns error when table has no restaurant', async () => {
    vi.mocked(prisma.table.findUnique).mockResolvedValueOnce({
      id: TABLE_ID,
      number: 5,
      label: 'T5',
      status: 'active',
      restaurant: null,
    } as any)

    const res = await getDineContext(TABLE_ID)

    expect(res.status).toBe('error')
    expect((res as any).errors).toContain('Table not found or unavailable')
  })

  it('returns error when restaurant.dineInEnabled is false', async () => {
    vi.mocked(prisma.table.findUnique).mockResolvedValueOnce({
      id: TABLE_ID,
      number: 5,
      label: 'T5',
      status: 'active',
      restaurant: { id: RESTAURANT_ID, name: 'Vento', dineInEnabled: false },
    } as any)

    const res = await getDineContext(TABLE_ID)

    expect(res.status).toBe('error')
    expect((res as any).errors?.[0]).toContain('not available')
  })

  it('returns full context on success (menu sourced from MenuItem)', async () => {
    vi.mocked(prisma.table.findUnique).mockResolvedValueOnce({
      id: TABLE_ID,
      number: 3,
      label: 'T3',
      status: 'active',
      restaurant: { id: RESTAURANT_ID, name: 'Chiringuito', dineInEnabled: true },
    } as any)
    vi.mocked(prisma.menuItem.findMany).mockResolvedValueOnce([
      {
        id: PRODUCT_ID,
        name: 'Water',
        price: 2.0,
        totalPrice: 2.4,
        tax: 14,
        category: 'drink',
        soldOut: false,
        active: true,
        imageUrl: null,
      },
    ] as any)

    const res = await getDineContext(TABLE_ID)

    expect(res.status).toBe('ok')
    const ctx = (res as any).context
    expect(ctx.restaurant.name).toBe('Chiringuito')
    expect(ctx.table.number).toBe(3)
    expect(ctx.table.label).toBe('T3')
    expect(ctx.products).toHaveLength(1)
    expect(ctx.products[0].name).toBe('Water')
    expect(ctx.products[0].totalPrice).toBe(2.4)
    expect(prisma.menuItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { restaurantId: RESTAURANT_ID, active: true },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      }),
    )
  })

  it('pre-v2 menu item (totalPrice 0) falls back to price in the DTO', async () => {
    vi.mocked(prisma.table.findUnique).mockResolvedValueOnce({
      id: TABLE_ID,
      number: 3,
      label: 'T3',
      status: 'active',
      restaurant: { id: RESTAURANT_ID, name: 'Chiringuito', dineInEnabled: true },
    } as any)
    vi.mocked(prisma.menuItem.findMany).mockResolvedValueOnce([
      {
        id: PRODUCT_ID,
        name: 'Legacy Dish',
        price: 7.5,
        totalPrice: 0,
        tax: 0,
        category: 'food',
        soldOut: false,
        active: true,
        imageUrl: null,
      },
    ] as any)

    const res = await getDineContext(TABLE_ID)

    expect(res.status).toBe('ok')
    const ctx = (res as any).context
    expect(ctx.products[0].totalPrice).toBe(7.5)
  })

  it('returns error on invalid tableId', async () => {
    mockIsValidEntityId.mockReturnValueOnce(false)

    const res = await getDineContext('bad')

    expect(res.status).toBe('error')
    expect((res as any).errors).toContain('Invalid table ID')
  })
})
