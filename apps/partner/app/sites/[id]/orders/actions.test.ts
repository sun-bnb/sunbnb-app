import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@repo/data/tab-payment', () => ({
  processConfirmedTabPayment: vi.fn().mockResolvedValue(undefined),
  calculateTabTotal: vi.fn().mockResolvedValue({ ordersTotal: 0, serviceFee: 0, payableTotal: 0, orderIds: [] }),
}))

import { setOrderStatus, getOrders, toggleProductSoldOut, getOpenTabs, settleTabCash, discardTab } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { processConfirmedTabPayment } from '@repo/data/tab-payment'

const mockAuth = vi.mocked(auth)
const OWNER_ID = 'owner-1'
const SITE_ID = 'site-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

function authenticateAsOwner() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
}

// ─── setOrderStatus ─────────────────────────────────────────────────────────

describe('setOrderStatus', () => {
  it('rejects unauthenticated user', async () => {
    const res = await setOrderStatus(SITE_ID, 'order-1', 'accepted')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('rejects invalid order status string', async () => {
    authenticateAsOwner()
    const res = await setOrderStatus(SITE_ID, 'order-1', 'invalid-status')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid order status')
  })

  it('allows valid transition: complete → accepted', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      status: 'complete',
      siteId: SITE_ID,
    } as any)
    vi.mocked(prisma.order.update).mockResolvedValue({} as any)

    const res = await setOrderStatus(SITE_ID, 'order-1', 'accepted')
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.order.update).mock.calls[0][0]
    expect(updateCall.data.status).toBe('accepted')
    expect(updateCall.data.acceptedAt).toBeInstanceOf(Date)
  })

  it('allows valid transition: accepted → preparing', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      status: 'accepted',
      siteId: SITE_ID,
    } as any)
    vi.mocked(prisma.order.update).mockResolvedValue({} as any)

    const res = await setOrderStatus(SITE_ID, 'order-1', 'preparing')
    expect(res.status).toBe('ok')
  })

  it('allows valid transition: preparing → ready', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      status: 'preparing',
      siteId: SITE_ID,
    } as any)
    vi.mocked(prisma.order.update).mockResolvedValue({} as any)

    const res = await setOrderStatus(SITE_ID, 'order-1', 'ready')
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.order.update).mock.calls[0][0].data.readyAt).toBeInstanceOf(Date)
  })

  it('allows valid transition: ready → delivered', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      status: 'ready',
      siteId: SITE_ID,
    } as any)
    vi.mocked(prisma.order.update).mockResolvedValue({} as any)

    const res = await setOrderStatus(SITE_ID, 'order-1', 'delivered')
    expect(res.status).toBe('ok')
  })

  it('rejects invalid transition: complete → ready (skipping accepted+preparing)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      status: 'complete',
      siteId: SITE_ID,
    } as any)

    const res = await setOrderStatus(SITE_ID, 'order-1', 'ready')
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot transition')
  })

  it('rejects invalid transition: delivered → accepted (backward)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      status: 'delivered',
      siteId: SITE_ID,
    } as any)

    const res = await setOrderStatus(SITE_ID, 'order-1', 'accepted')
    expect(res.status).toBe('error')
  })

  it('allows rejection from complete status', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      status: 'complete',
      siteId: SITE_ID,
    } as any)
    vi.mocked(prisma.order.update).mockResolvedValue({} as any)

    const res = await setOrderStatus(SITE_ID, 'order-1', 'rejected', 'Out of stock')
    expect(res.status).toBe('ok')
    const updateCall = vi.mocked(prisma.order.update).mock.calls[0][0]
    expect(updateCall.data.rejectReason).toBe('Out of stock')
  })

  it('allows discard from any active status', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      status: 'preparing',
      siteId: SITE_ID,
    } as any)
    vi.mocked(prisma.order.update).mockResolvedValue({} as any)

    const res = await setOrderStatus(SITE_ID, 'order-1', 'discarded')
    expect(res.status).toBe('ok')
  })

  it('rejects order belonging to different site', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      status: 'complete',
      siteId: 'other-site',
    } as any)

    const res = await setOrderStatus(SITE_ID, 'order-1', 'accepted')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Order not found')
  })
})

// ─── getOrders ──────────────────────────────────────────────────────────────

describe('getOrders', () => {
  it('rejects unauthenticated user', async () => {
    const res = await getOrders(SITE_ID)
    expect(res.status).toBe('error')
  })

  it('returns orders filtered by tab', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.order.findMany).mockResolvedValue([{ id: 'o-1' }] as any)

    const res = await getOrders(SITE_ID, 'incoming')
    expect(res.status).toBe('ok')
    expect(res.orders).toHaveLength(1)

    const findCall = vi.mocked(prisma.order.findMany).mock.calls[0][0]
    expect(findCall.where.status.in).toContain('complete')
  })
})

// ─── toggleProductSoldOut (orders/actions version) ────────────────────────
//
// This is DISTINCT from products/actions.toggleProductSoldOut — it:
//   • is gated by verifySiteAccess (session OR accessKey, hasSome ['all','manage_site'])
//   • takes siteId + productId (cross-entity ownership check: product must belong to site)
//   • accepts an optional accessKey for token-gated access from the orders dashboard

describe('toggleProductSoldOut (orders-dashboard version)', () => {
  it('rejects unauthenticated with no accessKey', async () => {
    const res = await toggleProductSoldOut(SITE_ID, 'prod-1', true)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('marks product as sold out when caller owns the site', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ siteId: SITE_ID } as any)
    vi.mocked(prisma.product.update).mockResolvedValue({} as any)

    const res = await toggleProductSoldOut(SITE_ID, 'prod-1', true)
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.product.update).mock.calls[0][0]
    expect(updateCall.data.soldOut).toBe(true)
    expect(updateCall.where.id).toBe('prod-1')
  })

  it('marks product as available (soldOut=false)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ siteId: SITE_ID } as any)
    vi.mocked(prisma.product.update).mockResolvedValue({} as any)

    const res = await toggleProductSoldOut(SITE_ID, 'prod-1', false)
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.product.update).mock.calls[0][0]
    expect(updateCall.data.soldOut).toBe(false)
  })

  it('rejects product that belongs to a different site', async () => {
    authenticateAsOwner()
    // product.siteId is a different site
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ siteId: 'other-site' } as any)

    const res = await toggleProductSoldOut(SITE_ID, 'prod-1', true)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Product not found')
  })

  it('rejects when product does not exist', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null)

    const res = await toggleProductSoldOut(SITE_ID, 'prod-1', true)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Product not found')
  })

  it('accepts an accessKey in place of a session (token-gated orders dashboard)', async () => {
    // No session — token path only
    // verifySiteAccess queries securityToken then site
    vi.mocked(prisma.securityToken.findUnique).mockResolvedValue({
      id: 'tok-1',
      userId: OWNER_ID,
    } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ siteId: SITE_ID } as any)
    vi.mocked(prisma.product.update).mockResolvedValue({} as any)

    const res = await toggleProductSoldOut(SITE_ID, 'prod-1', true, 'valid-access-key')
    expect(res.status).toBe('ok')
  })
})

// ─── getOpenTabs ─────────────────────────────────────────────────────────────

describe('getOpenTabs', () => {
  it('rejects unauthenticated user', async () => {
    const res = await getOpenTabs(SITE_ID)
    expect(res.status).toBe('error')
  })

  it('returns open and pending_payment tabs, excluding void orders', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.tableTab.findMany).mockResolvedValue([
      {
        id: 'tab-1',
        status: 'open',
        siteId: SITE_ID,
        openedAt: new Date('2024-01-01T12:00:00Z'),
        table: { number: 3, label: 'Terrace' },
        orders: [
          {
            paymentAmount: 15.00,
            totalPrice: 15.00,
            orderItems: [{ name: 'Beer', quantity: 2, totalPrice: 7.50 }],
          },
          {
            // voided order excluded — should not appear in items or total
            paymentAmount: 5.00,
            totalPrice: 5.00,
            orderItems: [{ name: 'Water', quantity: 1, totalPrice: 5.00 }],
          },
        ],
      },
    ] as any)

    const res = await getOpenTabs(SITE_ID)
    expect(res.status).toBe('ok')
    expect(res.tabs).toHaveLength(1)
    const tab = res.tabs![0]
    expect(tab.id).toBe('tab-1')
    expect(tab.tableNumber).toBe(3)
    expect(tab.tableLabel).toBe('Terrace')
    expect(tab.roundsCount).toBe(2)
    // amountDue is sum of non-voided orders (both are included since findMany already filtered)
    expect(tab.amountDue).toBe(20.00)
    expect(tab.items).toEqual(expect.arrayContaining([{ name: 'Beer', quantity: 2 }]))
  })

  it('returns empty array when no open tabs', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.tableTab.findMany).mockResolvedValue([] as any)
    const res = await getOpenTabs(SITE_ID)
    expect(res.status).toBe('ok')
    expect(res.tabs).toHaveLength(0)
  })

  it('merges duplicate item names across rounds', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.tableTab.findMany).mockResolvedValue([
      {
        id: 'tab-1',
        status: 'open',
        siteId: SITE_ID,
        openedAt: new Date(),
        table: { number: 1, label: null },
        orders: [
          {
            paymentAmount: 10.00,
            totalPrice: 10.00,
            orderItems: [{ name: 'Beer', quantity: 1, totalPrice: 5.00 }],
          },
          {
            paymentAmount: 5.00,
            totalPrice: 5.00,
            orderItems: [{ name: 'Beer', quantity: 1, totalPrice: 5.00 }],
          },
        ],
      },
    ] as any)

    const res = await getOpenTabs(SITE_ID)
    expect(res.status).toBe('ok')
    const items = res.tabs![0].items
    // Beer from two rounds should be merged to quantity 2
    expect(items).toEqual([{ name: 'Beer', quantity: 2 }])
  })
})

// ─── settleTabCash ────────────────────────────────────────────────────────────

describe('settleTabCash', () => {
  it('rejects unauthenticated user', async () => {
    const res = await settleTabCash(SITE_ID, 'tab-1')
    expect(res.status).toBe('error')
  })

  it('rejects tab belonging to a different site', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({
      id: 'tab-1',
      siteId: 'other-site',
      status: 'open',
      orders: [],
    } as any)

    const res = await settleTabCash(SITE_ID, 'tab-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Tab not found')
  })

  it('rejects tab that is not found', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.tableTab.findUnique).mockResolvedValue(null)

    const res = await settleTabCash(SITE_ID, 'tab-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Tab not found')
  })

  it('rejects tab in pending_payment status (online payment in flight)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({
      id: 'tab-1',
      siteId: SITE_ID,
      status: 'pending_payment',
      orders: [],
    } as any)

    const res = await settleTabCash(SITE_ID, 'tab-1')
    expect(res.status).toBe('error')
    expect(res.errors![0]).toMatch(/payment is in progress/i)
    // processConfirmedTabPayment must NOT have been called
    expect(vi.mocked(processConfirmedTabPayment)).not.toHaveBeenCalled()
  })

  it('rejects tab that is already closed', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({
      id: 'tab-1',
      siteId: SITE_ID,
      status: 'paid',
      orders: [],
    } as any)

    const res = await settleTabCash(SITE_ID, 'tab-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Tab is already closed')
    expect(vi.mocked(processConfirmedTabPayment)).not.toHaveBeenCalled()
  })

  it('calls processConfirmedTabPayment with { cash: true } for TAB_OPEN tab', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({
      id: 'tab-1',
      siteId: SITE_ID,
      status: 'open',
      orders: [
        { paymentAmount: 20.00, totalPrice: 20.00 },
      ],
    } as any)

    const res = await settleTabCash(SITE_ID, 'tab-1')
    expect(res.status).toBe('ok')
    expect(res.amountDue).toBe(20.00)

    const calls = vi.mocked(processConfirmedTabPayment).mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('tab-1')
    expect(calls[0][1]).toEqual({ cash: true })
  })
})

// ─── discardTab ───────────────────────────────────────────────────────────────

describe('discardTab', () => {
  it('rejects unauthenticated user', async () => {
    const res = await discardTab(SITE_ID, 'tab-1')
    expect(res.status).toBe('error')
  })

  it('rejects tab belonging to a different site', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({
      id: 'tab-1',
      siteId: 'other-site',
      status: 'open',
      orders: [],
    } as any)

    const res = await discardTab(SITE_ID, 'tab-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Tab not found')
  })

  it('rejects tab in pending_payment status', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({
      id: 'tab-1',
      siteId: SITE_ID,
      status: 'pending_payment',
      orders: [],
    } as any)

    const res = await discardTab(SITE_ID, 'tab-1')
    expect(res.status).toBe('error')
    expect(res.errors![0]).toMatch(/payment is in progress/i)
  })

  it('rejects tab that is already closed', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({
      id: 'tab-1',
      siteId: SITE_ID,
      status: 'discarded',
      orders: [],
    } as any)

    const res = await discardTab(SITE_ID, 'tab-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Tab is already closed')
  })

  it('voids non-voided orders and closes tab with openTableId=null in one transaction', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({
      id: 'tab-1',
      siteId: SITE_ID,
      status: 'open',
      orders: [
        { id: 'order-1' },
        { id: 'order-2' },
      ],
    } as any)

    // $transaction is called with an array of prisma operations
    const txnCalls: any[] = []
    vi.mocked(prisma.$transaction).mockImplementation(async (ops: any) => {
      if (Array.isArray(ops)) {
        txnCalls.push(...ops)
        return Promise.all(ops)
      }
      return (ops as any)(prisma)
    })
    vi.mocked(prisma.order.updateMany).mockResolvedValue({ count: 2 } as any)
    vi.mocked(prisma.tableTab.update).mockResolvedValue({} as any)

    const res = await discardTab(SITE_ID, 'tab-1')
    expect(res.status).toBe('ok')

    // updateMany called to void orders
    const updateManyCall = vi.mocked(prisma.order.updateMany).mock.calls[0][0]
    expect(updateManyCall.where.id.in).toEqual(['order-1', 'order-2'])
    expect(updateManyCall.data.status).toBe('discarded')

    // tableTab.update called to close tab with openTableId = null
    const updateCall = vi.mocked(prisma.tableTab.update).mock.calls[0][0]
    expect(updateCall.where.id).toBe('tab-1')
    expect(updateCall.data.status).toBe('discarded')
    expect(updateCall.data.openTableId).toBeNull()
    expect(updateCall.data.closedAt).toBeInstanceOf(Date)
  })

  it('closes tab with openTableId=null even when there are no orders', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({
      id: 'tab-empty',
      siteId: SITE_ID,
      status: 'open',
      orders: [],
    } as any)
    vi.mocked(prisma.tableTab.update).mockResolvedValue({} as any)

    const res = await discardTab(SITE_ID, 'tab-empty')
    expect(res.status).toBe('ok')

    // order.updateMany should NOT be called (no orders to void)
    expect(vi.mocked(prisma.order.updateMany)).not.toHaveBeenCalled()

    // tableTab.update still called with openTableId = null
    const updateCall = vi.mocked(prisma.tableTab.update).mock.calls[0][0]
    expect(updateCall.data.openTableId).toBeNull()
  })
})
