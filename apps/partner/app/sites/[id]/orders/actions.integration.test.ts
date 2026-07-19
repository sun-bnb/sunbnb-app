import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { auth } from '@/app/auth'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import {
  createTestUser,
  createTestSite,
  createTestPartnerAccount,
  createTestRestaurant,
  createTestTable,
  createTestProduct,
} from '@/app/test/fixtures'
import { setOrderStatus, getOrders, getOpenTabs, settleTabCash, discardTab } from './actions'

const mockAuth = vi.mocked(auth)

function mockSession(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId } } as any)
}

async function createOrder(userId: string, siteId: string, status = 'complete') {
  return prisma.order.create({
    data: {
      userId,
      siteId,
      status,
      price: 10,
      tax: 1,
      totalPrice: 11,
      paymentAmount: 11,
    },
  })
}

let owner: any
let site: any
let otherUser: any
let otherSite: any

beforeAll(async () => {
  await cleanDatabase()
})

beforeEach(async () => {
  mockAuth.mockResolvedValue(null)
  await cleanDatabase()
  owner = await createTestUser({ name: 'Owner' })
  site = await createTestSite(owner.id)
  otherUser = await createTestUser({ name: 'Other' })
  otherSite = await createTestSite(otherUser.id)
})

afterAll(async () => {
  await cleanDatabase()
  await disconnectDatabase()
})

// ---------------------------------------------------------------------------
// setOrderStatus
// ---------------------------------------------------------------------------

describe('setOrderStatus', () => {
  it('walks through the full happy path: complete -> accepted -> preparing -> ready -> delivered -> completed', async () => {
    mockSession(owner.id)
    const order = await createOrder(owner.id, site.id, 'complete')

    const transitions = ['accepted', 'preparing', 'ready', 'delivered', 'completed']
    for (const next of transitions) {
      const res = await setOrderStatus(site.id, order.id, next)
      expect(res.status).toBe('ok')
      const dbOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
      expect(dbOrder.status).toBe(next)
    }
  })

  it('rejects skipping steps (complete -> ready)', async () => {
    mockSession(owner.id)
    const order = await createOrder(owner.id, site.id, 'complete')

    const res = await setOrderStatus(site.id, order.id, 'ready')
    expect(res.status).toBe('error')
    expect(res.errors![0]).toContain('Cannot transition')

    const dbOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(dbOrder.status).toBe('complete')
  })

  it('rejects backward transition (delivered -> accepted)', async () => {
    mockSession(owner.id)
    const order = await createOrder(owner.id, site.id, 'delivered')

    const res = await setOrderStatus(site.id, order.id, 'accepted')
    expect(res.status).toBe('error')
    expect(res.errors![0]).toContain('Cannot transition')

    const dbOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(dbOrder.status).toBe('delivered')
  })

  it('sets acceptedAt timestamp on accept', async () => {
    mockSession(owner.id)
    const order = await createOrder(owner.id, site.id, 'complete')
    const before = new Date()

    await setOrderStatus(site.id, order.id, 'accepted')

    const dbOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(dbOrder.acceptedAt).toBeInstanceOf(Date)
    expect(dbOrder.acceptedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000)
  })

  it('sets readyAt timestamp on ready', async () => {
    mockSession(owner.id)
    const order = await createOrder(owner.id, site.id, 'preparing')
    const before = new Date()

    await setOrderStatus(site.id, order.id, 'ready')

    const dbOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(dbOrder.readyAt).toBeInstanceOf(Date)
    expect(dbOrder.readyAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000)
  })

  it('stores rejectReason when rejecting', async () => {
    mockSession(owner.id)
    const order = await createOrder(owner.id, site.id, 'complete')

    const res = await setOrderStatus(site.id, order.id, 'rejected', 'Out of stock')
    expect(res.status).toBe('ok')

    const dbOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(dbOrder.status).toBe('rejected')
    expect(dbOrder.rejectReason).toBe('Out of stock')
  })

  it('allows discard from any active status', async () => {
    mockSession(owner.id)

    const activeStatuses = ['complete', 'accepted', 'preparing', 'ready', 'delivered'] as const
    for (const from of activeStatuses) {
      const order = await createOrder(owner.id, site.id, from)
      const res = await setOrderStatus(site.id, order.id, 'discarded')
      expect(res.status).toBe('ok')
      const dbOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
      expect(dbOrder.status).toBe('discarded')
    }
  })

  it('rejects when order belongs to a different site', async () => {
    mockSession(owner.id)
    const order = await createOrder(otherUser.id, otherSite.id, 'complete')

    const res = await setOrderStatus(site.id, order.id, 'accepted')
    expect(res.status).toBe('error')
    expect(res.errors![0]).toBe('Order not found')

    const dbOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(dbOrder.status).toBe('complete')
  })

  it('rejects non-owner', async () => {
    mockSession(otherUser.id)
    const order = await createOrder(owner.id, site.id, 'complete')

    const res = await setOrderStatus(site.id, order.id, 'accepted')
    expect(res.status).toBe('error')
    expect(res.errors![0]).toBe('Not authorized')

    const dbOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(dbOrder.status).toBe('complete')
  })
})

// ---------------------------------------------------------------------------
// getOrders
// ---------------------------------------------------------------------------

describe('getOrders', () => {
  it("returns only 'complete' status orders for 'incoming' tab", async () => {
    mockSession(owner.id)
    const o1 = await createOrder(owner.id, site.id, 'complete')
    await createOrder(owner.id, site.id, 'accepted')
    await createOrder(owner.id, site.id, 'delivered')

    const res = await getOrders(site.id, 'incoming')
    expect(res.status).toBe('ok')
    expect(res.orders).toHaveLength(1)
    expect(res.orders![0].id).toBe(o1.id)
  })

  it("returns only 'accepted'/'preparing' for 'active' tab", async () => {
    mockSession(owner.id)
    const o1 = await createOrder(owner.id, site.id, 'accepted')
    const o2 = await createOrder(owner.id, site.id, 'preparing')
    await createOrder(owner.id, site.id, 'complete')
    await createOrder(owner.id, site.id, 'ready')

    const res = await getOrders(site.id, 'active')
    expect(res.status).toBe('ok')
    expect(res.orders).toHaveLength(2)
    const ids = res.orders!.map((o: any) => o.id)
    expect(ids).toContain(o1.id)
    expect(ids).toContain(o2.id)
  })

  it('returns empty for tab with no matching orders', async () => {
    mockSession(owner.id)
    await createOrder(owner.id, site.id, 'complete')

    const res = await getOrders(site.id, 'history')
    expect(res.status).toBe('ok')
    expect(res.orders).toHaveLength(0)
  })

  it('does not return orders from other sites', async () => {
    mockSession(owner.id)
    await createOrder(otherUser.id, otherSite.id, 'complete')
    await createOrder(owner.id, site.id, 'complete')

    const res = await getOrders(site.id, 'incoming')
    expect(res.status).toBe('ok')
    expect(res.orders).toHaveLength(1)
    expect(res.orders![0].siteId).toBe(site.id)
  })
})

// ---------------------------------------------------------------------------
// Dine-in tabs: getOpenTabs / settleTabCash / discardTab (track 002 P1.5 ph.5)
// ---------------------------------------------------------------------------

describe('dine-in tab actions (integration)', () => {
  /**
   * Owner + site come from the outer beforeEach. Adds the restaurant/table/tab
   * substrate plus tab order rounds with real order items (the PARTNER receipt
   * lines are built from orderItems, so items must exist for settle).
   */
  async function setupTabWithRounds(tabStatus = 'open') {
    await createTestPartnerAccount(owner.id)
    const restaurant = await createTestRestaurant(owner.id, { siteId: site.id })
    const table = await createTestTable(restaurant.id)
    const product = await createTestProduct(site.id)
    const tab = await prisma.tableTab.create({
      data: {
        tableId: table.id,
        restaurantId: restaurant.id,
        siteId: site.id,
        status: tabStatus,
        openTableId: tabStatus === 'open' || tabStatus === 'pending_payment' ? table.id : null,
      },
    })

    // Two rounds in kitchen states, one voided round (must not be billed).
    const round1 = await prisma.order.create({
      data: {
        userId: owner.id, siteId: site.id, tabId: tab.id, tableId: table.id,
        status: 'delivered', price: 20, tax: 2.8, totalPrice: 22.8, paymentAmount: 22.8,
        orderItems: { create: [{ productId: product.id, name: 'Paella', quantity: 2, price: 20, tax: 14, totalPrice: 22.8, category: 'food' }] },
      },
    })
    const round2 = await prisma.order.create({
      data: {
        userId: owner.id, siteId: site.id, tabId: tab.id, tableId: table.id,
        status: 'complete', price: 10, tax: 1.4, totalPrice: 11.4, paymentAmount: 11.4,
        orderItems: { create: [{ productId: product.id, name: 'Sangria', quantity: 1, price: 10, tax: 14, totalPrice: 11.4, category: 'drinks' }] },
      },
    })
    const voided = await prisma.order.create({
      data: {
        userId: owner.id, siteId: site.id, tabId: tab.id, tableId: table.id,
        status: 'canceled', price: 5, tax: 0.7, totalPrice: 5.7, paymentAmount: 5.7,
        orderItems: { create: [{ productId: product.id, name: 'Flan', quantity: 1, price: 5, tax: 14, totalPrice: 5.7, category: 'food' }] },
      },
    })

    return { restaurant, table, tab, round1, round2, voided }
  }

  it('getOpenTabs lists open tabs with void-excluded amount due', async () => {
    mockSession(owner.id)
    const { tab } = await setupTabWithRounds()

    const res = await getOpenTabs(site.id)

    expect(res.status).toBe('ok')
    expect(res.tabs).toHaveLength(1)
    expect(res.tabs![0].id).toBe(tab.id)
    expect(res.tabs![0].roundsCount).toBe(2)          // voided round excluded
    expect(res.tabs![0].amountDue).toBe(34.2)         // 22.8 + 11.4, not 5.7
  })

  it('settleTabCash creates exactly one PARTNER invoice (no PLATFORM), closes the tab, preserves kitchen states', async () => {
    mockSession(owner.id)
    const { tab, round1, round2 } = await setupTabWithRounds()

    const res = await settleTabCash(site.id, tab.id)

    expect(res.status).toBe('ok')
    expect(res.amountDue).toBe(34.2)

    const invoices = await prisma.invoice.findMany({ where: { tableTabId: tab.id } })
    expect(invoices).toHaveLength(1)
    expect(invoices[0]!.issuerType).toBe('PARTNER')
    expect(invoices[0]!.totalAmount).toBe(34.2)
    expect(invoices[0]!.paymentRef).toBeNull()

    const closed = await prisma.tableTab.findUnique({ where: { id: tab.id } })
    expect(closed!.status).toBe('settled_cash')
    expect(closed!.openTableId).toBeNull()
    expect(closed!.closedAt).not.toBeNull()

    // Kitchen lifecycle untouched; no paymentRef stamped for cash.
    const o1 = await prisma.order.findUnique({ where: { id: round1.id } })
    const o2 = await prisma.order.findUnique({ where: { id: round2.id } })
    expect(o1!.status).toBe('delivered')
    expect(o2!.status).toBe('complete')
    expect(o1!.paymentRef).toBeNull()
  })

  it('settleTabCash is terminal-guarded: second call errors and invoice count stays 1', async () => {
    mockSession(owner.id)
    const { tab } = await setupTabWithRounds()

    await settleTabCash(site.id, tab.id)
    const second = await settleTabCash(site.id, tab.id)

    expect(second.status).toBe('error')
    expect(second.errors).toEqual(['Tab is already closed'])
    const invoices = await prisma.invoice.findMany({ where: { tableTabId: tab.id } })
    expect(invoices).toHaveLength(1)
  })

  it('settleTabCash and discardTab reject a pending_payment tab (online payment mid-flight)', async () => {
    mockSession(owner.id)
    const { tab } = await setupTabWithRounds('pending_payment')

    const settle = await settleTabCash(site.id, tab.id)
    const discard = await discardTab(site.id, tab.id)

    expect(settle.status).toBe('error')
    expect(settle.errors![0]).toMatch(/online payment is in progress/)
    expect(discard.status).toBe('error')
    const untouched = await prisma.tableTab.findUnique({ where: { id: tab.id } })
    expect(untouched!.status).toBe('pending_payment')
    expect(await prisma.invoice.count({ where: { tableTabId: tab.id } })).toBe(0)
  })

  it('settleTabCash rejects a tab belonging to another site', async () => {
    mockSession(owner.id)
    const { tab } = await setupTabWithRounds()

    mockSession(otherUser.id)
    const res = await settleTabCash(otherSite.id, tab.id)

    expect(res.status).toBe('error')
    expect(res.errors).toEqual(['Tab not found'])
    expect(await prisma.invoice.count({ where: { tableTabId: tab.id } })).toBe(0)
  })

  it('discardTab voids the rounds, closes the tab, creates no invoice, releases openTableId', async () => {
    mockSession(owner.id)
    const { tab, table, round1, round2 } = await setupTabWithRounds()

    const res = await discardTab(site.id, tab.id)

    expect(res.status).toBe('ok')
    const closed = await prisma.tableTab.findUnique({ where: { id: tab.id } })
    expect(closed!.status).toBe('discarded')
    expect(closed!.openTableId).toBeNull()
    expect(closed!.closedAt).not.toBeNull()

    const o1 = await prisma.order.findUnique({ where: { id: round1.id } })
    const o2 = await prisma.order.findUnique({ where: { id: round2.id } })
    expect(o1!.status).toBe('discarded')
    expect(o2!.status).toBe('discarded')

    expect(await prisma.invoice.count({ where: { tableTabId: tab.id } })).toBe(0)

    // Guard released: a new tab can open on the same table immediately.
    const newTab = await prisma.tableTab.create({
      data: {
        tableId: table.id,
        restaurantId: closed!.restaurantId,
        siteId: site.id,
        status: 'open',
        openTableId: table.id,
      },
    })
    expect(newTab.openTableId).toBe(table.id)
  })
})
