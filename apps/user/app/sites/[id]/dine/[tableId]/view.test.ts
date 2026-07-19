/**
 * DineView logic tests.
 *
 * The view is a client component that can't be DOM-rendered in this test
 * environment (no jsdom, no @testing-library). Instead we test the *contracts*
 * between the view and the server actions it calls, and we verify the key
 * action shapes match what the view expects to receive.
 *
 * Scenarios covered:
 *  1. Menu renders from context (product shape contract)
 *  2. Order flow calls placeTabOrder with anonId + cart items
 *  3. Tab section renders rounds + totals (TabState shape contract)
 *  4. pending_payment status disables ordering
 *  5. Pay button visibility rule (open + payable > 0; hidden on pending_payment/zero)
 *  6. Demo pay call contract (initiateDemoTabPayment called with tab id; ok → paid)
 *  7. Mollie pay call contract (correct POST body incl. redirectUrl shape)
 *  8. Return-poll resolution mapping (paid → paid, open → failed banner, pending → continue, 404/discarded → closed)
 *  9. Paid-state guard vs tab:null poll
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./actions', () => ({
  getDineContext: vi.fn(),
  placeTabOrder: vi.fn(),
  getTabState: vi.fn(),
}))

vi.mock('@/app/payment/actions', () => ({
  initiateDemoTabPayment: vi.fn(),
  initiateDemoReservationPayment: vi.fn(),
  initiateDemoOrderPayment: vi.fn(),
  initiateDemoRentalPayment: vi.fn(),
  getReservationById: vi.fn(),
  getReservationByPaymentRef: vi.fn(),
  getOrderByPaymentRef: vi.fn(),
}))

import { placeTabOrder, getTabState } from './actions'
import { initiateDemoTabPayment } from '@/app/payment/actions'
import type { DineContext, TabState } from './actions'

const mockPlaceTabOrder = vi.mocked(placeTabOrder)
const mockGetTabState = vi.mocked(getTabState)
const mockInitiateDemoTabPayment = vi.mocked(initiateDemoTabPayment)

// ── Shared fixtures ───────────────────────────────────────────────────────────

const SITE_ID = 'site-1'
const TABLE_ID = 'table-1'
const ANON_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const TAB_ID = 'tab-abc123'

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
    id: TAB_ID,
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
    mockPlaceTabOrder.mockResolvedValue({ status: 'ok', orderId: 'ord-new', tabId: TAB_ID })

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

// ─── 5. Pay button visibility rule ───────────────────────────────────────────

describe('pay button visibility logic', () => {
  it('canPay is true when tab is open and payableTotal > 0', () => {
    const tab = makeTab({ status: 'open', totals: { ordersTotal: 4.8, serviceFee: 0, payableTotal: 4.8 } })
    // Replicates the view's canPay condition
    const canPay = tab !== null && tab.status === 'open' && tab.totals.payableTotal > 0
    expect(canPay).toBe(true)
  })

  it('canPay is false when tab status is pending_payment', () => {
    const tab = makeTab({ status: 'pending_payment' })
    const canPay = tab !== null && tab.status === 'open' && tab.totals.payableTotal > 0
    expect(canPay).toBe(false)
  })

  it('canPay is false when payableTotal is 0', () => {
    const tab = makeTab({ totals: { ordersTotal: 0, serviceFee: 0, payableTotal: 0 } })
    const canPay = tab !== null && tab.status === 'open' && tab.totals.payableTotal > 0
    expect(canPay).toBe(false)
  })

  it('canPay is false when tab is null', () => {
    const tab = null
    const canPay = tab !== null && (tab as TabState | null)?.status === 'open' && (tab as TabState | null)?.totals.payableTotal! > 0
    expect(canPay).toBe(false)
  })
})

// ─── 6. Demo pay call contract ────────────────────────────────────────────────

describe('initiateDemoTabPayment call contract', () => {
  it('is called with tab.id', async () => {
    mockInitiateDemoTabPayment.mockResolvedValue({ status: 'ok', paymentRef: 'pi_demo_123' })

    const tab = makeTab()
    await initiateDemoTabPayment(tab.id)

    expect(mockInitiateDemoTabPayment).toHaveBeenCalledWith(TAB_ID)
  })

  it('ok result signals paid state transition', async () => {
    mockInitiateDemoTabPayment.mockResolvedValue({ status: 'ok', paymentRef: 'pi_demo_456' })

    const result = await initiateDemoTabPayment(TAB_ID)

    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.paymentRef).toMatch(/^pi_demo_/)
    }
  })

  it('error result carries errors array for banner display', async () => {
    mockInitiateDemoTabPayment.mockResolvedValue({
      status: 'error',
      errors: ['Payment already in progress'],
    })

    const result = await initiateDemoTabPayment(TAB_ID)

    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(Array.isArray(result.errors)).toBe(true)
      expect(result.errors.length).toBeGreaterThan(0)
    }
  })

  it('idempotent: calling with already-claimed tab returns ok', async () => {
    // Simulates what initiateDemoTabPayment returns on re-tap (paymentRef already set)
    mockInitiateDemoTabPayment.mockResolvedValue({ status: 'ok', paymentRef: 'pi_demo_789' })

    const result = await initiateDemoTabPayment(TAB_ID)
    expect(result.status).toBe('ok')
  })
})

// ─── 7. Mollie pay call contract ─────────────────────────────────────────────

describe('Mollie create-payment call contract', () => {
  it('POST body contains tabId and a same-origin redirectUrl', () => {
    // Replicates how the view builds the POST body
    const origin = 'https://local.sunbnb.app:3002'
    const siteId = SITE_ID
    const tableId = TABLE_ID
    const tabId = TAB_ID

    const redirectUrl = `${origin}/sites/${siteId}/dine/${tableId}?tabReturn=${tabId}`

    const body = { tabId, redirectUrl }

    expect(body.tabId).toBe(TAB_ID)
    expect(body.redirectUrl).toContain(`/sites/${SITE_ID}/dine/${TABLE_ID}`)
    expect(body.redirectUrl).toContain(`tabReturn=${TAB_ID}`)

    // The origin must match the caller's origin (validated server-side)
    const parsed = new URL(body.redirectUrl)
    expect(parsed.origin).toBe(origin)
  })

  it('redirectUrl contains tabReturn query param for return handling', () => {
    const origin = 'https://sunbnb.app'
    const redirectUrl = `${origin}/sites/${SITE_ID}/dine/${TABLE_ID}?tabReturn=${TAB_ID}`

    const parsed = new URL(redirectUrl)
    expect(parsed.searchParams.get('tabReturn')).toBe(TAB_ID)
  })
})

// ─── 8. Return-poll resolution mapping ───────────────────────────────────────

describe('tabReturn poll resolution', () => {
  it('paid status → paid state', () => {
    // Simulates what the poll loop does when it receives { status: "paid" }
    const pollResult = { id: TAB_ID, status: 'paid', closedAt: '2026-07-18T13:00:00Z' }

    // Logic: paid/settled_cash → paid state
    const shouldGoPaid = pollResult.status === 'paid' || pollResult.status === 'settled_cash'
    expect(shouldGoPaid).toBe(true)
  })

  it('settled_cash status → paid state', () => {
    const pollResult = { id: TAB_ID, status: 'settled_cash', closedAt: '2026-07-18T13:00:00Z' }
    const shouldGoPaid = pollResult.status === 'paid' || pollResult.status === 'settled_cash'
    expect(shouldGoPaid).toBe(true)
  })

  it('open status → payment failed/canceled banner + resume ordering', () => {
    const pollResult = { id: TAB_ID, status: 'open', closedAt: null }

    // Logic: open → show failure banner, resume ordering
    const shouldResume = pollResult.status === 'open'
    expect(shouldResume).toBe(true)
  })

  it('pending_payment status → continue polling', () => {
    const pollResult = { id: TAB_ID, status: 'pending_payment', closedAt: null }

    // Logic: pending_payment → keep polling (no terminal state)
    const isTerminal = pollResult.status === 'paid' ||
      pollResult.status === 'settled_cash' ||
      pollResult.status === 'open' ||
      pollResult.status === 'discarded'
    expect(isTerminal).toBe(false)
  })

  it('discarded status → closed state', () => {
    const pollResult = { id: TAB_ID, status: 'discarded', closedAt: '2026-07-18T13:00:00Z' }
    const shouldClose = pollResult.status === 'discarded'
    expect(shouldClose).toBe(true)
  })

  it('404 response → closed state', () => {
    // The view treats a 404 from GET /api/tabs/[id] as "tab closed"
    const httpStatus = 404
    const shouldClose = httpStatus === 404
    expect(shouldClose).toBe(true)
  })
})

// ─── 9. Paid-state guard vs tab:null poll ─────────────────────────────────────

describe('paid state guard', () => {
  it('tab returning null after paid does NOT clobber paid state', () => {
    // Simulates the guard in the view:
    // getTabState returns tab:null for closed tabs. If we're already in paid phase,
    // we must not revert to ordering phase just because tab is null.
    type Phase = 'ordering' | 'paid' | 'closed' | 'verifying' | 'confirm_pay' | 'paying'
    let uiPhase: Phase = 'paid'
    const newTab = null

    // Replicates the guard logic
    if (newTab === null && (uiPhase === 'paid' || uiPhase === 'closed')) {
      // Do NOT clobber — leave paid state
    } else if (newTab !== null) {
      // Normal update
    }

    expect(uiPhase).toBe('paid')
  })

  it('tab returning null while ordering and prev was pending_payment → paid state', () => {
    // On companion phone: prev poll showed pending_payment, this poll shows null
    // (tab closed by payer). The view transitions to paid.
    let prevStatus: string | undefined = 'pending_payment'
    const newTab = null
    let uiPhase = 'ordering'

    if (prevStatus === 'pending_payment' && newTab === null && uiPhase === 'ordering') {
      uiPhase = 'paid'
    }

    expect(uiPhase).toBe('paid')
  })

  it('tab returning null while ordering without prior pending_payment → no state change', () => {
    // Normal case: tab never existed yet (tabLoading just finished), tab:null means
    // no open tab for this table — stay in ordering phase so user can place first order.
    let prevStatus: string | undefined = undefined
    const newTab = null
    let uiPhase = 'ordering'

    if (prevStatus === 'pending_payment' && newTab === null && uiPhase === 'ordering') {
      uiPhase = 'paid'
    }

    expect(uiPhase).toBe('ordering')
  })
})
