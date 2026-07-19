import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

const mockMollieGet = vi.fn()
// Token resolution + refresh now funnel through the centralized manager
// (findPartnerAccountForPayment → getValidMollieToken), so mock those rather
// than the raw prisma token lookups the webhook used to do itself.
const { mockFindPartnerAccount, mockGetValidToken, MockReconnectError } = vi.hoisted(() => {
  class MockReconnectError extends Error {
    constructor(message = 'reconnect required') {
      super(message)
      this.name = 'MollieReconnectRequiredError'
    }
  }
  return {
    mockFindPartnerAccount: vi.fn(),
    mockGetValidToken: vi.fn(),
    MockReconnectError,
  }
})
vi.mock('@/app/api/_lib/mollie', () => ({
  getMollieClientForPartner: () => ({
    payments: { get: mockMollieGet },
  }),
  isMolliePayment: (ref: string | null) => ref?.startsWith('tr_') ?? false,
  findPartnerAccountForPayment: mockFindPartnerAccount,
  getValidMollieToken: mockGetValidToken,
  MollieReconnectRequiredError: MockReconnectError,
}))

// vi.hoisted() so these are available in vi.mock() factories (which are hoisted)
const { mockSendEmail, mockMarkDepositHeld, mockConfirmationEmailHtml } = vi.hoisted(() => ({
  mockSendEmail: vi.fn().mockResolvedValue(undefined),
  mockMarkDepositHeld: vi.fn().mockResolvedValue(undefined),
  mockConfirmationEmailHtml: vi.fn().mockReturnValue('<html>confirm</html>'),
}))

// Mock @repo/data/email so sendEmail (called in table-deposit path) is a no-op
vi.mock('@repo/data/email', () => ({
  sendEmail: mockSendEmail,
}))

// Mock @repo/table-reservations-core — only the symbols used by the webhook
vi.mock('@repo/table-reservations-core', () => ({
  markDepositHeld: mockMarkDepositHeld,
  confirmationEmailHtml: mockConfirmationEmailHtml,
  DEPOSIT_STATUS: {
    NONE: 'none',
    PENDING: 'pending',
    HELD: 'held',
    CHARGED: 'charged',
    REFUNDED: 'refunded',
    RELEASED: 'released',
  },
}))

import { POST } from './route'
import prisma from '@repo/data/PrismaCient'
import {
  processConfirmedReservation,
  processConfirmedOrder,
  processConfirmedRentalBooking,
  processConfirmedTabPayment,
} from '@repo/data/payment'

const mockProcessReservation = vi.mocked(processConfirmedReservation)
const mockProcessOrder = vi.mocked(processConfirmedOrder)
const mockProcessRentalBooking = vi.mocked(processConfirmedRentalBooking)
const mockProcessTabPayment = vi.mocked(processConfirmedTabPayment)

function makeWebhookRequest(paymentId?: string) {
  const formBody = paymentId ? `id=${paymentId}` : ''
  return new NextRequest('http://localhost:3002/api/webhooks/mollie', {
    method: 'POST',
    body: formBody,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()

  // Default: a partner resolves and the centralized manager returns a valid token.
  mockFindPartnerAccount.mockResolvedValue('partner-1')
  mockGetValidToken.mockResolvedValue('access_test')
  // Default: no table reservation (overridden in table-deposit tests)
  vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue(null)
  // sendEmail: reset so we can assert call counts
  mockSendEmail.mockResolvedValue(undefined)
  mockMarkDepositHeld.mockResolvedValue(undefined)
})

describe('POST /api/webhooks/mollie', () => {
  it('returns 400 when payment id is missing', async () => {
    const req = new NextRequest('http://localhost:3002/api/webhooks/mollie', {
      method: 'POST',
      body: '',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid payment id format', async () => {
    const res = await POST(makeWebhookRequest('invalid_id'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('format')
  })

  it('returns 400 for SQL injection attempt in payment id', async () => {
    const res = await POST(makeWebhookRequest("tr_'; DROP TABLE--"))
    expect(res.status).toBe(400)
  })

  it('returns 200 when no partner account owns the payment', async () => {
    mockFindPartnerAccount.mockResolvedValue(null)
    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.received).toBe(true)
    expect(mockMollieGet).not.toHaveBeenCalled()
  })

  it('returns 200 without fetching the payment when the partner must reconnect', async () => {
    mockGetValidToken.mockRejectedValue(new MockReconnectError())
    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.received).toBe(true)
    expect(mockMollieGet).not.toHaveBeenCalled()
  })

  it('returns 500 on a transient token-refresh failure (triggers retry)', async () => {
    mockGetValidToken.mockRejectedValue(new Error('network blip'))
    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(500)
    expect(mockMollieGet).not.toHaveBeenCalled()
  })

  it('processes paid reservation', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'paid',
      metadata: JSON.stringify({
        type: 'reservation',
        entityId: 'res-1',
        siteId: 'site-1',
      }),
    })

    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(mockProcessReservation).toHaveBeenCalledWith('res-1')
  })

  it('processes paid order', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'paid',
      metadata: JSON.stringify({
        type: 'order',
        entityId: 'order-1',
        siteId: 'site-1',
      }),
    })

    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(mockProcessOrder).toHaveBeenCalledWith('order-1')
  })

  it('processes paid rental-booking', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'paid',
      metadata: JSON.stringify({
        type: 'rental-booking',
        entityId: 'booking-1',
        siteId: 'site-1',
        bookingIds: ['booking-1', 'booking-2'],
      }),
    })

    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(mockProcessRentalBooking).toHaveBeenCalledWith('tr_abc123')
  })

  it('marks reservation as payment_failed on failed status', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'failed',
      metadata: JSON.stringify({
        type: 'reservation',
        entityId: 'res-1',
        siteId: 'site-1',
      }),
    })
    vi.mocked(prisma.reservation.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(prisma.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { status: 'payment_failed' },
    })
  })

  it('marks reservation as payment_failed on expired status', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'expired',
      metadata: JSON.stringify({
        type: 'reservation',
        entityId: 'res-1',
        siteId: 'site-1',
      }),
    })
    vi.mocked(prisma.reservation.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(prisma.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { status: 'payment_failed' },
    })
  })

  it('reverts a failed QR walk-in collection to paid-in-cash (not payment_failed)', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'failed',
      metadata: JSON.stringify({
        type: 'reservation',
        entityId: 'res-1',
        siteId: 'site-1',
        collect: true,
      }),
    })
    vi.mocked(prisma.reservation.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(prisma.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { status: 'paid-in-cash', paymentRef: null },
    })
  })

  it('marks reservation as refunded', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'refunded',
      metadata: JSON.stringify({
        type: 'reservation',
        entityId: 'res-1',
        siteId: 'site-1',
      }),
    })
    vi.mocked(prisma.reservation.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(prisma.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { status: 'refunded' },
    })
  })

  it('ignores non-terminal statuses (open, pending)', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'open',
      metadata: JSON.stringify({
        type: 'reservation',
        entityId: 'res-1',
        siteId: 'site-1',
      }),
    })

    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(mockProcessReservation).not.toHaveBeenCalled()
    expect(prisma.reservation.updateMany).not.toHaveBeenCalled()
  })

  it('returns 500 when Mollie payment fetch fails (triggers retry)', async () => {
    mockMollieGet.mockRejectedValue(new Error('Mollie API error'))
    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(500)
  })

  it('returns 200 when metadata is missing (nothing to do)', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'paid',
      metadata: null,
    })
    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(mockProcessReservation).not.toHaveBeenCalled()
  })
})

// ── rental-booking collect branch ────────────────────────────────────────────

describe('POST /api/webhooks/mollie — rental-booking collect branch', () => {
  beforeEach(() => {
    vi.mocked(prisma.rentalBooking.updateMany).mockResolvedValue({ count: 1 } as any)
  })

  it('marks rental booking payment_failed when collect is absent (normal online failure)', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'failed',
      metadata: JSON.stringify({
        type: 'rental-booking',
        entityId: 'booking-1',
        siteId: 'site-1',
      }),
    })

    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(prisma.rentalBooking.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['booking-1'] } },
      data: { status: 'payment_failed' },
    })
  })

  it('marks rental booking payment_failed when collect is absent (expired)', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'expired',
      metadata: JSON.stringify({
        type: 'rental-booking',
        entityId: 'booking-1',
        siteId: 'site-1',
      }),
    })

    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(prisma.rentalBooking.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['booking-1'] } },
      data: { status: 'payment_failed' },
    })
  })

  it('reverts a failed QR walk-in rental collect to paid-in-cash (not payment_failed)', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'failed',
      metadata: JSON.stringify({
        type: 'rental-booking',
        entityId: 'booking-1',
        siteId: 'site-1',
        collect: true,
      }),
    })

    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(prisma.rentalBooking.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['booking-1'] } },
      data: { status: 'paid-in-cash', paymentRef: null },
    })
  })

  it('reverts an expired QR walk-in rental collect to paid-in-cash (not payment_failed)', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'expired',
      metadata: JSON.stringify({
        type: 'rental-booking',
        entityId: 'booking-1',
        siteId: 'site-1',
        collect: true,
      }),
    })

    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(prisma.rentalBooking.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['booking-1'] } },
      data: { status: 'paid-in-cash', paymentRef: null },
    })
  })

  it('reverts all bookings in a multi-booking group to paid-in-cash on collect failure', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'failed',
      metadata: JSON.stringify({
        type: 'rental-booking',
        entityId: 'booking-1',
        siteId: 'site-1',
        bookingIds: ['booking-1', 'booking-2', 'booking-3'],
        collect: true,
      }),
    })

    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(prisma.rentalBooking.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['booking-1', 'booking-2', 'booking-3'] } },
      data: { status: 'paid-in-cash', paymentRef: null },
    })
  })

  it('marks all bookings in a multi-booking group as payment_failed without collect', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'failed',
      metadata: JSON.stringify({
        type: 'rental-booking',
        entityId: 'booking-1',
        siteId: 'site-1',
        bookingIds: ['booking-1', 'booking-2', 'booking-3'],
      }),
    })

    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(prisma.rentalBooking.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['booking-1', 'booking-2', 'booking-3'] } },
      data: { status: 'payment_failed' },
    })
  })
})

// ── table-deposit webhook branch ─────────────────────────────────────────────

describe('POST /api/webhooks/mollie — table-deposit branch', () => {
  const PAYMENT_ID = 'tr_deposit99'
  const TABLE_RESERVATION_ID = 'clxk0000000000000000000000'

  /** The deposit's partner resolves and the manager returns a valid token. */
  function useTableDepositToken() {
    mockFindPartnerAccount.mockResolvedValue('partner-deposit')
    mockGetValidToken.mockResolvedValue('access_deposit_token')
  }

  /** Mollie returns a paid table-deposit payment. */
  function mockPaidDeposit() {
    mockMollieGet.mockResolvedValue({
      status: 'paid',
      metadata: JSON.stringify({
        type: 'table-deposit',
        entityId: TABLE_RESERVATION_ID,
        restaurantId: 'restaurant-1',
      }),
    })
  }

  it('resolves the partner account then fetches the payment with a valid token', async () => {
    useTableDepositToken()
    // Non-terminal status so we just verify the resolve → token → fetch funnel.
    mockMollieGet.mockResolvedValue({
      status: 'open',
      metadata: JSON.stringify({
        type: 'table-deposit',
        entityId: TABLE_RESERVATION_ID,
        restaurantId: 'restaurant-1',
      }),
    })

    const res = await POST(makeWebhookRequest(PAYMENT_ID))
    expect(res.status).toBe(200)
    expect(mockFindPartnerAccount).toHaveBeenCalledWith(PAYMENT_ID)
    expect(mockGetValidToken).toHaveBeenCalledWith('partner-deposit')
    expect(mockMollieGet).toHaveBeenCalled()
  })

  it('calls markDepositHeld when deposit status is PENDING (paid webhook)', async () => {
    useTableDepositToken()
    mockPaidDeposit()

    // Simulate the tableReservation.findUnique call inside handlePaymentPaid
    vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue({
      id: TABLE_RESERVATION_ID,
      guestEmail: 'guest@example.com',
      guestName: 'Alice',
      from: new Date('2026-06-01T19:00:00Z'),
      to: new Date('2026-06-01T21:00:00Z'),
      partySize: 2,
      specialRequests: null,
      depositStatus: 'pending', // PENDING → eligible for HELD transition
      restaurant: { name: 'Test Restaurant', slug: 'test-restaurant', tagline: null },
    } as any)

    const res = await POST(makeWebhookRequest(PAYMENT_ID))
    expect(res.status).toBe(200)

    // Core assertion: the deposit was marked held exactly once
    expect(mockMarkDepositHeld).toHaveBeenCalledOnce()
    expect(mockMarkDepositHeld).toHaveBeenCalledWith(TABLE_RESERVATION_ID, PAYMENT_ID)
  })

  it('sends a confirmation email to the guest after marking deposit held', async () => {
    useTableDepositToken()
    mockPaidDeposit()

    vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue({
      id: TABLE_RESERVATION_ID,
      guestEmail: 'guest@example.com',
      guestName: 'Alice',
      from: new Date('2026-06-01T19:00:00Z'),
      to: new Date('2026-06-01T21:00:00Z'),
      partySize: 2,
      specialRequests: null,
      depositStatus: 'pending',
      restaurant: { name: 'Test Restaurant', slug: 'test-restaurant', tagline: null },
    } as any)

    await POST(makeWebhookRequest(PAYMENT_ID))

    expect(mockSendEmail).toHaveBeenCalledOnce()
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'guest@example.com',
        subject: expect.stringContaining('Test Restaurant'),
      }),
    )
  })

  it('does NOT call markDepositHeld when depositStatus is already HELD (idempotency guard)', async () => {
    useTableDepositToken()
    mockPaidDeposit()

    // Second Mollie delivery: deposit already confirmed
    vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue({
      id: TABLE_RESERVATION_ID,
      guestEmail: 'guest@example.com',
      guestName: 'Alice',
      from: new Date('2026-06-01T19:00:00Z'),
      to: new Date('2026-06-01T21:00:00Z'),
      partySize: 2,
      specialRequests: null,
      depositStatus: 'held', // already transitioned — do NOT re-process
      restaurant: { name: 'Test Restaurant', slug: 'test-restaurant', tagline: null },
    } as any)

    const res = await POST(makeWebhookRequest(PAYMENT_ID))
    expect(res.status).toBe(200)

    // Idempotency: neither side effect fires on re-delivery
    expect(mockMarkDepositHeld).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('does not send confirmation email when guestEmail is absent', async () => {
    useTableDepositToken()
    mockPaidDeposit()

    vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue({
      id: TABLE_RESERVATION_ID,
      guestEmail: null, // no email — skip email but still hold deposit
      guestName: 'Walk-In',
      from: new Date('2026-06-01T19:00:00Z'),
      to: new Date('2026-06-01T21:00:00Z'),
      partySize: 2,
      specialRequests: null,
      depositStatus: 'pending',
      restaurant: { name: 'Test Restaurant', slug: 'test-restaurant', tagline: null },
    } as any)

    await POST(makeWebhookRequest(PAYMENT_ID))

    expect(mockMarkDepositHeld).toHaveBeenCalledOnce()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('returns 200 (not 500) when table reservation is not found by findUnique (safe no-op)', async () => {
    useTableDepositToken()
    mockPaidDeposit()

    // findUnique returns null — the handler should skip gracefully
    vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue(null)

    const res = await POST(makeWebhookRequest(PAYMENT_ID))
    expect(res.status).toBe(200)
    expect(mockMarkDepositHeld).not.toHaveBeenCalled()
  })
})

// ── tab webhook branch ────────────────────────────────────────────────────────

describe('POST /api/webhooks/mollie — tab branch', () => {
  const TAB_ID = 'clxtab0000000000000000000000'

  it('calls processConfirmedTabPayment when tab payment is paid', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'paid',
      metadata: JSON.stringify({
        type: 'tab',
        entityId: TAB_ID,
        siteId: 'site-1',
      }),
    })

    const res = await POST(makeWebhookRequest('tr_tab123'))
    expect(res.status).toBe(200)
    expect(mockProcessTabPayment).toHaveBeenCalledWith(TAB_ID)
    // Other processors must not be called
    expect(mockProcessReservation).not.toHaveBeenCalled()
    expect(mockProcessOrder).not.toHaveBeenCalled()
  })

  it('reverts tab to open when payment fails (so party can retry)', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'failed',
      metadata: JSON.stringify({
        type: 'tab',
        entityId: TAB_ID,
        siteId: 'site-1',
      }),
    })
    vi.mocked(prisma.tableTab.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await POST(makeWebhookRequest('tr_tab123'))
    expect(res.status).toBe(200)
    expect(prisma.tableTab.updateMany).toHaveBeenCalledWith({
      where: { id: TAB_ID, status: 'pending_payment' },
      data: { status: 'open', paymentRef: null },
    })
    expect(mockProcessTabPayment).not.toHaveBeenCalled()
  })

  it('reverts tab to open when payment is canceled', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'canceled',
      metadata: JSON.stringify({
        type: 'tab',
        entityId: TAB_ID,
        siteId: 'site-1',
      }),
    })
    vi.mocked(prisma.tableTab.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await POST(makeWebhookRequest('tr_tab123'))
    expect(res.status).toBe(200)
    expect(prisma.tableTab.updateMany).toHaveBeenCalledWith({
      where: { id: TAB_ID, status: 'pending_payment' },
      data: { status: 'open', paymentRef: null },
    })
  })

  it('reverts tab to open when payment expires', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'expired',
      metadata: JSON.stringify({
        type: 'tab',
        entityId: TAB_ID,
        siteId: 'site-1',
      }),
    })
    vi.mocked(prisma.tableTab.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await POST(makeWebhookRequest('tr_tab123'))
    expect(res.status).toBe(200)
    expect(prisma.tableTab.updateMany).toHaveBeenCalledWith({
      where: { id: TAB_ID, status: 'pending_payment' },
      data: { status: 'open', paymentRef: null },
    })
  })

  it('guards failed revert with TAB_PENDING_PAYMENT — never reopens a paid tab', async () => {
    // The where clause { status: TAB_PENDING_PAYMENT } is the guard.
    // If the tab is already TAB_PAID, updateMany count is 0 — no state change.
    mockMollieGet.mockResolvedValue({
      status: 'failed',
      metadata: JSON.stringify({
        type: 'tab',
        entityId: TAB_ID,
        siteId: 'site-1',
      }),
    })
    // Simulate the tab is already paid — updateMany returns count: 0 (guard kicks in)
    vi.mocked(prisma.tableTab.updateMany).mockResolvedValue({ count: 0 } as any)

    const res = await POST(makeWebhookRequest('tr_tab123'))
    expect(res.status).toBe(200)
    // The guard (where: { status: 'pending_payment' }) was applied correctly
    expect(prisma.tableTab.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'pending_payment' }),
      }),
    )
  })

  it('logs a warning and does nothing on tab refund (v1 no-op)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockMollieGet.mockResolvedValue({
      status: 'refunded',
      metadata: JSON.stringify({
        type: 'tab',
        entityId: TAB_ID,
        siteId: 'site-1',
      }),
    })

    const res = await POST(makeWebhookRequest('tr_tab123'))
    expect(res.status).toBe(200)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Tab refund received'),
      TAB_ID,
    )
    expect(prisma.tableTab.updateMany).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
