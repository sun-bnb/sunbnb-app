import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('@/app/flags', () => ({ isFlagEnabled: vi.fn().mockResolvedValue(true) }))
vi.mock('@/app/api/_lib/payment-ids', () => ({
  isDemoPayment: (ref: string | null) => ref?.startsWith('pi_demo_') ?? false,
  isValidEntityId: vi.fn().mockReturnValue(true),
}))
vi.mock('@/app/api/_lib/payment-provider', () => ({
  getPaymentStatus: vi.fn(),
  isPaymentSucceeded: vi.fn(),
  isPaymentFailed: vi.fn(),
}))
vi.mock('@repo/table-reservations-core', async (importActual) => {
  const actual = await importActual<typeof import('@repo/table-reservations-core')>()
  return { ...actual, markDepositHeld: vi.fn().mockResolvedValue({ status: 'ok' }) }
})

import { GET } from './route'
import { auth } from '@/app/auth'
import { isFlagEnabled } from '@/app/flags'
import { isValidEntityId } from '@/app/api/_lib/payment-ids'
import prisma from '@repo/data/PrismaCient'
import { getPaymentStatus, isPaymentSucceeded } from '@/app/api/_lib/payment-provider'
import { markDepositHeld, TABLE_RESERVATION_STATUS, DEPOSIT_STATUS } from '@repo/table-reservations-core'

const mockAuth = vi.mocked(auth)
const mockFlag = vi.mocked(isFlagEnabled)
const mockValidId = vi.mocked(isValidEntityId)
const mockFindUnique = vi.mocked(prisma.tableReservation.findUnique)
const mockGetStatus = vi.mocked(getPaymentStatus)
const mockSucceeded = vi.mocked(isPaymentSucceeded)
const mockMarkHeld = vi.mocked(markDepositHeld)

function req(id: string, anonId?: string) {
  const url = anonId
    ? `http://localhost:3002/api/table-reservations/${id}?anonId=${anonId}`
    : `http://localhost:3002/api/table-reservations/${id}`
  return new NextRequest(url, { method: 'GET' })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  mockFlag.mockResolvedValue(true)
  mockValidId.mockReturnValue(true)
})

describe('GET /api/table-reservations/[id]', () => {
  it('returns 404 when the restaurants flag is off', async () => {
    mockFlag.mockResolvedValue(false)
    const res = await GET(req('tr-1'), { params: { id: 'tr-1' } })
    expect(res.status).toBe(404)
  })

  it('returns 400 on an invalid id', async () => {
    mockValidId.mockReturnValue(false)
    const res = await GET(req('bad'), { params: { id: 'bad' } })
    expect(res.status).toBe(400)
  })

  it('returns 401 when not authenticated', async () => {
    const res = await GET(req('tr-1'), { params: { id: 'tr-1' } })
    expect(res.status).toBe(401)
  })

  it('returns 404 when the reservation is not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1' } })
    mockFindUnique.mockResolvedValue(null)
    const res = await GET(req('tr-1'), { params: { id: 'tr-1' } })
    expect(res.status).toBe(404)
  })

  it('returns 403 when the caller does not own it', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1' } })
    mockFindUnique.mockResolvedValue({ id: 'tr-1', userId: 'u2', anonId: null, status: 'confirmed' } as any)
    const res = await GET(req('tr-1'), { params: { id: 'tr-1' } })
    expect(res.status).toBe(403)
  })

  it('confirms a demo deposit (markDepositHeld) while PENDING_PAYMENT', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1' } })
    mockFindUnique
      .mockResolvedValueOnce({
        id: 'tr-1', userId: 'u1', anonId: null,
        status: TABLE_RESERVATION_STATUS.PENDING_PAYMENT,
        depositStatus: DEPOSIT_STATUS.PENDING,
        paymentRef: 'pi_demo_123',
      } as any)
      .mockResolvedValueOnce({
        id: 'tr-1', userId: 'u1', anonId: null,
        status: TABLE_RESERVATION_STATUS.CONFIRMED,
        depositStatus: DEPOSIT_STATUS.HELD,
        paymentRef: 'pi_demo_123',
      } as any)
    const res = await GET(req('tr-1'), { params: { id: 'tr-1' } })
    expect(res.status).toBe(200)
    expect(mockMarkHeld).toHaveBeenCalledWith('tr-1', 'pi_demo_123')
  })

  it('confirms a paid Mollie deposit while PENDING_PAYMENT', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1' } })
    mockGetStatus.mockResolvedValue('paid')
    mockSucceeded.mockReturnValue(true)
    mockFindUnique
      .mockResolvedValueOnce({
        id: 'tr-1', userId: 'u1', anonId: null,
        status: TABLE_RESERVATION_STATUS.PENDING_PAYMENT,
        depositStatus: DEPOSIT_STATUS.PENDING,
        paymentRef: 'tr_abc',
      } as any)
      .mockResolvedValueOnce({ id: 'tr-1', userId: 'u1', anonId: null, status: TABLE_RESERVATION_STATUS.CONFIRMED } as any)
    const res = await GET(req('tr-1'), { params: { id: 'tr-1' } })
    expect(res.status).toBe(200)
    expect(mockMarkHeld).toHaveBeenCalledWith('tr-1', 'tr_abc')
  })

  it('does not re-confirm an already-confirmed booking', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1' } })
    mockFindUnique.mockResolvedValue({
      id: 'tr-1', userId: 'u1', anonId: null,
      status: TABLE_RESERVATION_STATUS.CONFIRMED,
      depositStatus: DEPOSIT_STATUS.HELD,
      paymentRef: 'tr_abc',
    } as any)
    const res = await GET(req('tr-1'), { params: { id: 'tr-1' } })
    expect(res.status).toBe(200)
    expect(mockMarkHeld).not.toHaveBeenCalled()
  })
})
