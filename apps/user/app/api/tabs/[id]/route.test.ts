/**
 * Tests for GET /api/tabs/[id]
 *
 * Poll-fallback route for dine-in tab payment status.
 * Mirrors patterns from app/api/orders/[id]/route.test.ts.
 * No ownership check — QR-URL-as-credential model.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks must be declared before imports ─────────────────────────────────────

const { mockGetPaymentStatus, mockIsPaymentSucceeded, mockIsPaymentFailed } = vi.hoisted(() => ({
  mockGetPaymentStatus: vi.fn(),
  mockIsPaymentSucceeded: vi.fn(),
  mockIsPaymentFailed: vi.fn(),
}))

vi.mock('@/app/api/_lib/payment-provider', () => ({
  getPaymentStatus: mockGetPaymentStatus,
  isPaymentSucceeded: mockIsPaymentSucceeded,
  isPaymentFailed: mockIsPaymentFailed,
}))

// ── Import after mocks ────────────────────────────────────────────────────────
import { GET } from './route'
import prisma from '@repo/data/PrismaCient'
import { processConfirmedTabPayment } from '@repo/data/payment'

const mockProcessTabPayment = vi.mocked(processConfirmedTabPayment)

// ── Constants ─────────────────────────────────────────────────────────────────
const VALID_TAB_ID = 'clxk0000000000000000000001'

function makeRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost:3002/api/tabs/${id}`)
}

function makeParams(id: string) {
  return { params: { id } }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: payment provider returns non-terminal (in-flight)
  mockIsPaymentSucceeded.mockReturnValue(false)
  mockIsPaymentFailed.mockReturnValue(false)
})

describe('GET /api/tabs/[id]', () => {
  // ── Validation ─────────────────────────────────────────────────────────────

  it('returns 400 for invalid ID format', async () => {
    const res = await GET(makeRequest('bad!!id'), makeParams('bad!!id'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid')
  })

  it('returns 404 when tab does not exist', async () => {
    vi.mocked(prisma.tableTab.findUnique).mockResolvedValue(null)

    const res = await GET(makeRequest(VALID_TAB_ID), makeParams(VALID_TAB_ID))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toContain('not found')
  })

  // ── Open tab passthrough ──────────────────────────────────────────────────

  it('returns current state immediately when tab is open (no payment ref)', async () => {
    vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({
      id: VALID_TAB_ID,
      status: 'open',
      paymentRef: null,
      closedAt: null,
    } as any)

    const res = await GET(makeRequest(VALID_TAB_ID), makeParams(VALID_TAB_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(VALID_TAB_ID)
    expect(body.status).toBe('open')
    expect(body.closedAt).toBeNull()

    // No payment provider check when no paymentRef
    expect(mockGetPaymentStatus).not.toHaveBeenCalled()
  })

  // ── Paid tab passthrough ───────────────────────────────────────────────────

  it('returns TAB_PAID state without calling the provider (tab is terminal)', async () => {
    const closedAt = new Date('2026-07-19T15:00:00Z')
    vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({
      id: VALID_TAB_ID,
      status: 'paid',
      paymentRef: 'tr_abc',
      closedAt,
    } as any)

    const res = await GET(makeRequest(VALID_TAB_ID), makeParams(VALID_TAB_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('paid')
    expect(mockGetPaymentStatus).not.toHaveBeenCalled()
    expect(mockProcessTabPayment).not.toHaveBeenCalled()
  })

  // ── Pending + succeeded ────────────────────────────────────────────────────

  it('processes the tab when pending_payment and provider says succeeded', async () => {
    vi.mocked(prisma.tableTab.findUnique)
      .mockResolvedValueOnce({
        id: VALID_TAB_ID,
        status: 'pending_payment',
        paymentRef: 'tr_abc',
        closedAt: null,
      } as any)
      .mockResolvedValueOnce({
        id: VALID_TAB_ID,
        status: 'paid',
        paymentRef: 'tr_abc',
        closedAt: new Date('2026-07-19T15:01:00Z'),
      } as any)

    mockGetPaymentStatus.mockResolvedValue('paid')
    mockIsPaymentSucceeded.mockReturnValue(true)

    const res = await GET(makeRequest(VALID_TAB_ID), makeParams(VALID_TAB_ID))
    expect(res.status).toBe(200)
    expect(mockProcessTabPayment).toHaveBeenCalledWith(VALID_TAB_ID)

    const body = await res.json()
    expect(body.status).toBe('paid')
  })

  // ── Pending + failed ──────────────────────────────────────────────────────

  it('reverts tab to open when pending_payment and provider says failed', async () => {
    vi.mocked(prisma.tableTab.findUnique)
      .mockResolvedValueOnce({
        id: VALID_TAB_ID,
        status: 'pending_payment',
        paymentRef: 'tr_abc',
        closedAt: null,
      } as any)
      .mockResolvedValueOnce({
        id: VALID_TAB_ID,
        status: 'open',
        paymentRef: null,
        closedAt: null,
      } as any)

    mockGetPaymentStatus.mockResolvedValue('failed')
    mockIsPaymentFailed.mockReturnValue(true)
    vi.mocked(prisma.tableTab.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await GET(makeRequest(VALID_TAB_ID), makeParams(VALID_TAB_ID))
    expect(res.status).toBe(200)

    // Guard: only reverts if still pending_payment (prevents reopening a paid tab)
    expect(prisma.tableTab.updateMany).toHaveBeenCalledWith({
      where: { id: VALID_TAB_ID, status: 'pending_payment' },
      data: { status: 'open', paymentRef: null },
    })
    expect(mockProcessTabPayment).not.toHaveBeenCalled()

    const body = await res.json()
    expect(body.status).toBe('open')
  })

  // ── Provider error tolerance ───────────────────────────────────────────────

  it('returns current tab state (not 500) when provider throws a transient error', async () => {
    vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({
      id: VALID_TAB_ID,
      status: 'pending_payment',
      paymentRef: 'tr_abc',
      closedAt: null,
    } as any)

    mockGetPaymentStatus.mockRejectedValue(new Error('Mollie API timeout'))

    const res = await GET(makeRequest(VALID_TAB_ID), makeParams(VALID_TAB_ID))
    // Must NOT 500 — return current state so the UI can retry
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('pending_payment')
  })

  // ── Minimal DTO ───────────────────────────────────────────────────────────

  it('returns only id, status, closedAt (not full orders or attribution)', async () => {
    vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({
      id: VALID_TAB_ID,
      status: 'open',
      paymentRef: null,
      closedAt: null,
    } as any)

    const res = await GET(makeRequest(VALID_TAB_ID), makeParams(VALID_TAB_ID))
    const body = await res.json()

    // Only minimal DTO fields — no orders/attribution
    expect(Object.keys(body)).toEqual(expect.arrayContaining(['id', 'status', 'closedAt']))
    expect(body).not.toHaveProperty('paymentRef')
    expect(body).not.toHaveProperty('orders')
    expect(body).not.toHaveProperty('anonId')
    expect(body).not.toHaveProperty('userId')
  })

  // ── No ownership check ────────────────────────────────────────────────────

  it('returns data without any auth check (QR-URL-as-credential model)', async () => {
    // No session, no auth header — route succeeds with just the tab CUID
    vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({
      id: VALID_TAB_ID,
      status: 'open',
      paymentRef: null,
      closedAt: null,
    } as any)

    const res = await GET(makeRequest(VALID_TAB_ID), makeParams(VALID_TAB_ID))
    expect(res.status).toBe(200)
  })
})
