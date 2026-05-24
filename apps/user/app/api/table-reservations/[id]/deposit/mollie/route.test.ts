/**
 * Tests for POST /api/table-reservations/[id]/deposit/mollie
 *
 * Mirrors the mocking patterns used in the existing Mollie payment route tests.
 * See CLAUDE.md §Mocking patterns for conventions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock auth ─────────────────────────────────────────────────────────────────
// vi.hoisted() ensures mockAuth is available inside the vi.mock() factory (hoisted to top)
const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }))
vi.mock('@/app/auth', () => ({ auth: mockAuth }))

// ── Mock feature flag ─────────────────────────────────────────────────────────
vi.mock('@/app/flags', () => ({
  isFlagEnabled: vi.fn().mockResolvedValue(true),
}))

// ── Mock @repo/table-reservations-core constants ──────────────────────────────
vi.mock('@repo/table-reservations-core', () => ({
  TABLE_RESERVATION_STATUS: {
    PENDING_PAYMENT: 'pending_payment',
    CONFIRMED: 'confirmed',
    CANCELED: 'canceled',
  },
  DEPOSIT_STATUS: {
    NONE: 'none',
    PENDING: 'pending',
    HELD: 'held',
    CHARGED: 'charged',
    REFUNDED: 'refunded',
    RELEASED: 'released',
  },
}))

// ── Mock @repo/data/env ───────────────────────────────────────────────────────
// (resolved via vitest alias to __mocks__/@repo/data/env.ts — isTestMode returns true)

// ── Mock Mollie lib ───────────────────────────────────────────────────────────
// vi.hoisted() so these vars are available inside the hoisted vi.mock() factory
const { mockGetValidMollieToken, mockProfilesPage, mockPaymentsCreate } = vi.hoisted(() => ({
  mockGetValidMollieToken: vi.fn(),
  mockProfilesPage: vi.fn(),
  mockPaymentsCreate: vi.fn(),
}))

vi.mock('@/app/api/_lib/mollie', () => ({
  getMollieClientForPartner: vi.fn(() => ({
    profiles: { page: mockProfilesPage },
    payments: { create: mockPaymentsCreate },
  })),
  getValidMollieToken: mockGetValidMollieToken,
}))

// ── Import after mocks ────────────────────────────────────────────────────────
import { POST } from './route'
import prisma from '@repo/data/PrismaCient'
import { isFlagEnabled } from '@/app/flags'

const mockIsFlagEnabled = vi.mocked(isFlagEnabled)

// ── Constants ─────────────────────────────────────────────────────────────────
const VALID_RESERVATION_ID = 'clxk0000000000000000000000' // CUID-shaped
const VALID_ANON_ID = '550e8400-e29b-41d4-a716-446655440000' // valid UUID v4
const VALID_USER_ID = 'user-abc-123'
const REDIRECT_URL = 'https://app.sunbnb.app/payment/complete'

// Set env var so redirectUrl origin validation can pass
process.env.APP_URL = 'https://app.sunbnb.app'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>, id = VALID_RESERVATION_ID): NextRequest {
  return new NextRequest(`http://localhost:3002/api/table-reservations/${id}/deposit/mollie`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

/** A fully valid table reservation DB record (owned by VALID_USER_ID). */
function validTableReservation(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_RESERVATION_ID,
    userId: VALID_USER_ID,
    anonId: null,
    status: 'pending_payment',
    depositAmount: 25.0,
    depositStatus: 'pending',
    paymentRef: null,
    restaurantId: 'restaurant-1',
    restaurant: {
      id: 'restaurant-1',
      name: 'Test Restaurant',
      partnerAccountId: 'partner-1',
      partnerAccount: {
        userId: 'partner-user-1',
        mollieAccessToken: 'access_test_token',
        mollieRefreshToken: 'refresh_test_token',
        mollieProfileId: 'pfl_profile123',
      },
    },
    ...overrides,
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()

  // Auth: unauthenticated by default (matches the CLAUDE.md rule)
  mockAuth.mockResolvedValue(null)

  // Feature flag: restaurants enabled by default
  mockIsFlagEnabled.mockResolvedValue(true)

  // Prisma: no reservation by default
  vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.tableReservation.update).mockResolvedValue({} as any)

  // Mollie token: return the current token (no refresh needed)
  mockGetValidMollieToken.mockResolvedValue('access_test_token')

  // Mollie profile: return a verified profile
  mockProfilesPage.mockResolvedValue([{ id: 'pfl_profile123', status: 'verified' }])

  // Mollie payment create: success
  mockPaymentsCreate.mockResolvedValue({
    id: 'tr_abc123',
    getCheckoutUrl: () => 'https://www.mollie.com/checkout/tr_abc123',
  })
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/table-reservations/[id]/deposit/mollie', () => {
  describe('feature flag gate', () => {
    it('returns 404 when restaurants flag is off', async () => {
      mockIsFlagEnabled.mockResolvedValue(false)
      const req = makeRequest({ redirectUrl: REDIRECT_URL })
      const res = await POST(req, { params: { id: VALID_RESERVATION_ID } })
      expect(res.status).toBe(404)
    })
  })

  describe('id validation', () => {
    it('returns 400 for an invalid reservation id', async () => {
      const req = makeRequest({ redirectUrl: REDIRECT_URL }, 'not-a-valid-id')
      const res = await POST(req, { params: { id: 'not-a-valid-id' } })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/invalid reservation id/i)
    })
  })

  describe('redirectUrl validation', () => {
    it('returns 400 when redirectUrl is missing', async () => {
      mockAuth.mockResolvedValue({ user: { id: VALID_USER_ID } })
      const req = makeRequest({})
      const res = await POST(req, { params: { id: VALID_RESERVATION_ID } })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/redirectUrl is required/i)
    })

    it('returns 400 when redirectUrl is on a different origin (open redirect protection)', async () => {
      mockAuth.mockResolvedValue({ user: { id: VALID_USER_ID } })
      const req = makeRequest({ redirectUrl: 'https://evil.example.com/steal' })
      const res = await POST(req, { params: { id: VALID_RESERVATION_ID } })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/invalid redirectUrl/i)
    })

    it('returns 400 when redirectUrl is not a valid URL', async () => {
      mockAuth.mockResolvedValue({ user: { id: VALID_USER_ID } })
      const req = makeRequest({ redirectUrl: 'not-a-url' })
      const res = await POST(req, { params: { id: VALID_RESERVATION_ID } })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/invalid redirectUrl/i)
    })
  })

  describe('authentication', () => {
    it('returns 401 when no session and no anonId', async () => {
      // auth returns null (set in beforeEach), no anonId in body
      const req = makeRequest({ redirectUrl: REDIRECT_URL })
      const res = await POST(req, { params: { id: VALID_RESERVATION_ID } })
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toMatch(/authentication required/i)
    })

    it('returns 401 when anonId is not a valid UUID', async () => {
      const req = makeRequest({ redirectUrl: REDIRECT_URL, anonId: 'anon-123' })
      const res = await POST(req, { params: { id: VALID_RESERVATION_ID } })
      expect(res.status).toBe(401)
    })

    it('allows anonymous access with a valid UUID v4 anonId', async () => {
      // Reservation owned by the anon user
      vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue(
        validTableReservation({ userId: null, anonId: VALID_ANON_ID }) as any,
      )

      const req = makeRequest({ redirectUrl: REDIRECT_URL, anonId: VALID_ANON_ID })
      const res = await POST(req, { params: { id: VALID_RESERVATION_ID } })

      // Should not be 401 — anon path accepted
      expect(res.status).not.toBe(401)
    })
  })

  describe('reservation not found', () => {
    it('returns 404 when reservation does not exist', async () => {
      mockAuth.mockResolvedValue({ user: { id: VALID_USER_ID } })
      vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue(null)

      const req = makeRequest({ redirectUrl: REDIRECT_URL })
      const res = await POST(req, { params: { id: VALID_RESERVATION_ID } })
      expect(res.status).toBe(404)
    })
  })

  describe('ownership check', () => {
    it('returns 403 when authenticated user does not own the reservation', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'different-user' } })
      vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue(
        validTableReservation() as any,
      )

      const req = makeRequest({ redirectUrl: REDIRECT_URL })
      const res = await POST(req, { params: { id: VALID_RESERVATION_ID } })
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toMatch(/not authorized/i)
    })

    it('returns 403 when anonId does not match reservation anonId', async () => {
      vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue(
        validTableReservation({
          userId: null,
          anonId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        }) as any,
      )

      const differentAnonId = '550e8400-e29b-41d4-a716-446655440001'
      const req = makeRequest({ redirectUrl: REDIRECT_URL, anonId: differentAnonId })
      const res = await POST(req, { params: { id: VALID_RESERVATION_ID } })
      expect(res.status).toBe(403)
    })
  })

  describe('state validation', () => {
    it('returns 400 when reservation status is not PENDING_PAYMENT', async () => {
      mockAuth.mockResolvedValue({ user: { id: VALID_USER_ID } })
      vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue(
        validTableReservation({ status: 'confirmed' }) as any,
      )

      const req = makeRequest({ redirectUrl: REDIRECT_URL })
      const res = await POST(req, { params: { id: VALID_RESERVATION_ID } })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/not awaiting deposit payment/i)
    })

    it('returns 400 when depositStatus is not PENDING', async () => {
      mockAuth.mockResolvedValue({ user: { id: VALID_USER_ID } })
      vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue(
        validTableReservation({ depositStatus: 'held' }) as any,
      )

      const req = makeRequest({ redirectUrl: REDIRECT_URL })
      const res = await POST(req, { params: { id: VALID_RESERVATION_ID } })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/deposit is not in pending state/i)
    })

    it('returns 400 when paymentRef already exists (idempotency guard)', async () => {
      mockAuth.mockResolvedValue({ user: { id: VALID_USER_ID } })
      vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue(
        validTableReservation({ paymentRef: 'tr_existing123' }) as any,
      )

      const req = makeRequest({ redirectUrl: REDIRECT_URL })
      const res = await POST(req, { params: { id: VALID_RESERVATION_ID } })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/payment already created/i)
    })

    it('returns 400 when depositAmount is zero (guard against free deposits)', async () => {
      mockAuth.mockResolvedValue({ user: { id: VALID_USER_ID } })
      vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue(
        validTableReservation({ depositAmount: 0 }) as any,
      )

      const req = makeRequest({ redirectUrl: REDIRECT_URL })
      const res = await POST(req, { params: { id: VALID_RESERVATION_ID } })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/invalid deposit amount/i)
    })
  })

  describe('Mollie credentials', () => {
    it('returns 400 when partner has no mollieAccessToken', async () => {
      mockAuth.mockResolvedValue({ user: { id: VALID_USER_ID } })
      vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue(
        validTableReservation({
          restaurant: {
            id: 'restaurant-1',
            name: 'Test Restaurant',
            partnerAccountId: 'partner-1',
            partnerAccount: {
              userId: 'partner-user-1',
              mollieAccessToken: null,
              mollieRefreshToken: null,
              mollieProfileId: null,
            },
          },
        }) as any,
      )

      const req = makeRequest({ redirectUrl: REDIRECT_URL })
      const res = await POST(req, { params: { id: VALID_RESERVATION_ID } })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/mollie account/i)
    })

    it('returns 401 when getValidMollieToken throws (expired token, no refresh)', async () => {
      mockAuth.mockResolvedValue({ user: { id: VALID_USER_ID } })
      vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue(
        validTableReservation() as any,
      )
      mockGetValidMollieToken.mockRejectedValue(
        new Error('Mollie access token expired and no refresh token available.'),
      )

      const req = makeRequest({ redirectUrl: REDIRECT_URL })
      const res = await POST(req, { params: { id: VALID_RESERVATION_ID } })
      expect(res.status).toBe(401)
    })
  })

  describe('happy path', () => {
    it('creates a Mollie payment, stores paymentRef, and returns checkoutUrl', async () => {
      mockAuth.mockResolvedValue({ user: { id: VALID_USER_ID } })
      vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue(
        validTableReservation() as any,
      )

      const req = makeRequest({ redirectUrl: REDIRECT_URL })
      const res = await POST(req, { params: { id: VALID_RESERVATION_ID } })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.checkoutUrl).toBe('https://www.mollie.com/checkout/tr_abc123')
      expect(body.paymentId).toBe('tr_abc123')

      // paymentRef must be persisted server-side
      expect(prisma.tableReservation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: VALID_RESERVATION_ID },
          data: { paymentRef: 'tr_abc123' },
        }),
      )
    })

    it('uses the depositAmount from the DB (never trusts the client)', async () => {
      mockAuth.mockResolvedValue({ user: { id: VALID_USER_ID } })
      vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue(
        validTableReservation({ depositAmount: 12.5 }) as any,
      )

      const req = makeRequest({ redirectUrl: REDIRECT_URL })
      await POST(req, { params: { id: VALID_RESERVATION_ID } })

      expect(mockPaymentsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: { value: '12.50', currency: 'EUR' },
        }),
      )
    })

    it('includes correct table-deposit metadata for webhook routing', async () => {
      mockAuth.mockResolvedValue({ user: { id: VALID_USER_ID } })
      vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue(
        validTableReservation() as any,
      )

      const req = makeRequest({ redirectUrl: REDIRECT_URL })
      await POST(req, { params: { id: VALID_RESERVATION_ID } })

      const createCall = mockPaymentsCreate.mock.calls[0]![0]
      const meta = JSON.parse(createCall.metadata)
      expect(meta.type).toBe('table-deposit')
      expect(meta.entityId).toBe(VALID_RESERVATION_ID)
      expect(meta.restaurantId).toBe('restaurant-1')
    })

    it('passes the partner profileId from DB when already stored', async () => {
      mockAuth.mockResolvedValue({ user: { id: VALID_USER_ID } })
      vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue(
        validTableReservation({ restaurant: {
          id: 'restaurant-1',
          name: 'Test Restaurant',
          partnerAccountId: 'partner-1',
          partnerAccount: {
            userId: 'partner-user-1',
            mollieAccessToken: 'access_test_token',
            mollieRefreshToken: 'refresh_test_token',
            mollieProfileId: 'pfl_stored_profile',
          },
        } }) as any,
      )

      const req = makeRequest({ redirectUrl: REDIRECT_URL })
      await POST(req, { params: { id: VALID_RESERVATION_ID } })

      // profiles.page should NOT be called when we already have a profileId
      expect(mockProfilesPage).not.toHaveBeenCalled()
      expect(mockPaymentsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ profileId: 'pfl_stored_profile' }),
      )
    })

    it('fetches profile dynamically when no profileId is stored', async () => {
      mockAuth.mockResolvedValue({ user: { id: VALID_USER_ID } })
      vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue(
        validTableReservation({
          restaurant: {
            id: 'restaurant-1',
            name: 'Test Restaurant',
            partnerAccountId: 'partner-1',
            partnerAccount: {
              userId: 'partner-user-1',
              mollieAccessToken: 'access_test_token',
              mollieRefreshToken: 'refresh_test_token',
              mollieProfileId: null, // no stored profileId
            },
          },
        }) as any,
      )
      mockProfilesPage.mockResolvedValue([{ id: 'pfl_dynamic', status: 'verified' }])

      const req = makeRequest({ redirectUrl: REDIRECT_URL })
      await POST(req, { params: { id: VALID_RESERVATION_ID } })

      expect(mockProfilesPage).toHaveBeenCalled()
      expect(mockPaymentsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ profileId: 'pfl_dynamic' }),
      )
    })

    it('works for an anonymous user who owns the reservation via anonId', async () => {
      // auth returns null — no session
      vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue(
        validTableReservation({ userId: null, anonId: VALID_ANON_ID }) as any,
      )

      const req = makeRequest({ redirectUrl: REDIRECT_URL, anonId: VALID_ANON_ID })
      const res = await POST(req, { params: { id: VALID_RESERVATION_ID } })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.checkoutUrl).toBeDefined()
      expect(body.paymentId).toBe('tr_abc123')
    })
  })
})
