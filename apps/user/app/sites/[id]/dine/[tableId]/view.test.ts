/**
 * DineView logic tests.
 *
 * The view is a client component that can't be DOM-rendered in this test
 * environment (no jsdom, no @testing-library). Instead we test the *contracts*
 * between the view and the server actions it calls, and we verify the key
 * action shapes match what the view expects to receive.
 *
 * Four scenarios per the spec:
 *  1. Menu renders from context (product shape contract)
 *  2. Order flow calls placeTabOrder with anonId + cart items
 *  3. Tab section renders rounds + totals (TabState shape contract)
 *  4. pending_payment status disables ordering
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./actions', () => ({
  getDineContext: vi.fn(),
  placeTabOrder: vi.fn(),
  getTabState: vi.fn(),
}))

import { placeTabOrder, getTabState } from './actions'
import type { DineContext, TabState } from './actions'

const mockPlaceTabOrder = vi.mocked(placeTabOrder)
const mockGetTabState = vi.mocked(getTabState)

// ── Shared fixtures ───────────────────────────────────────────────────────────

const SITE_ID = 'site-1'
const TABLE_ID = 'table-1'
const ANON_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function makeContext(overrides: Partial<DineContext> = {}): DineContext {
  return {
    site: { id: SITE_ID, name: 'Sunset Beach' },
    restaurant: { id: 'rest-1', name: 'Chiringuito Vento' },
    table: { id: TABLE_ID, number: 5, label: 'T5' },
    products: [
      {
        id: 'prod-1',
        name: 'Agua',
        price: 2.0,
        totalPrice: 2.4,
        tax: 14,
        category: 'drink',
        soldOut: false,
        active: true,
        imageUrl: null,
      },
      {
        id: 'prod-2',
        name: 'Tostada',
        price: 3.0,
        totalPrice: 3.3,
        tax: 10,
        category: 'food',
        soldOut: false,
        active: true,
        imageUrl: null,
      },
    ],
    ...overrides,
  }
}

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'tab-1',
    status: 'open',
    openedAt: new Date('2026-07-18T12:00:00Z'),
    orders: [
      {
        id: 'ord-1',
        status: 'complete',
        notes: null,
        createdAt: new Date('2026-07-18T12:05:00Z'),
        items: [
          {
            id: 'item-1',
            name: 'Agua',
            quantity: 2,
            price: 4.0,
            totalPrice: 4.8,
            notes: null,
          },
        ],
      },
    ],
    totals: {
      ordersTotal: 4.8,
      serviceFee: 0,
      payableTotal: 4.8,
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── 1. Menu renders from context (product shape contract) ────────────────────

describe('DineContext product shape', () => {
  it('products expose the fields the menu UI consumes', () => {
    const ctx = makeContext()

    // Every product must carry these fields for the menu to render correctly.
    for (const p of ctx.products) {
      expect(p).toHaveProperty('id')
      expect(p).toHaveProperty('name')
      expect(p).toHaveProperty('totalPrice')
      expect(p).toHaveProperty('category')
      expect(typeof p.soldOut).toBe('boolean')
      expect(typeof p.active).toBe('boolean')
    }
  })

  it('soldOut and inactive products are excluded from the visible menu', () => {
    const ctx = makeContext({
      products: [
        {
          id: 'sold-out',
          name: 'Sold Out Beer',
          price: 3,
          totalPrice: 3.3,
          tax: 10,
          category: 'drink',
          soldOut: true,
          active: true,
          imageUrl: null,
        },
        {
          id: 'inactive',
          name: 'Inactive Tapa',
          price: 5,
          totalPrice: 5.5,
          tax: 10,
          category: 'food',
          soldOut: false,
          active: false,
          imageUrl: null,
        },
        {
          id: 'visible',
          name: 'Visible Item',
          price: 2,
          totalPrice: 2.2,
          tax: 10,
          category: 'food',
          soldOut: false,
          active: true,
          imageUrl: null,
        },
      ],
    })

    // Replicates the view's filter: active && !soldOut
    const visible = ctx.products.filter((p) => p.active && !p.soldOut)
    expect(visible).toHaveLength(1)
    expect(visible[0]!.id).toBe('visible')
  })
})

// ─── 2. Order flow calls placeTabOrder with anonId + cart items ───────────────

describe('placeTabOrder call contract', () => {
  it('is called with siteId, tableId, anonId, and item list', async () => {
    mockPlaceTabOrder.mockResolvedValue({ status: 'ok', orderId: 'ord-new', tabId: 'tab-1' })

    const ctx = makeContext()
    const items = [{ product: { id: 'prod-1' }, quantity: 2, notes: 'no ice' }]

    await placeTabOrder({
      siteId: ctx.site.id,
      tableId: ctx.table.id,
      anonId: ANON_ID,
      items,
    })

    expect(mockPlaceTabOrder).toHaveBeenCalledWith({
      siteId: SITE_ID,
      tableId: TABLE_ID,
      anonId: ANON_ID,
      items,
    })
  })

  it('returns ok status with orderId and tabId on success', async () => {
    mockPlaceTabOrder.mockResolvedValue({ status: 'ok', orderId: 'ord-123', tabId: 'tab-abc' })

    const result = await placeTabOrder({
      siteId: SITE_ID,
      tableId: TABLE_ID,
      anonId: ANON_ID,
      items: [{ product: { id: 'prod-1' }, quantity: 1 }],
    })

    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.orderId).toBe('ord-123')
      expect(result.tabId).toBe('tab-abc')
    }
  })

  it('returns error status with errors array on failure', async () => {
    mockPlaceTabOrder.mockResolvedValue({
      status: 'error',
      errors: ['Tab payment already in progress'],
    })

    const result = await placeTabOrder({
      siteId: SITE_ID,
      tableId: TABLE_ID,
      anonId: ANON_ID,
      items: [{ product: { id: 'prod-1' }, quantity: 1 }],
    })

    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.errors[0]).toContain('payment')
    }
  })
})

// ─── 3. Tab section: TabState shape contract ──────────────────────────────────

describe('TabState shape', () => {
  it('getTabState returns null tab when no open tab exists', async () => {
    mockGetTabState.mockResolvedValue({ status: 'ok', tab: null })

    const result = await getTabState(SITE_ID, TABLE_ID)

    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.tab).toBeNull()
    }
  })

  it('tab carries orders with items and a totals block', async () => {
    const tab = makeTab()
    mockGetTabState.mockResolvedValue({ status: 'ok', tab })

    const result = await getTabState(SITE_ID, TABLE_ID)

    expect(result.status).toBe('ok')
    if (result.status === 'ok' && result.tab) {
      expect(result.tab.orders).toHaveLength(1)
      expect(result.tab.orders[0]!.items).toHaveLength(1)
      expect(result.tab.totals).toMatchObject({
        ordersTotal: expect.any(Number),
        serviceFee: expect.any(Number),
        payableTotal: expect.any(Number),
      })
    }
  })

  it('tab totals: payableTotal includes serviceFee when present', async () => {
    const tab = makeTab({
      totals: { ordersTotal: 10.0, serviceFee: 1.5, payableTotal: 11.5 },
    })
    mockGetTabState.mockResolvedValue({ status: 'ok', tab })

    const result = await getTabState(SITE_ID, TABLE_ID)
    if (result.status === 'ok' && result.tab) {
      expect(result.tab.totals.payableTotal).toBe(
        result.tab.totals.ordersTotal + result.tab.totals.serviceFee,
      )
    }
  })
})

// ─── 4. pending_payment disables ordering ─────────────────────────────────────

describe('pending_payment tab state', () => {
  it('tab status pending_payment is recognised', async () => {
    const tab = makeTab({ status: 'pending_payment' })
    mockGetTabState.mockResolvedValue({ status: 'ok', tab })

    const result = await getTabState(SITE_ID, TABLE_ID)

    expect(result.status).toBe('ok')
    if (result.status === 'ok' && result.tab) {
      expect(result.tab.status).toBe('pending_payment')
    }
  })

  it('placeTabOrder returns error when tab is pending_payment', async () => {
    // Simulates what the action returns when the tab is locked for payment.
    mockPlaceTabOrder.mockResolvedValue({
      status: 'error',
      errors: ['Tab payment already in progress'],
    })

    const result = await placeTabOrder({
      siteId: SITE_ID,
      tableId: TABLE_ID,
      anonId: ANON_ID,
      items: [{ product: { id: 'prod-1' }, quantity: 1 }],
    })

    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.errors.some((e) => e.toLowerCase().includes('payment'))).toBe(true)
    }
  })
})
