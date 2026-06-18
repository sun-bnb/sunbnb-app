import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requestReceipt } from './actions'
import prisma from '@repo/data/PrismaCient'
import { rateLimit } from '@repo/data/rate-limit'
import { sendReceiptEmail } from '@repo/data/reservation-emails'

const VALID_ID = '123e4567-e89b-42d3-a456-426614174000'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(rateLimit).mockReturnValue({ allowed: true })
  vi.mocked(sendReceiptEmail).mockResolvedValue({ ok: true })
})

describe('requestReceipt', () => {
  it('rejects an invalid reservation id', async () => {
    const res = await requestReceipt('not-an-id', 'a@b.com')
    expect(res.status).toBe('error')
    expect(prisma.reservation.findUnique).not.toHaveBeenCalled()
  })

  it('rejects an invalid email', async () => {
    const res = await requestReceipt(VALID_ID, 'nope')
    expect(res.status).toBe('error')
    expect(sendReceiptEmail).not.toHaveBeenCalled()
  })

  it('rejects when rate-limited', async () => {
    vi.mocked(rateLimit).mockReturnValue({ allowed: false, retryAfterMs: 1000 })
    const res = await requestReceipt(VALID_ID, 'a@b.com')
    expect(res.status).toBe('error')
    expect(prisma.reservation.findUnique).not.toHaveBeenCalled()
  })

  it('rejects when the reservation is not paid (default-deny)', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ status: 'processing' } as any)
    const res = await requestReceipt(VALID_ID, 'a@b.com')
    expect(res.status).toBe('error')
    expect(sendReceiptEmail).not.toHaveBeenCalled()
  })

  it('stores the email and sends the receipt for a paid reservation', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ status: 'complete' } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await requestReceipt(VALID_ID, ' Guest@Email.com ')
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.reservation.update).mock.calls[0][0].data.guestEmail).toBe('Guest@Email.com')
    expect(sendReceiptEmail).toHaveBeenCalledWith(VALID_ID, 'Guest@Email.com')
  })

  it('surfaces a send failure', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ status: 'complete' } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)
    vi.mocked(sendReceiptEmail).mockResolvedValue({ ok: false, error: 'boom' })

    const res = await requestReceipt(VALID_ID, 'a@b.com')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('boom')
  })
})
