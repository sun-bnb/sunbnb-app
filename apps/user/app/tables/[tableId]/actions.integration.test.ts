import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// Mock flag — DB flag table is irrelevant to this test scope.
vi.mock('@/app/flags', () => ({ isFlagEnabled: vi.fn().mockResolvedValue(true) }))

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

// calculateTabTotal is tested in packages/data; here we verify DB state, not
// invoice math. Mock it so integration tests remain focused on the ordering flow.
vi.mock('@repo/data/payment', () => ({
  calculateTabTotal: vi.fn().mockResolvedValue({
    ordersTotal: 0,
    serviceFee: 0,
    payableTotal: 0,
    orderIds: [],
  }),
}))

import { auth } from '@/app/auth'
import { calculateTabTotal } from '@repo/data/payment'
import { placeTabOrder, getTabState, getDineContext } from './actions'
import {
  cleanDatabase,
  disconnectDatabase,
  prisma,
} from '@/app/test/setup'
import {
  createTestUser,
  createTestSite,
  createTestPartnerAccount,
  createTestRestaurant,
  createTestTable,
  createTestTableTab,
  createTestMenuItem,
} from '@/app/test/fixtures'
import { ORDER_COMPLETE } from '@repo/data/reservation-status'

const mockAuth = vi.mocked(auth)
const mockCalculateTabTotal = vi.mocked(calculateTabTotal)

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a linked restaurant (site + restaurant, dual-write) + active table. */
async function buildLinkedDineSetup(overrides: {
  siteOverrides?: Record<string, unknown>
  restaurantOverrides?: Record<string, unknown>
  tableOverrides?: Record<string, unknown>
} = {}) {
  const owner = await createTestUser()
  const partnerAccount = await createTestPartnerAccount(owner.id)
  const site = await createTestSite(owner.id, {
    appSalesEnabled: true,
    ...overrides.siteOverrides,
  })
  const restaurant = await createTestRestaurant(partnerAccount.userId, {
    siteId: site.id,
    dineInEnabled: true,
    ...overrides.restaurantOverrides,
  })
  // Update the site to link the restaurant (Site.restaurantId soft FK)
  await prisma.site.update({
    where: { id: site.id },
    data: { restaurantId: restaurant.id },
  })
  const table = await createTestTable(restaurant.id, {
    status: 'active',
    ...overrides.tableOverrides,
  })
  return { owner, partnerAccount, site, restaurant, table }
}

/** Build a standalone restaurant (no Site) + active table. */
async function buildStandaloneDineSetup(overrides: {
  restaurantOverrides?: Record<string, unknown>
  tableOverrides?: Record<string, unknown>
} = {}) {
  const owner = await createTestUser()
  const partnerAccount = await createTestPartnerAccount(owner.id)
  const restaurant = await createTestRestaurant(partnerAccount.userId, {
    siteId: null,
    dineInEnabled: true,
    ...overrides.restaurantOverrides,
  })
  const table = await createTestTable(restaurant.id, {
    status: 'active',
    ...overrides.tableOverrides,
  })
  return { owner, partnerAccount, restaurant, table }
}

// ─── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(async () => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  mockCalculateTabTotal.mockResolvedValue({
    ordersTotal: 0,
    serviceFee: 0,
    payableTotal: 0,
    orderIds: [],
  })
  await cleanDatabase()
})

afterAll(async () => {
  await disconnectDatabase()
})

// ─── placeTabOrder — first order creates the tab (linked venue) ─────────────

describe('placeTabOrder — creates tab on first order (linked venue, dual-write)', () => {
  it('creates a TableTab and Order in the DB for an anonymous caller', async () => {
    const { partnerAccount, site, table, restaurant } = await buildLinkedDineSetup()
    const menuItem = await createTestMenuItem(restaurant.id, {
      price: 5.0,
      totalPrice: 6.0,
      tax: 14,
    })

    const res = await placeTabOrder({
      tableId: table.id,
      anonId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      items: [{ product: { id: menuItem.id }, quantity: 2 }],
    })

    expect(res.status).toBe('ok')
    const { tabId, orderId } = res as any

    // Verify the tab was created with concurrency guard set + siteId dual-write
    const tab = await prisma.tableTab.findUnique({ where: { id: tabId } })
    expect(tab).not.toBeNull()
    expect(tab!.openTableId).toBe(table.id)
    expect(tab!.status).toBe('open')
    expect(tab!.siteId).toBe(site.id)
    expect(tab!.restaurantId).toBe(restaurant.id)

    // Verify the order was created in ORDER_COMPLETE so kitchen sees it
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { orderItems: true },
    })
    expect(order).not.toBeNull()
    expect(order!.status).toBe(ORDER_COMPLETE)
    expect(order!.tabId).toBe(tabId)
    expect(order!.tableId).toBe(table.id)
    expect(order!.siteId).toBe(site.id)
    expect(order!.restaurantId).toBe(restaurant.id)
    expect(order!.anonId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    // Anonymous orders: userId is the restaurant's partner account owner (FK constraint)
    expect(order!.userId).toBe(partnerAccount.userId)
    expect(order!.orderItems).toHaveLength(1)
    expect(order!.orderItems[0].quantity).toBe(2)
    // Price must come from DB: 5.0 × 2
    expect(order!.price).toBe(10.0)
    // totalPrice from DB: 6.0 × 2
    expect(order!.totalPrice).toBe(12.0)
  })

  it('creates order with session user userId (authenticated caller)', async () => {
    const { restaurant, table } = await buildLinkedDineSetup()
    const customer = await createTestUser()
    const menuItem = await createTestMenuItem(restaurant.id, {
      price: 3.0,
      totalPrice: 3.6,
      tax: 14,
    })

    mockAuth.mockResolvedValue({ user: { id: customer.id } } as any)

    const res = await placeTabOrder({
      tableId: table.id,
      items: [{ product: { id: menuItem.id }, quantity: 1 }],
    })

    expect(res.status).toBe('ok')
    const { orderId } = res as any
    const order = await prisma.order.findUnique({ where: { id: orderId } })
    expect(order!.userId).toBe(customer.id)
    expect(order!.anonId).toBeNull()
  })
})

// ─── placeTabOrder — standalone restaurant (no Site) ─────────────────────────

describe('placeTabOrder — standalone restaurant (dine-in v2, no Site)', () => {
  it('creates a TableTab with siteId null and an Order with no site connect', async () => {
    const { partnerAccount, restaurant, table } = await buildStandaloneDineSetup()
    const menuItem = await createTestMenuItem(restaurant.id, {
      price: 4.0,
      totalPrice: 5.0,
      tax: 25,
    })

    const res = await placeTabOrder({
      tableId: table.id,
      anonId: 'aaaaaaaa-1111-0000-0000-000000000001',
      items: [{ product: { id: menuItem.id }, quantity: 1 }],
    })

    expect(res.status).toBe('ok')
    const { tabId, orderId } = res as any

    const tab = await prisma.tableTab.findUnique({ where: { id: tabId } })
    expect(tab!.siteId).toBeNull()
    expect(tab!.restaurantId).toBe(restaurant.id)

    const order = await prisma.order.findUnique({ where: { id: orderId } })
    expect(order!.siteId).toBeNull()
    expect(order!.restaurantId).toBe(restaurant.id)
    expect(order!.userId).toBe(partnerAccount.userId)
    expect(order!.totalPrice).toBe(5.0)
  })

  it('rejects when the restaurant has dineInEnabled false', async () => {
    const { table } = await buildStandaloneDineSetup({
      restaurantOverrides: { dineInEnabled: false },
    })

    const res = await placeTabOrder({
      tableId: table.id,
      anonId: 'aaaaaaaa-1111-0000-0000-000000000002',
      // CUID-shaped so validation passes and the dineInEnabled gate is what fires.
      items: [{ product: { id: 'cnonexistentproduct000000' }, quantity: 1 }],
    })

    expect(res.status).toBe('error')
    expect((res as any).errors[0]).toContain('not available')
  })
})

// ─── placeTabOrder — subsequent orders join the existing tab ─────────────────

describe('placeTabOrder — subsequent orders join the existing tab', () => {
  it('two orders from different callers share the same tab', async () => {
    const { restaurant, table } = await buildLinkedDineSetup()
    const menuItem = await createTestMenuItem(restaurant.id, {
      price: 4.0,
      totalPrice: 4.8,
      tax: 14,
    })

    const res1 = await placeTabOrder({
      tableId: table.id,
      anonId: 'aaaaaaaa-0000-0000-0000-000000000001',
      items: [{ product: { id: menuItem.id }, quantity: 1 }],
    })

    expect(res1.status).toBe('ok')
    const { tabId: tabId1 } = res1 as any

    // Second round — different anonId (another guest at the table)
    const res2 = await placeTabOrder({
      tableId: table.id,
      anonId: 'aaaaaaaa-0000-0000-0000-000000000002',
      items: [{ product: { id: menuItem.id }, quantity: 2 }],
    })

    expect(res2.status).toBe('ok')
    const { tabId: tabId2, orderId: orderId2 } = res2 as any

    // Must share the same tab
    expect(tabId2).toBe(tabId1)

    const order2 = await prisma.order.findUnique({ where: { id: orderId2 } })
    expect(order2!.tabId).toBe(tabId1)
  })

  it('getTabState totals reflect both rounds accumulating on the tab', async () => {
    const { restaurant, table } = await buildLinkedDineSetup()
    const beer = await createTestMenuItem(restaurant.id, {
      name: 'Beer',
      price: 4.0,
      totalPrice: 4.8,
      tax: 14,
    })
    const water = await createTestMenuItem(restaurant.id, {
      name: 'Water',
      price: 2.0,
      totalPrice: 2.4,
      tax: 14,
    })

    await placeTabOrder({
      tableId: table.id,
      anonId: 'aaaaaaaa-0000-0000-0000-000000000001',
      items: [{ product: { id: beer.id }, quantity: 2 }],
    })

    await placeTabOrder({
      tableId: table.id,
      anonId: 'aaaaaaaa-0000-0000-0000-000000000002',
      items: [{ product: { id: water.id }, quantity: 3 }],
    })

    // calculateTabTotal is mocked; verify that both orders are on the tab
    const tab = await prisma.tableTab.findFirst({ where: { openTableId: table.id } })
    expect(tab).not.toBeNull()

    const orders = await prisma.order.findMany({ where: { tabId: tab!.id } })
    expect(orders).toHaveLength(2)

    // Verify DB prices: 4.8×2 = 9.6 and 2.4×3 = 7.2
    const totalPrices = orders.map((o) => o.totalPrice).sort()
    expect(totalPrices[0]).toBeCloseTo(7.2, 2)
    expect(totalPrices[1]).toBeCloseTo(9.6, 2)
  })
})

// ─── placeTabOrder — pending_payment tab rejects ──────────────────────────────

describe('placeTabOrder — pending_payment tab blocks new orders', () => {
  it('returns error when the tab is awaiting payment', async () => {
    const { restaurant, site, table } = await buildLinkedDineSetup()
    const menuItem = await createTestMenuItem(restaurant.id, {
      price: 5.0,
      totalPrice: 6.0,
      tax: 14,
    })

    // Manually create a tab in pending_payment state
    // openTableId is set (the tab is "logically open" for the concurrency guard)
    await createTestTableTab(table.id, site.id, {
      restaurantId: restaurant.id,
      status: 'pending_payment',
      openTableId: table.id,
    })

    const res = await placeTabOrder({
      tableId: table.id,
      anonId: 'aaaaaaaa-0000-0000-0000-000000000001',
      items: [{ product: { id: menuItem.id }, quantity: 1 }],
    })

    expect(res.status).toBe('error')
    expect((res as any).errors[0]).toContain('payment')

    // No order must have been created
    const orderCount = await prisma.order.count({ where: { restaurantId: restaurant.id } })
    expect(orderCount).toBe(0)
  })
})

// ─── placeTabOrder — closed tab triggers fresh tab ───────────────────────────

describe('placeTabOrder — new tab after previous tab is closed', () => {
  it('opens a new tab when the previous one is paid (openTableId nulled)', async () => {
    const { restaurant, site, table } = await buildLinkedDineSetup()
    const menuItem = await createTestMenuItem(restaurant.id, {
      price: 5.0,
      totalPrice: 6.0,
      tax: 14,
    })

    // Simulate a paid (closed) tab: status=paid, openTableId=null
    await createTestTableTab(table.id, site.id, {
      restaurantId: restaurant.id,
      status: 'paid',
      openTableId: null,
    })

    // First order on the "fresh" session — should open a new tab
    const res = await placeTabOrder({
      tableId: table.id,
      anonId: 'aaaaaaaa-0000-0000-0000-000000000001',
      items: [{ product: { id: menuItem.id }, quantity: 1 }],
    })

    expect(res.status).toBe('ok')
    const { tabId } = res as any

    // New tab must have openTableId set (its the active guard)
    const newTab = await prisma.tableTab.findUnique({ where: { id: tabId } })
    expect(newTab!.openTableId).toBe(table.id)
    expect(newTab!.status).toBe('open')

    // Two tabs total: the old paid one + the new open one
    const tabCount = await prisma.tableTab.count({ where: { tableId: table.id } })
    expect(tabCount).toBe(2)
  })
})

// ─── getTabState ──────────────────────────────────────────────────────────────

describe('getTabState', () => {
  it('returns null tab when no open tab exists', async () => {
    const { table } = await buildLinkedDineSetup()

    const res = await getTabState(table.id)

    expect(res.status).toBe('ok')
    expect((res as any).tab).toBeNull()
  })

  it('returns tab with orders and calls calculateTabTotal', async () => {
    const { restaurant, table } = await buildLinkedDineSetup()
    const menuItem = await createTestMenuItem(restaurant.id, {
      price: 5.0,
      totalPrice: 6.0,
      tax: 14,
    })

    const placeRes = await placeTabOrder({
      tableId: table.id,
      anonId: 'aaaaaaaa-0000-0000-0000-000000000001',
      items: [{ product: { id: menuItem.id }, quantity: 2 }],
    })
    expect(placeRes.status).toBe('ok')
    const { tabId } = placeRes as any

    mockCalculateTabTotal.mockResolvedValueOnce({
      ordersTotal: 12.0,
      serviceFee: 1.0,
      payableTotal: 13.0,
      orderIds: [(placeRes as any).orderId],
    })

    const res = await getTabState(table.id)

    expect(res.status).toBe('ok')
    const tab = (res as any).tab
    expect(tab.id).toBe(tabId)
    expect(tab.status).toBe('open')
    expect(tab.orders).toHaveLength(1)
    expect(tab.orders[0].items).toHaveLength(1)
    expect(tab.orders[0].items[0].quantity).toBe(2)
    expect(tab.totals.ordersTotal).toBe(12.0)
    expect(tab.totals.serviceFee).toBe(1.0)
    expect(tab.totals.payableTotal).toBe(13.0)
    expect(mockCalculateTabTotal).toHaveBeenCalledWith(tabId)
  })

  it('finds a standalone-restaurant tab (openTableId only, no siteId filter)', async () => {
    const { restaurant, table } = await buildStandaloneDineSetup()
    const menuItem = await createTestMenuItem(restaurant.id, {
      price: 5.0,
      totalPrice: 6.0,
      tax: 14,
    })

    const placeRes = await placeTabOrder({
      tableId: table.id,
      anonId: 'aaaaaaaa-0000-0000-0000-000000000001',
      items: [{ product: { id: menuItem.id }, quantity: 1 }],
    })
    expect(placeRes.status).toBe('ok')

    const res = await getTabState(table.id)

    expect(res.status).toBe('ok')
    expect((res as any).tab?.id).toBe((placeRes as any).tabId)
  })
})

// ─── getDineContext ───────────────────────────────────────────────────────────

describe('getDineContext', () => {
  it('returns restaurant, table, and active MenuItem products (linked venue)', async () => {
    const { restaurant, table } = await buildLinkedDineSetup()
    const beer = await createTestMenuItem(restaurant.id, {
      name: 'Beer',
      price: 4.0,
      totalPrice: 4.8,
      tax: 14,
      active: true,
    })
    await createTestMenuItem(restaurant.id, { name: 'Inactive', active: false })

    const res = await getDineContext(table.id)

    expect(res.status).toBe('ok')
    const ctx = (res as any).context
    expect(ctx.restaurant.id).toBe(restaurant.id)
    expect(ctx.table.id).toBe(table.id)
    // Only active products returned
    expect(ctx.products).toHaveLength(1)
    expect(ctx.products[0].id).toBe(beer.id)
  })

  it('returns restaurant, table, and menu for a standalone restaurant (no Site)', async () => {
    const { restaurant, table } = await buildStandaloneDineSetup()
    const dish = await createTestMenuItem(restaurant.id, {
      name: 'Paella',
      price: 12.0,
      totalPrice: 15.0,
      tax: 25,
    })

    const res = await getDineContext(table.id)

    expect(res.status).toBe('ok')
    const ctx = (res as any).context
    expect(ctx.restaurant.id).toBe(restaurant.id)
    expect(ctx.products).toHaveLength(1)
    expect(ctx.products[0].id).toBe(dish.id)
    expect(ctx.products[0].totalPrice).toBe(15.0)
  })

  it('returns error when the table does not exist', async () => {
    const res = await getDineContext('cnonexistenttable00000000')

    expect(res.status).toBe('error')
    expect((res as any).errors).toContain('Table not found or unavailable')
  })

  it('returns error when restaurant.dineInEnabled is false', async () => {
    const { table } = await buildLinkedDineSetup({ restaurantOverrides: { dineInEnabled: false } })

    const res = await getDineContext(table.id)

    expect(res.status).toBe('error')
    expect((res as any).errors[0]).toContain('not available')
  })
})
