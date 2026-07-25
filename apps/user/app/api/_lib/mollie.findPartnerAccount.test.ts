import { describe, it, expect, vi, beforeEach } from 'vitest'

// mollie-tokens is not aliased in vitest.config — stub it so importing the
// lib never touches real token logic.
vi.mock('@repo/data/mollie-tokens', () => ({
  getValidMollieToken: vi.fn(),
  MollieReconnectRequiredError: class extends Error {},
}))

import prisma from '@repo/data/PrismaCient'
import { findPartnerAccountForPayment } from './mollie'

const PARTNER = { partnerAccount: { userId: 'partner-1' } }

beforeEach(() => {
  vi.clearAllMocks()
  // Default: nothing matches anywhere.
  vi.mocked(prisma.tableTab.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.order.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.rentalBooking.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.tableReservation.findFirst).mockResolvedValue(null)
})

describe('findPartnerAccountForPayment', () => {
  it('resolves a dine-in tab paymentRef via restaurant → partnerAccount (standalone-safe)', async () => {
    // Regression: tab refs were missing entirely — the tab holds the ref
    // during pending_payment, so webhook + poll verification wedged forever.
    vi.mocked(prisma.tableTab.findFirst).mockResolvedValue({
      restaurant: PARTNER,
    } as any)

    const result = await findPartnerAccountForPayment('tr_tab123')

    expect(result).toBe('partner-1')
    expect(prisma.tableTab.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { paymentRef: 'tr_tab123' } }),
    )
  })

  it('resolves a reservation paymentRef via site → user → partnerAccount', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      site: { user: PARTNER },
    } as any)

    expect(await findPartnerAccountForPayment('tr_res123')).toBe('partner-1')
  })

  it('resolves a table-reservation deposit via restaurant → partnerAccount', async () => {
    vi.mocked(prisma.tableReservation.findFirst).mockResolvedValue({
      restaurant: PARTNER,
    } as any)

    expect(await findPartnerAccountForPayment('tr_dep123')).toBe('partner-1')
  })

  it('returns null when no entity carries the ref', async () => {
    expect(await findPartnerAccountForPayment('tr_unknown')).toBeNull()
  })
})
