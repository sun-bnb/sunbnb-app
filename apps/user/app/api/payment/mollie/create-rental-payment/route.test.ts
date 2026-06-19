/**
 * Tests for POST /api/payment/mollie/create-rental-payment
 *
 * Focus on the ownership bug fix (Phase 2 of track 009):
 *   BEFORE: anon callers (no identity.userId) skipped the ownership check entirely.
 *   AFTER:  verifyOwnership(identity, booking) is called for every booking,
 *           so a wrong or missing anonId is always rejected.
 *
 * Bug-revealing test: "rejects anon caller with wrong anonId" fails before the fix
 * (the old userId-only guard let it through), and passes after.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/app/api/_lib/payment-ids', () => ({
  isDemoPayment: (ref: string | null) => ref?.startsWith('pi_demo_') ?? false,
  isValidEntityId: () => true,
}))

vi.mock('@repo/data/payment', () => ({
  loadFeeContext: vi.fn(),
  resolveServiceFee: vi.fn().mockReturnValue(null),
  calculateServiceFeeAmount: vi.fn().mockReturnValue(0),
  round: (v: number) => Math.round(v * 100) / 100,
}))

vi.mock('@repo/data/env', () => ({
  isTestMode: vi.fn().mockReturnValue(false),
}))

vi.mock('@/app/api/_lib/mollie', () => ({
  getMollieClientForPartner: vi.fn(),
  getValidMollieToken: vi.fn(),
}))

import { POST } from './route'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { loadFeeContext } from '@repo/data/payment'
import { getMollieClientForPartner, getValidMollieToken } from '@/app/api/_lib/mollie'

const mockAuth = vi.mocked(auth)
const mockFindMany = vi.mocked(prisma.rentalBooking.findMany)
const mockLoadFeeContext = vi.mocked(loadFeeContext)
const mockGetMollieClient = vi.mocked(getMollieClientForPartner)
const mockGetValidToken = vi.mocked(getValidMollieToken)

// A valid UUID v4 to use as anonId throughout tests
const ANON_ID = '550e8400-e29b-41d4-a716-446655440000'
const OTHER_ANON_ID = '660e8400-e29b-41d4-a716-446655440001'
const OWNER_USER_ID = 'site-owner-user'

/** Build a minimal valid POST body */
function makeBody(overrides: Record<string, unknown> = {}) {
  return {
    rentalBookingIds: ['rb-1'],
    redirectUrl: 'https://local.sunbnb.app:3002/payment/complete/rental',
    ...overrides,
  }
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3002/api/payment/mollie/create-rental-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** A booking owned by an anon user (anonId set, userId = site owner FK) */
function makeAnonBooking(anonId: string) {
  return {
    id: 'rb-1',
    siteId: 'site-1',
    userId: OWNER_USER_ID,   // FK placeholder — not the actual customer
    anonId,
    paymentRef: null,
    status: 'pending',
    paymentAmount: 20,
    totalPrice: 20,
  }
}

/** A booking owned by a logged-in user (anonId null) */
function makeUserBooking(userId: string) {
  return {
    id: 'rb-1',
    siteId: 'site-1',
    userId,
    anonId: null,
    paymentRef: null,
    status: 'pending',
    paymentAmount: 20,
    totalPrice: 20,
  }
}

// Set APP_URL so the redirectUrl validator accepts our test URL
beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  process.env.APP_URL = 'https://local.sunbnb.app:3002'
})

describe('POST /api/payment/mollie/create-rental-payment — ownership check', () => {
  // ── Bug-revealing test ─────────────────────────────────────────────────────
  //
  // Before the fix the guard was:
  //   if (identity.userId && booking.userId !== identity.userId) { reject }
  // An anon caller has identity.userId = undefined, so the condition was
  // never true — any anon (including the wrong one) was let through.
  //
  // After the fix: verifyOwnership(identity, booking) is called; it returns
  // false when identity.anonId !== booking.anonId → 403.

  it('rejects anon caller with wrong anonId (bug: was silently allowed before fix)', async () => {
    // Caller presents OTHER_ANON_ID but the booking belongs to ANON_ID
    mockFindMany.mockResolvedValue([makeAnonBooking(ANON_ID)] as any)

    const req = makeRequest(makeBody({ anonId: OTHER_ANON_ID }))
    const res = await POST(req)

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('Not authorized')
  })

  it('rejects anon caller with no anonId when booking has anonId', async () => {
    // No anonId in body at all → identity is null → 401
    mockFindMany.mockResolvedValue([makeAnonBooking(ANON_ID)] as any)

    const req = makeRequest(makeBody({ anonId: undefined }))
    const res = await POST(req)

    // No identity can be established → 401 (not 403)
    expect(res.status).toBe(401)
  })

  it('accepts anon caller with the correct anonId', async () => {
    mockFindMany.mockResolvedValue([makeAnonBooking(ANON_ID)] as any)

    // loadFeeContext + Mollie chain — stub enough to reach the checkout step
    mockLoadFeeContext.mockResolvedValue({
      site: { id: 'site-1', serviceFees: [] },
      partnerAccount: {
        userId: OWNER_USER_ID,
        mollieAccessToken: 'tok',
        mollieProfileId: 'pfl_test',
        subscription: null,
        serviceFees: [],
      },
      settings: null,
    } as any)
    mockGetValidToken.mockResolvedValue('valid-token')
    const mockMollie = {
      payments: {
        create: vi.fn().mockResolvedValue({
          id: 'tr_test',
          getCheckoutUrl: () => 'https://checkout.mollie.com/test',
        }),
      },
    }
    mockGetMollieClient.mockReturnValue(mockMollie as any)
    vi.mocked(prisma.rentalBooking.updateMany).mockResolvedValue({ count: 1 } as any)

    const req = makeRequest(makeBody({ anonId: ANON_ID }))
    const res = await POST(req)

    // Should proceed past ownership and reach Mollie — 200 with checkoutUrl
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.checkoutUrl).toBe('https://checkout.mollie.com/test')
  })

  it('accepts authenticated user who owns the booking', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockFindMany.mockResolvedValue([makeUserBooking('user-1')] as any)

    mockLoadFeeContext.mockResolvedValue({
      site: { id: 'site-1', serviceFees: [] },
      partnerAccount: {
        userId: 'user-1',
        mollieAccessToken: 'tok',
        mollieProfileId: 'pfl_test',
        subscription: null,
        serviceFees: [],
      },
      settings: null,
    } as any)
    mockGetValidToken.mockResolvedValue('valid-token')
    const mockMollie = {
      payments: {
        create: vi.fn().mockResolvedValue({
          id: 'tr_test',
          getCheckoutUrl: () => 'https://checkout.mollie.com/test',
        }),
      },
    }
    mockGetMollieClient.mockReturnValue(mockMollie as any)
    vi.mocked(prisma.rentalBooking.updateMany).mockResolvedValue({ count: 1 } as any)

    const req = makeRequest(makeBody())
    const res = await POST(req)

    expect(res.status).toBe(200)
  })

  it('rejects authenticated user who does not own the booking', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    // Booking belongs to user-2
    mockFindMany.mockResolvedValue([makeUserBooking('user-2')] as any)

    const req = makeRequest(makeBody())
    const res = await POST(req)

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('Not authorized')
  })

  it('rejects unauthenticated request with no identity at all', async () => {
    // No session, no anonId in body
    const req = makeRequest(makeBody())
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  // ── Multi-booking group: verify EACH booking ────────────────────────────────

  it('rejects when second booking in group has wrong anonId', async () => {
    // Two bookings: rb-1 belongs to ANON_ID, rb-2 belongs to OTHER_ANON_ID
    mockFindMany.mockResolvedValue([
      { ...makeAnonBooking(ANON_ID), id: 'rb-1' },
      { ...makeAnonBooking(OTHER_ANON_ID), id: 'rb-2', siteId: 'site-1' },
    ] as any)

    const req = makeRequest(
      makeBody({ rentalBookingIds: ['rb-1', 'rb-2'], anonId: ANON_ID })
    )
    const res = await POST(req)

    // rb-2 has a different anonId — must be rejected
    expect(res.status).toBe(403)
  })
})
