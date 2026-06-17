import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { setOrderStatus, getOrders, toggleProductSoldOut } from './actions'
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
