import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/api/_lib/mollie', () => ({}))
vi.mock('@repo/data/email', () => ({ sendEmail: vi.fn() }))
vi.mock('@repo/table-reservations-core', () => ({
  markDepositHeld: vi.fn().mockResolvedValue(undefined),
  DEPOSIT_STATUS: { PENDING: 'pending' },
  confirmationEmailHtml: vi.fn().mockReturnValue('<p>ok</p>'),
}))

import prisma from '@repo/data/PrismaCient'
import { applyTransition } from '@repo/data/reservation-machine-apply'
import {
  processConfirmedReservation,
  processConfirmedOrder,
  processConfirmedRentalBooking,
  processConfirmedTabPayment,
} from '@repo/data/payment'
import { markDepositHeld } from '@repo/table-reservations-core'
import { parsePaymentMeta, onPaymentState, findPaymentEntity, type PaymentMeta } from './payment-events'

const meta = (type: PaymentMeta['type']): PaymentMeta => ({ type, entityId: 'e1' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue({
    id: 'e1', depositStatus: 'pending', guestEmail: null, restaurant: null,
  } as any)
})

describe('onPaymentState — paid', () => {
  it('reservation', async () => {
    await onPaymentState(meta('reservation'), 'tr_1', 'paid')
    expect(processConfirmedReservation).toHaveBeenCalledWith('e1')
  })
  it('order', async () => {
    await onPaymentState(meta('order'), 'tr_1', 'paid')
    expect(processConfirmedOrder).toHaveBeenCalledWith('e1')
  })
  it('rental-booking uses the payment ref (group)', async () => {
    await onPaymentState(meta('rental-booking'), 'tr_1', 'paid')
    expect(processConfirmedRentalBooking).toHaveBeenCalledWith('tr_1')
  })
  it('table-deposit marks held on PENDING', async () => {
    await onPaymentState(meta('table-deposit'), 'tr_1', 'paid')
    expect(markDepositHeld).toHaveBeenCalledWith('e1', 'tr_1')
  })
  it('tab', async () => {
    await onPaymentState(meta('tab'), 'tr_1', 'paid')
    expect(processConfirmedTabPayment).toHaveBeenCalledWith('e1')
  })
})

describe('onPaymentState — failed', () => {
  it('reservation -> pay.fail', async () => {
    await onPaymentState(meta('reservation'), 'tr_1', 'failed')
    expect(applyTransition).toHaveBeenCalledWith('e1', 'pay.fail')
  })
  it('order -> payment_failed', async () => {
    await onPaymentState(meta('order'), 'tr_1', 'failed')
    expect(prisma.order.updateMany).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { status: 'payment_failed' } })
  })
  it('rental-booking -> payment_failed for all bookings; collect reverts to cash', async () => {
    await onPaymentState({ ...meta('rental-booking'), bookingIds: ['a', 'b'] }, 'tr_1', 'failed')
    expect(prisma.rentalBooking.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] } },
      data: { status: 'payment_failed' },
    })
    vi.mocked(prisma.rentalBooking.updateMany).mockClear()
    await onPaymentState({ ...meta('rental-booking'), collect: true }, 'tr_1', 'failed')
    expect(prisma.rentalBooking.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['e1'] } },
      data: { status: 'paid-in-cash', paymentRef: null },
    })
  })
  it('table-deposit has no failure effect', async () => {
    await onPaymentState(meta('table-deposit'), 'tr_1', 'failed')
    expect(prisma.tableReservation.update).not.toHaveBeenCalled()
    expect(markDepositHeld).not.toHaveBeenCalled()
  })
  it('tab reverts only from pending_payment', async () => {
    await onPaymentState(meta('tab'), 'tr_1', 'failed')
    expect(prisma.tableTab.updateMany).toHaveBeenCalledWith({
      where: { id: 'e1', status: 'pending_payment' },
      data: { status: 'open', paymentRef: null },
    })
  })
})

describe('onPaymentState — refunded', () => {
  it('reservation -> pay.refund.webhook', async () => {
    await onPaymentState(meta('reservation'), 'tr_1', 'refunded')
    expect(applyTransition).toHaveBeenCalledWith('e1', 'pay.refund.webhook')
  })
  it('order -> refunded', async () => {
    await onPaymentState(meta('order'), 'tr_1', 'refunded')
    expect(prisma.order.updateMany).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { status: 'refunded' } })
  })
  it('rental-booking -> refunded', async () => {
    await onPaymentState({ ...meta('rental-booking'), bookingIds: ['a'] }, 'tr_1', 'refunded')
    expect(prisma.rentalBooking.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a'] } },
      data: { status: 'refunded' },
    })
  })
  it('table-deposit is a no-op', async () => {
    await onPaymentState(meta('table-deposit'), 'tr_1', 'refunded')
    expect(prisma.tableReservation.update).not.toHaveBeenCalled()
  })
  it('tab warns and does not mutate', async () => {
    await onPaymentState(meta('tab'), 'tr_1', 'refunded')
    expect(console.warn).toHaveBeenCalled()
    expect(prisma.tableTab.updateMany).not.toHaveBeenCalled()
  })
})

describe('parsePaymentMeta', () => {
  it('parses a JSON string and an object', () => {
    expect(parsePaymentMeta('{"type":"order","entityId":"o1"}')).toEqual({ type: 'order', entityId: 'o1' })
    expect(parsePaymentMeta({ type: 'tab', entityId: 't1' })).toEqual({ type: 'tab', entityId: 't1' })
  })
  it('rejects missing type / entityId, junk and non-objects', () => {
    expect(parsePaymentMeta({ entityId: 'x' })).toBeNull()
    expect(parsePaymentMeta({ type: 'order' })).toBeNull()
    expect(parsePaymentMeta('not json')).toBeNull()
    expect(parsePaymentMeta(null)).toBeNull()
    expect(parsePaymentMeta(42)).toBeNull()
  })
})

describe('findPaymentEntity', () => {
  beforeEach(() => {
    vi.mocked(prisma.tableTab.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.order.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.rentalBooking.findMany).mockResolvedValue([])
    vi.mocked(prisma.tableReservation.findFirst).mockResolvedValue(null)
  })

  it('returns null when nothing owns the ref', async () => {
    expect(await findPaymentEntity('tr_x')).toBeNull()
  })

  it('scans tab, reservation, order, rental, deposit in order and stops at first hit', async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue({ id: 'o1', siteId: 's1' } as any)
    expect(await findPaymentEntity('tr_x')).toEqual({ type: 'order', entityId: 'o1', siteId: 's1' })
    expect(prisma.tableTab.findFirst).toHaveBeenCalled()
    expect(prisma.reservation.findFirst).toHaveBeenCalled()
    expect(prisma.rentalBooking.findMany).not.toHaveBeenCalled()
    expect(prisma.tableReservation.findFirst).not.toHaveBeenCalled()
  })

  it('tab wins over a reservation sharing the ref', async () => {
    vi.mocked(prisma.tableTab.findFirst).mockResolvedValue({ id: 't1', siteId: null, restaurantId: 'r1' } as any)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({ id: 'res1', siteId: 's1' } as any)
    expect(await findPaymentEntity('tr_x')).toMatchObject({ type: 'tab', entityId: 't1', restaurantId: 'r1' })
    expect(prisma.reservation.findFirst).not.toHaveBeenCalled()
  })

  it('rental returns every booking sharing the ref', async () => {
    vi.mocked(prisma.rentalBooking.findMany).mockResolvedValue([
      { id: 'b1', siteId: 's1' }, { id: 'b2', siteId: 's1' },
    ] as any)
    expect(await findPaymentEntity('tr_x')).toEqual({
      type: 'rental-booking', entityId: 'b1', siteId: 's1', bookingIds: ['b1', 'b2'],
    })
    expect(prisma.rentalBooking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { paymentRef: 'tr_x' } }),
    )
  })

  it('falls through to table-deposit', async () => {
    vi.mocked(prisma.tableReservation.findFirst).mockResolvedValue({ id: 'td1', restaurantId: 'r1' } as any)
    expect(await findPaymentEntity('tr_x')).toEqual({ type: 'table-deposit', entityId: 'td1', restaurantId: 'r1' })
  })
})
