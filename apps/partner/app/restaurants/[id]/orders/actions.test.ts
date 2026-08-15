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

import {
  setRestaurantOrderStatus,
  getRestaurantOrders,
  getRestaurantOpenTabs,
  settleRestaurantTabCash,
  discardRestaurantTab,
} from './actions'
import { HISTORY_TAB_LIMIT } from '../../../sites/[id]/orders/shared'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { processConfirmedTabPayment } from '@repo/data/tab-payment'

const mockAuth = vi.mocked(auth)
const OWNER_ID = 'owner-1'
const OTHER_ID = 'other-1'
const RESTAURANT_ID = 'restaurant-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

function authenticateAsOwner() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
  vi.mocked(prisma.restaurant.findUnique).mockResolvedValue({ partnerAccountId: OWNER_ID } as any)
}

// ─── setRestaurantOrderStatus ────────────────────────────────────────────────

describe('setRestaurantOrderStatus', () => {
  it('rejects unauthenticated user', async () => {
    const res = await setRestaurantOrderStatus(RESTAURANT_ID, 'order-1', 'accepted')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('rejects invalid order status string', async () => {
    authenticateAsOwner()
    const res = await setRestaurantOrderStatus(RESTAURANT_ID, 'order-1', 'invalid-status')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid order status')
  })

  it('allows valid transition: complete → accepted', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      status: 'complete',
      restaurantId: RESTAURANT_ID,
    } as any)
    vi.mocked(prisma.order.update).mockResolvedValue({} as any)

    const res = await setRestaurantOrderStatus(RESTAURANT_ID, 'order-1', 'accepted')
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.order.update).mock.calls[0][0]
    expect(updateCall.data.status).toBe('accepted')
    expect(updateCall.data.acceptedAt).toBeInstanceOf(Date)
  })

  it('allows rejection with a reason', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      status: 'complete',
      restaurantId: RESTAURANT_ID,
    } as any)
    vi.mocked(prisma.order.update).mockResolvedValue({} as any)

    const res = await setRestaurantOrderStatus(RESTAURANT_ID, 'order-1', 'rejected', 'Out of stock')
    expect(res.status).toBe('ok')
    const updateCall = vi.mocked(prisma.order.update).mock.calls[0][0]
    expect(updateCall.data.rejectReason).toBe('Out of stock')
  })

  it('rejects invalid transition: complete → ready (skipping accepted+preparing)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      status: 'complete',
      restaurantId: RESTAURANT_ID,
    } as any)

    const res = await setRestaurantOrderStatus(RESTAURANT_ID, 'order-1', 'ready')
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot transition')
  })

  it('rejects order belonging to a different restaurant', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      status: 'complete',
      restaurantId: 'other-restaurant',
    } as any)

    const res = await setRestaurantOrderStatus(RESTAURANT_ID, 'order-1', 'accepted')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Order not found')
  })

  it('rejects a session belonging to a non-owner of the restaurant', async () => {
    mockAuth.mockResolvedValue({ user: { id: OTHER_ID } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    vi.mocked(prisma.restaurant.findUnique).mockResolvedValue({ partnerAccountId: OWNER_ID } as any)

    const res = await setRestaurantOrderStatus(RESTAURANT_ID, 'order-1', 'accepted')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })
})

// ─── getRestaurantOrders ──────────────────────────────────────────────────────

describe('getRestaurantOrders', () => {
  it('rejects unauthenticated user', async () => {
    const res = await getRestaurantOrders(RESTAURANT_ID)
    expect(res.status).toBe('error')
  })

  it('returns orders filtered by restaurantId + tab', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.order.findMany).mockResolvedValue([{ id: 'o-1' }] as any)

    const res = await getRestaurantOrders(RESTAURANT_ID, 'incoming')
    expect(res.status).toBe('ok')
    expect(res.orders).toHaveLength(1)

    const findCall = vi.mocked(prisma.order.findMany).mock.calls[0][0]
    expect(findCall.where.restaurantId).toBe(RESTAURANT_ID)
    expect(findCall.where.status.in).toContain('complete')
  })

  // Mirrors the site-scoped dashboard's history cap (track 020 P5).
  it('caps the history tab to the latest HISTORY_TAB_LIMIT rows, presented oldest-first', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.order.findMany).mockResolvedValue([
      { id: 'newest' }, { id: 'oldest' },
    ] as any)

    const res = await getRestaurantOrders(RESTAURANT_ID, 'history')
    expect(res.status).toBe('ok')

    const findCall = vi.mocked(prisma.order.findMany).mock.calls[0][0]
    expect(findCall.take).toBe(HISTORY_TAB_LIMIT)
    expect(findCall.orderBy).toEqual({ createdAt: 'desc' })
    expect(res.orders!.map((o: any) => o.id)).toEqual(['oldest', 'newest'])
  })

  it('rejects an invalid tab', async () => {
    authenticateAsOwner()
    const res = await getRestaurantOrders(RESTAURANT_ID, 'bogus' as any)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid tab')
  })

  it('accepts an accessKey in place of a session (token-gated restaurant dashboard)', async () => {
    vi.mocked(prisma.securityToken.findUnique).mockResolvedValue({
      id: 'tok-1',
      userId: OWNER_ID,
      expires: new Date(Date.now() + 60_000),
      resources: ['all', 'manage_site'],
    } as any)
    vi.mocked(prisma.restaurant.findUnique).mockResolvedValue({ partnerAccountId: OWNER_ID } as any)
    vi.mocked(prisma.order.findMany).mockResolvedValue([] as any)

    const res = await getRestaurantOrders(RESTAURANT_ID, 'incoming', 'valid-access-key')
    expect(res.status).toBe('ok')
  })
})

// ─── getRestaurantOpenTabs ────────────────────────────────────────────────────

describe('getRestaurantOpenTabs', () => {
  it('rejects unauthenticated user', async () => {
    const res = await getRestaurantOpenTabs(RESTAURANT_ID)
    expect(res.status).toBe('error')
  })

  it('returns open/pending_payment tabs filtered by restaurantId, excluding void orders', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.tableTab.findMany).mockResolvedValue([
      {
        id: 'tab-1',
        status: 'open',
        restaurantId: RESTAURANT_ID,
        openedAt: new Date('2024-01-01T12:00:00Z'),
        table: { number: 3, label: 'Terrace' },
        orders: [
          {
            paymentAmount: 15.00,
            totalPrice: 15.00,
            orderItems: [{ name: 'Beer', quantity: 2, totalPrice: 7.50 }],
          },
        ],
      },
    ] as any)

    const res = await getRestaurantOpenTabs(RESTAURANT_ID)
    expect(res.status).toBe('ok')
    expect(res.tabs).toHaveLength(1)
    const tab = res.tabs![0]
    expect(tab.id).toBe('tab-1')
    expect(tab.tableNumber).toBe(3)
    expect(tab.amountDue).toBe(15.00)

    const findCall = vi.mocked(prisma.tableTab.findMany).mock.calls[0][0]
    expect(findCall.where.restaurantId).toBe(RESTAURANT_ID)
  })
})

// ─── settleRestaurantTabCash ──────────────────────────────────────────────────

describe('settleRestaurantTabCash', () => {
  it('rejects unauthenticated user', async () => {
    const res = await settleRestaurantTabCash(RESTAURANT_ID, 'tab-1')
    expect(res.status).toBe('error')
  })

  it('rejects tab belonging to a different restaurant', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({
      id: 'tab-1',
      restaurantId: 'other-restaurant',
      status: 'open',
      orders: [],
    } as any)

    const res = await settleRestaurantTabCash(RESTAURANT_ID, 'tab-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Tab not found')
  })

  it('rejects tab in pending_payment status', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({
      id: 'tab-1',
      restaurantId: RESTAURANT_ID,
      status: 'pending_payment',
      orders: [],
    } as any)

    const res = await settleRestaurantTabCash(RESTAURANT_ID, 'tab-1')
    expect(res.status).toBe('error')
    expect(res.errors![0]).toMatch(/payment is in progress/i)
    expect(vi.mocked(processConfirmedTabPayment)).not.toHaveBeenCalled()
  })

  it('calls processConfirmedTabPayment with { cash: true } for an open tab', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({
      id: 'tab-1',
      restaurantId: RESTAURANT_ID,
      status: 'open',
      orders: [
        { paymentAmount: 20.00, totalPrice: 20.00 },
      ],
    } as any)

    const res = await settleRestaurantTabCash(RESTAURANT_ID, 'tab-1')
    expect(res.status).toBe('ok')
    expect(res.amountDue).toBe(20.00)

    const calls = vi.mocked(processConfirmedTabPayment).mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('tab-1')
    expect(calls[0][1]).toEqual({ cash: true })
  })
})

// ─── discardRestaurantTab ─────────────────────────────────────────────────────

describe('discardRestaurantTab', () => {
  it('rejects unauthenticated user', async () => {
    const res = await discardRestaurantTab(RESTAURANT_ID, 'tab-1')
    expect(res.status).toBe('error')
  })

  it('rejects tab belonging to a different restaurant', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({
      id: 'tab-1',
      restaurantId: 'other-restaurant',
      status: 'open',
      orders: [],
    } as any)

    const res = await discardRestaurantTab(RESTAURANT_ID, 'tab-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Tab not found')
  })

  it('voids non-voided orders and nulls openTableId in one transaction', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({
      id: 'tab-1',
      restaurantId: RESTAURANT_ID,
      status: 'open',
      orders: [
        { id: 'order-1' },
        { id: 'order-2' },
      ],
    } as any)

    vi.mocked(prisma.$transaction).mockImplementation(async (ops: any) => {
      if (Array.isArray(ops)) return Promise.all(ops)
      return (ops as any)(prisma)
    })
    vi.mocked(prisma.order.updateMany).mockResolvedValue({ count: 2 } as any)
    vi.mocked(prisma.tableTab.update).mockResolvedValue({} as any)

    const res = await discardRestaurantTab(RESTAURANT_ID, 'tab-1')
    expect(res.status).toBe('ok')

    const updateManyCall = vi.mocked(prisma.order.updateMany).mock.calls[0][0]
    expect(updateManyCall.where.id.in).toEqual(['order-1', 'order-2'])
    expect(updateManyCall.data.status).toBe('discarded')

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
      restaurantId: RESTAURANT_ID,
      status: 'open',
      orders: [],
    } as any)
    vi.mocked(prisma.tableTab.update).mockResolvedValue({} as any)

    const res = await discardRestaurantTab(RESTAURANT_ID, 'tab-empty')
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.order.updateMany)).not.toHaveBeenCalled()

    const updateCall = vi.mocked(prisma.tableTab.update).mock.calls[0][0]
    expect(updateCall.data.openTableId).toBeNull()
  })
})
