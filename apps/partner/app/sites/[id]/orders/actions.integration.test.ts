import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { auth } from '@/app/auth'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import { createTestUser, createTestSite } from '@/app/test/fixtures'
import { setOrderStatus, getOrders } from './actions'

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
