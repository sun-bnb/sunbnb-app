import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { setOrderStatus, getOrders } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

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
