/**
 * Unit tests for cancelReservationMolliePayment.
 *
 * Strategy mirrors refund.test.ts:
 *   - vi.mock the two external modules (mollie-tokens, env) that the module
 *     imports at the top level so they are replaced before the module loads.
 *   - The prisma singleton is mocked via vi.mock('../index') with a factory
 *     that references vi.hoisted() values — avoiding the "can't access before
 *     initialization" hoisting trap (CLAUDE.md/vitest mocking patterns).
 *   - global.fetch is replaced per-test via a helper.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// --- Hoist mock functions so the vi.mock factories can close over them -------

const {
  mockReservationFindUnique,
  mockPartnerAccountFindUnique,
} = vi.hoisted(() => ({
  mockReservationFindUnique: vi.fn(),
  mockPartnerAccountFindUnique: vi.fn(),
}))

// --- Mock external dependencies before importing the module under test -------

vi.mock('./mollie-tokens', () => ({
  getValidMollieToken: vi.fn().mockResolvedValue('test-token'),
}))

vi.mock('./env', () => ({
  isTestMode: vi.fn().mockReturnValue(false),
}))

// Prisma singleton — provide just the two shapes this function queries.
vi.mock('../index', () => ({
  default: {
    reservation: { findUnique: mockReservationFindUnique },
    partnerAccount: { findUnique: mockPartnerAccountFindUnique },
  },
}))

// Mock ./payment to avoid pulling in the full payment module (which has its own
// heavy imports). cancelReservationMolliePayment doesn't call payment.ts but
// the module imports from it at the top level.
vi.mock('./payment', () => ({
  loadFeeContext: vi.fn(),
  resolveServiceFee: vi.fn(),
  calculateServiceFeeAmount: vi.fn(),
  round: vi.fn(),
  processConfirmedReservation: vi.fn(),
}))

// reservation-status constants — just return strings.
vi.mock('./reservation-status', () => ({
  RESERVATION_PROCESSING: 'processing',
  RESERVATION_PAYMENT_FAILED: 'payment_failed',
}))

// reservation-emails — imported transitively; keep it a no-op.
vi.mock('./reservation-emails', () => ({}))

// ---------------------------------------------------------------------------

import { cancelReservationMolliePayment } from './reservation-payment'
import { getValidMollieToken } from './mollie-tokens'
import { isTestMode } from './env'

// ---------------------------------------------------------------------------
// Helpers

/** Install a sequence of fetch responses for the current test. */
function mockFetch(...responses: Array<{ ok: boolean; status?: number; text?: string }>) {
  const fn = vi.fn()
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.ok,
      status: r.status ?? (r.ok ? 204 : 500),
      text: async () => r.text ?? '',
    })
  }
  global.fetch = fn as unknown as typeof fetch
  return fn
}

/** Default reservation row returned by prisma.reservation.findUnique. */
function makeReservation(paymentRef: string | null = 'tr_test123') {
  return {
    paymentRef,
    site: { userId: 'partner-user-1' },
  }
}

/** Default partnerAccount row. */
function makePartnerAccount() {
  return {
    userId: 'partner-user-1',
    mollieAccessToken: 'mollie-access-token',
  }
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getValidMollieToken).mockResolvedValue('test-token')
  vi.mocked(isTestMode).mockReturnValue(false)
  mockReservationFindUnique.mockResolvedValue(makeReservation())
  mockPartnerAccountFindUnique.mockResolvedValue(makePartnerAccount())
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Short-circuit paths — no fetch calls expected

describe('cancelReservationMolliePayment — short-circuit paths', () => {
  it('returns canceled when reservation has no paymentRef (no fetch)', async () => {
    mockReservationFindUnique.mockResolvedValue(makeReservation(null))
    const fetchSpy = mockFetch()

    const result = await cancelReservationMolliePayment('reservation-1')

    expect(result).toEqual({ status: 'canceled' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(getValidMollieToken).not.toHaveBeenCalled()
  })

  it('returns canceled for a demo ref without calling Mollie or fetching a token', async () => {
    mockReservationFindUnique.mockResolvedValue(makeReservation('pi_demo_1234567890'))
    const fetchSpy = mockFetch()

    const result = await cancelReservationMolliePayment('reservation-1')

    expect(result).toEqual({ status: 'canceled' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(getValidMollieToken).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Mollie DELETE paths

describe('cancelReservationMolliePayment — Mollie DELETE', () => {
  it('returns canceled on a 2xx DELETE response', async () => {
    const fetchSpy = mockFetch({ ok: true, status: 204 })

    const result = await cancelReservationMolliePayment('reservation-1')

    expect(result).toEqual({ status: 'canceled' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/payments/tr_test123')
    expect(init.method).toBe('DELETE')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token')
  })

  it('appends testmode query param when isTestMode() returns true', async () => {
    vi.mocked(isTestMode).mockReturnValue(true)

    const fetchSpy = mockFetch({ ok: true, status: 204 })
    await cancelReservationMolliePayment('reservation-1')

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('?testmode=true')
  })

  it('returns paid on a 422 response (payment already authorized/paid at Mollie)', async () => {
    mockFetch({ ok: false, status: 422 })

    const result = await cancelReservationMolliePayment('reservation-1')

    expect(result).toEqual({ status: 'paid' })
  })

  it('returns error with a message on any other non-OK response', async () => {
    mockFetch({ ok: false, status: 500, text: 'Internal Server Error' })

    const result = await cancelReservationMolliePayment('reservation-1')

    expect(result).toEqual({
      status: 'error',
      error: 'Failed to cancel payment (500)',
    })
  })
})

// ---------------------------------------------------------------------------
// Token / partner account failure paths

describe('cancelReservationMolliePayment — auth failures', () => {
  it('returns error when partner has no mollieAccessToken', async () => {
    mockPartnerAccountFindUnique.mockResolvedValue({ userId: 'partner-user-1', mollieAccessToken: null })
    const fetchSpy = mockFetch()

    const result = await cancelReservationMolliePayment('reservation-1')

    expect(result).toEqual({
      status: 'error',
      error: 'Partner has not connected their Mollie account',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns error when partner account is not found', async () => {
    mockPartnerAccountFindUnique.mockResolvedValue(null)
    const fetchSpy = mockFetch()

    const result = await cancelReservationMolliePayment('reservation-1')

    expect(result).toEqual({
      status: 'error',
      error: 'Partner has not connected their Mollie account',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns error when getValidMollieToken throws', async () => {
    vi.mocked(getValidMollieToken).mockRejectedValueOnce(new Error('Token expired'))
    const fetchSpy = mockFetch()

    const result = await cancelReservationMolliePayment('reservation-1')

    expect(result).toEqual({
      status: 'error',
      error: 'Partner Mollie session has expired. Please ask the merchant to reconnect their Mollie account.',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
