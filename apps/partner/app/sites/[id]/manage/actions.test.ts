import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Mock the conflict guards — the real implementations use $transaction + FOR UPDATE
// which the PrismaCient mock cannot model. Default success paths.
// Override per-test for conflict/unavailable scenarios.
vi.mock('@repo/data/reservations', () => ({
  reserveWithConflictGuard: vi.fn().mockResolvedValue({
    outcome: 'created',
    reservationId: 'r1',
  }),
  moveReservationWithConflictGuard: vi.fn().mockResolvedValue({
    outcome: 'moved',
  }),
  createRentalBookingsWithGuard: vi.fn().mockResolvedValue({
    outcome: 'created',
    bookingIds: ['rb1'],
  }),
}))

import {
  reserveItem,
  unreserveItem,
  checkInReservation,
  markDeparted,
  markNoShow,
  updateReservationNotes,
  moveReservation,
  moveReservationToSeats,
  blockBed,
  unblockBed,
  holdBed,
  compBed,
  uncompBed,
  cancelReservation,
  refundReservation,
  releaseHold,
  convertHoldToWalkIn,
  markRentalPickedUp,
  markRentalReturned,
  createWalkInRental,
  createPoolSeat,
  deletePoolSeat,
  addSeatToGroup,
  removeGroupSeat,
  removeFailedReservation,
  collectReservationPayment,
  getCollectStatus,
  cancelCollection,
} from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { issueReservationRefund } from '@repo/data/refund'
import {
  createReservationMolliePayment,
  reverifyAndFinalizeReservation,
} from '@repo/data/reservation-payment'
import {
  reserveWithConflictGuard,
  moveReservationWithConflictGuard,
  createRentalBookingsWithGuard,
} from '@repo/data/reservations'
import dayjs from 'dayjs'

const mockAuth = vi.mocked(auth)
const mockGuard = vi.mocked(reserveWithConflictGuard)
const mockMoveGuard = vi.mocked(moveReservationWithConflictGuard)
const mockRentalGuard = vi.mocked(createRentalBookingsWithGuard)

const OWNER_ID = 'owner-1'
const OTHER_ID = 'other-1'
const SITE_ID = 'site-1'
const ITEM_ID = 'item-1'
const RES_ID = 'res-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  // Guard defaults: success paths. Override in conflict/unavailable tests.
  mockGuard.mockResolvedValue({ outcome: 'created', reservationId: 'r1' })
  mockMoveGuard.mockResolvedValue({ outcome: 'moved' })
  mockRentalGuard.mockResolvedValue({ outcome: 'created', bookingIds: ['rb1'] })
})

function authenticateAsOwner() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
}

function authenticateAsNonOwner() {
  mockAuth.mockResolvedValue({ user: { id: OTHER_ID } } as any)
  vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
}

// ─── Authorization ─────────────────────────────────────────────────────────

describe('manage actions authorization', () => {
  it('rejects unauthenticated user for reserveItem', async () => {
    const res = await reserveItem(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('rejects non-owner for reserveItem', async () => {
    authenticateAsNonOwner()
    const res = await reserveItem(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('rejects unauthenticated for checkInReservation', async () => {
    const res = await checkInReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('rejects non-owner for markDeparted', async () => {
    authenticateAsNonOwner()
    const res = await markDeparted(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('rejects non-owner for blockBed', async () => {
    authenticateAsNonOwner()
    const res = await blockBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('rejects non-owner for createWalkInRental', async () => {
    authenticateAsNonOwner()
    const res = await createWalkInRental({
      siteId: SITE_ID,
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'days',
      paymentType: 'cash',
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })
})

// ─── reserveItem (walk-in) ──────────────────────────────────────────────────

describe('reserveItem', () => {
  it('creates walk-in reservation with paid-in-cash status', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null) // no pair

    const res = await reserveItem(SITE_ID, ITEM_ID, 'John', 'VIP guest')
    expect(res.status).toBe('ok')

    // Guard is called — check the data it received
    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.status).toBe('paid-in-cash')
    expect(guardCall.operationalStatus).toBe('walked-in')
    expect(guardCall.guestName).toBe('John')
    expect(guardCall.internalNotes).toBe('VIP guest')
    expect(guardCall.itemIds).toEqual([ITEM_ID])
    expect(guardCall.siteId).toBe(SITE_ID)
    // prisma.reservation.create must NOT be called directly (guard owns create)
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('includes paired item automatically via SunbedGroup', async () => {
    authenticateAsOwner()
    // getGroupMemberIds: findUnique returns an item with a sunbedGroupId
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: ITEM_ID,
      pairId: 'pair-1',
      sunbedGroupId: 'group-1',
      pairedBy: null,
    } as any)
    // findMany for siblings
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'pair-1' }] as any)

    await reserveItem(SITE_ID, ITEM_ID)

    // Guard must receive the fully expanded id list (primary + sibling)
    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toEqual([ITEM_ID, 'pair-1'])
  })

  it('includes paired item automatically via legacy pairId fallback', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: ITEM_ID,
      pairId: 'pair-1',
      sunbedGroupId: null,
      pairedBy: null,
    } as any)

    await reserveItem(SITE_ID, ITEM_ID)

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toEqual([ITEM_ID, 'pair-1'])
  })

  it('truncates guest name to 200 chars and notes to 500', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    await reserveItem(SITE_ID, ITEM_ID, 'A'.repeat(300), 'B'.repeat(600))

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.guestName).toHaveLength(200)
    expect(guardCall.internalNotes).toHaveLength(500)
  })

  it('defaults to a single-day (today) reservation when no end date given', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    await reserveItem(SITE_ID, ITEM_ID)

    const guardCall = mockGuard.mock.calls[0][0]
    expect((guardCall.from as Date).getTime()).toBe(dayjs().startOf('day').toDate().getTime())
    expect((guardCall.to as Date).getTime()).toBe(dayjs().endOf('day').toDate().getTime())
  })

  it('extends the reservation to the end of the given `until` date', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    const until = dayjs().add(3, 'day').format('YYYY-MM-DD')
    const res = await reserveItem(SITE_ID, ITEM_ID, undefined, undefined, undefined, until)
    expect(res.status).toBe('ok')

    const guardCall = mockGuard.mock.calls[0][0]
    expect((guardCall.from as Date).getTime()).toBe(dayjs().startOf('day').toDate().getTime())
    expect((guardCall.to as Date).getTime()).toBe(dayjs(until).endOf('day').toDate().getTime())
  })

  it('passes the expanded id list (primary + siblings) to the guard for conflict checking', async () => {
    // This is the fix for the pair-expansion double-booking bug: siblings must
    // be expanded BEFORE the guard call, so the guard's conflict check covers them.
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: ITEM_ID, pairId: 'pair-1', sunbedGroupId: 'group-1', pairedBy: null,
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'pair-1' }] as any)

    const until = dayjs().add(2, 'day').format('YYYY-MM-DD')
    await reserveItem(SITE_ID, ITEM_ID, undefined, undefined, undefined, until)

    const guardCall = mockGuard.mock.calls[0][0]
    // Both the primary item AND the sibling must reach the guard
    expect(guardCall.itemIds).toContain(ITEM_ID)
    expect(guardCall.itemIds).toContain('pair-1')
    expect((guardCall.to as Date).getTime()).toBe(dayjs(until).endOf('day').toDate().getTime())
    expect((guardCall.from as Date).getTime()).toBe(dayjs().startOf('day').toDate().getTime())
  })

  it('rejects when the guard returns a conflict', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)
    mockGuard.mockResolvedValueOnce({ outcome: 'conflict', conflictingReservationId: 'existing' })

    const until = dayjs().add(4, 'day').format('YYYY-MM-DD')
    const res = await reserveItem(SITE_ID, ITEM_ID, undefined, undefined, undefined, until)

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/already reserved/i)
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('rejects an invalid end date', async () => {
    authenticateAsOwner()
    const res = await reserveItem(SITE_ID, ITEM_ID, undefined, undefined, undefined, 'not-a-date')
    expect(res.status).toBe('error')
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('rejects an end date in the past', async () => {
    authenticateAsOwner()
    const until = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
    const res = await reserveItem(SITE_ID, ITEM_ID, undefined, undefined, undefined, until)
    expect(res.status).toBe('error')
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('rejects a range longer than 90 days', async () => {
    authenticateAsOwner()
    const until = dayjs().add(91, 'day').format('YYYY-MM-DD')
    const res = await reserveItem(SITE_ID, ITEM_ID, undefined, undefined, undefined, until)
    expect(res.status).toBe('error')
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })
})

// ─── unreserveItem ─────────────────────────────────────────────────────────

describe('unreserveItem', () => {
  it('deletes walk-in with overlap-with-today filter and returns ok when count > 0', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await unreserveItem(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')

    const deleteCall = vi.mocked(prisma.reservation.deleteMany).mock.calls[0][0]
    const where = deleteCall?.where as any
    // Overlap semantics: from <= todayEnd AND to >= todayStart
    expect(where.from).toHaveProperty('lte')
    expect(where.to).toHaveProperty('gte')
    // Must NOT use the old fully-contained filter shapes
    expect(where.from).not.toHaveProperty('gte')
    expect(where.to).not.toHaveProperty('lte')
    // Core ownership + status filters must remain
    expect(where.siteId).toBe(SITE_ID)
    expect(where.status).toBe('paid-in-cash')
    expect(where.operationalStatus).toBe('walked-in')
    expect(where.items.some.id).toBe(ITEM_ID)
  })

  it('returns error when deleteMany finds nothing (count === 0)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 0 } as any)

    const res = await unreserveItem(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/no walk-in reservation found/i)
  })

  it('does not call revalidatePath when nothing was deleted', async () => {
    const { revalidatePath } = await import('next/cache')
    authenticateAsOwner()
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 0 } as any)

    await unreserveItem(SITE_ID, ITEM_ID)
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated caller without touching the DB', async () => {
    const res = await unreserveItem(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })
})

// ─── checkInReservation ─────────────────────────────────────────────────────

describe('checkInReservation', () => {
  it('transitions expected -> checked-in', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'expected',
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await checkInReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('ok')

    const updateCall = vi.mocked(prisma.reservation.update).mock.calls[0][0]
    expect(updateCall.data.operationalStatus).toBe('checked-in')
    expect(updateCall.data.checkedInAt).toBeInstanceOf(Date)
  })

  it('rejects check-in from non-expected status', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'checked-in',
    } as any)

    const res = await checkInReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot check in')
  })

  it('rejects reservation belonging to different site', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: 'other-site',
      operationalStatus: 'expected',
    } as any)

    const res = await checkInReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Reservation not found')
  })
})

// ─── markDeparted ───────────────────────────────────────────────────────────

describe('markDeparted', () => {
  it('transitions checked-in -> departed', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'checked-in',
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await markDeparted(SITE_ID, RES_ID)
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.reservation.update).mock.calls[0][0].data.operationalStatus).toBe('departed')
  })

  it('transitions walked-in -> departed', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'walked-in',
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await markDeparted(SITE_ID, RES_ID)
    expect(res.status).toBe('ok')
  })

  it('rejects departure from expected status', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'expected',
    } as any)

    const res = await markDeparted(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot mark departed')
  })
})

// ─── markNoShow ─────────────────────────────────────────────────────────────

describe('markNoShow', () => {
  it('transitions expected -> no-show', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'expected',
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await markNoShow(SITE_ID, RES_ID)
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.reservation.update).mock.calls[0][0].data.operationalStatus).toBe('no-show')
  })

  it('rejects no-show from checked-in', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'checked-in',
    } as any)

    const res = await markNoShow(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
  })
})

// ─── updateReservationNotes ─────────────────────────────────────────────────

describe('updateReservationNotes', () => {
  it('updates notes and truncates to 500 chars', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ siteId: SITE_ID } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const longNotes = 'X'.repeat(600)
    const res = await updateReservationNotes(SITE_ID, RES_ID, longNotes)
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.reservation.update).mock.calls[0][0].data.internalNotes).toHaveLength(500)
  })
})

// ─── moveReservation ────────────────────────────────────────────────────────

describe('moveReservation', () => {
  it('calls move guard with expanded item list and returns ok', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'checked-in',
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { id: 'new-item-1' },
      { id: 'new-item-2' },
    ] as any)
    // getGroupMemberIds: no siblings for either new item
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    const res = await moveReservation(SITE_ID, RES_ID, ['new-item-1', 'new-item-2'])
    expect(res.status).toBe('ok')

    // Guard must be called with the reservation id and the (un-expanded) item list
    expect(mockMoveGuard).toHaveBeenCalledWith(RES_ID, ['new-item-1', 'new-item-2'])
    // prisma.reservation.update must NOT be called directly — guard owns the write
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('expands SunbedGroup siblings of newItemIds before calling the guard', async () => {
    // Ensures the conflict check sees the full pair, not just the requested item.
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'checked-in',
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { id: 'new-item-1' },
    ] as any)
    // getGroupMemberIds for 'new-item-1' → SunbedGroup sibling 'sibling-1'
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      pairId: null,
      sunbedGroupId: 'group-1',
      pairedBy: null,
    } as any)
    // findMany for group members
    vi.mocked(prisma.inventoryItem.findMany)
      .mockResolvedValueOnce([{ id: 'new-item-1' }] as any) // validation findMany
      .mockResolvedValueOnce([{ id: 'sibling-1' }] as any) // group siblings findMany

    const res = await moveReservation(SITE_ID, RES_ID, ['new-item-1'])
    expect(res.status).toBe('ok')

    // Guard must receive the expanded list including the sibling
    const guardArgs = mockMoveGuard.mock.calls[0]
    expect(guardArgs[0]).toBe(RES_ID)
    expect(guardArgs[1]).toContain('new-item-1')
    expect(guardArgs[1]).toContain('sibling-1')
  })

  it('rejects move when guard returns conflict (target bed already occupied)', async () => {
    // This is the bug that moveReservationWithConflictGuard fixes: the old code
    // used a bare prisma.reservation.update with no conflict check, allowing the
    // move to double-book a bed already reserved by another reservation.
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'checked-in',
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { id: 'new-item-1' },
    ] as any)
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    mockMoveGuard.mockResolvedValueOnce({
      outcome: 'conflict',
      conflictingReservationId: 'other-res',
    })

    const res = await moveReservation(SITE_ID, RES_ID, ['new-item-1'])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/already reserved/i)
    // Guard ran; prisma.reservation.update must NOT have been called
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('rejects move for departed reservation', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'departed',
    } as any)

    const res = await moveReservation(SITE_ID, RES_ID, ['new-1'])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Cannot move')
  })

  it('rejects move for no-show reservation', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'no-show',
    } as any)

    const res = await moveReservation(SITE_ID, RES_ID, ['new-1'])
    expect(res.status).toBe('error')
  })

  it('rejects when new items not found or inactive', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'checked-in',
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'new-1' }] as any) // only 1 of 2

    const res = await moveReservation(SITE_ID, RES_ID, ['new-1', 'new-2'])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('not found or inactive')
  })
})

// ─── Rental Operations ──────────────────────────────────────────────────────

describe('markRentalPickedUp', () => {
  it('transitions reserved -> picked-up', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'reserved',
    } as any)
    vi.mocked(prisma.rentalBooking.update).mockResolvedValue({} as any)

    const res = await markRentalPickedUp(SITE_ID, 'booking-1')
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.rentalBooking.update).mock.calls[0][0].data.operationalStatus).toBe('picked-up')
  })

  it('rejects pickup from non-reserved status', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'picked-up',
    } as any)

    const res = await markRentalPickedUp(SITE_ID, 'booking-1')
    expect(res.status).toBe('error')
  })
})

describe('markRentalReturned', () => {
  it('transitions picked-up -> returned', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'picked-up',
    } as any)
    vi.mocked(prisma.rentalBooking.update).mockResolvedValue({} as any)

    const res = await markRentalReturned(SITE_ID, 'booking-1')
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.rentalBooking.update).mock.calls[0][0].data.operationalStatus).toBe('returned')
  })

  it('rejects return from reserved status', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      operationalStatus: 'reserved',
    } as any)

    const res = await markRentalReturned(SITE_ID, 'booking-1')
    expect(res.status).toBe('error')
  })
})

// ─── createWalkInRental ─────────────────────────────────────────────────────

describe('createWalkInRental', () => {
  it('calls the rental guard with correct daily pricing data and returns ok', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', name: 'Surfboard', siteId: SITE_ID, active: true, totalQuantity: 10, pricePerDay: 15, pricePerHour: null },
    ] as any)
    // Guard default: created (success). No aggregate/create calls expected.

    const res = await createWalkInRental({
      siteId: SITE_ID,
      items: [{ rentalItemId: 'ri-1', quantity: 2 }],
      durationType: 'days',
      paymentType: 'cash',
    })

    expect(res.status).toBe('ok')
    expect(res.bookingIds).toEqual(['rb1']) // from guard mock

    // Guard must be called with correctly-priced booking data
    const [guardInputs] = mockRentalGuard.mock.calls[0]
    expect(guardInputs).toHaveLength(1)
    expect(guardInputs[0].rentalItemId).toBe('ri-1')
    expect(guardInputs[0].status).toBe('paid-in-cash')
    expect(guardInputs[0].operationalStatus).toBe('picked-up')
    expect(guardInputs[0].quantity).toBe(2)

    // prisma.rentalBooking.create must NOT be called directly — guard owns creation
    expect(vi.mocked(prisma.rentalBooking.create)).not.toHaveBeenCalled()
  })

  it('sets zero totalPrice and paymentAmount for free walk-in rental', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', name: 'Kayak', siteId: SITE_ID, active: true, totalQuantity: 10, pricePerDay: 15, pricePerHour: null },
    ] as any)

    await createWalkInRental({
      siteId: SITE_ID,
      items: [{ rentalItemId: 'ri-1', quantity: 1 }],
      durationType: 'days',
      paymentType: 'free',
    })

    const [guardInputs] = mockRentalGuard.mock.calls[0]
    expect(guardInputs[0].totalPrice).toBe(0)
    expect(guardInputs[0].paymentAmount).toBe(0)
  })

  it('rejects when rental item not found or inactive (pre-guard check)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([]) // none found

    const res = await createWalkInRental({
      siteId: SITE_ID,
      items: [{ rentalItemId: 'ri-missing', quantity: 1 }],
      durationType: 'days',
      paymentType: 'cash',
    })

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('not available')
    // Guard must NOT be called — rejected before reaching it
    expect(mockRentalGuard).not.toHaveBeenCalled()
  })

  it('rejects when guard returns unavailable (quantity race closed)', async () => {
    // This is the bug createRentalBookingsWithGuard fixes: the old code checked
    // availability then created in a loop — two concurrent requests could both
    // pass the check and both create, exceeding totalQuantity. The guard
    // collapses check + create into one transaction so the second request sees
    // the first one's bookings before writing.
    authenticateAsOwner()
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', name: 'Paddle Board', siteId: SITE_ID, active: true, totalQuantity: 3, pricePerDay: 10, pricePerHour: null },
    ] as any)
    mockRentalGuard.mockResolvedValueOnce({ outcome: 'unavailable', rentalItemId: 'ri-1' })

    const res = await createWalkInRental({
      siteId: SITE_ID,
      items: [{ rentalItemId: 'ri-1', quantity: 2 }],
      durationType: 'days',
      paymentType: 'cash',
    })

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('available')
    expect(res.errors?.[0]).toContain('Paddle Board')
    // prisma.rentalBooking.create must NOT have been called
    expect(vi.mocked(prisma.rentalBooking.create)).not.toHaveBeenCalled()
  })

  it('passes correct paymentAmount (= totalPrice) to guard for cash walk-in', async () => {
    // paymentAmount === totalPrice for walk-in cash rentals — the operator
    // collects the full price in cash, so the amounts must match for reconciliation
    // and downstream invoicing to work correctly.
    authenticateAsOwner()
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { id: 'ri-1', name: 'Snorkel', siteId: SITE_ID, active: true, totalQuantity: 10, pricePerDay: 20, pricePerHour: null },
    ] as any)

    const res = await createWalkInRental({
      siteId: SITE_ID,
      items: [{ rentalItemId: 'ri-1', quantity: 3 }],
      durationType: 'days',
      paymentType: 'cash',
    })

    expect(res.status).toBe('ok')

    const [guardInputs] = mockRentalGuard.mock.calls[0]
    // totalPrice: 20 (pricePerDay) * 1 (day) * 3 (quantity) = 60
    expect(guardInputs[0].totalPrice).toBe(60)
    expect(guardInputs[0].paymentAmount).toBe(60)
  })
})

// ─── applyToPair = false — single-seat mode ─────────────────────────────────

describe('reserveItem with applyToPair = false', () => {
  it('does NOT look up or add the group members when applyToPair is false', async () => {
    authenticateAsOwner()

    const res = await reserveItem(SITE_ID, ITEM_ID, 'Solo guest', undefined, undefined, undefined, false)
    expect(res.status).toBe('ok')

    // getGroupMemberIds calls inventoryItem.findUnique — must NOT be called
    expect(vi.mocked(prisma.inventoryItem.findUnique)).not.toHaveBeenCalled()

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toEqual([ITEM_ID])
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('still adds group member when applyToPair is true (default behavior preserved)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: ITEM_ID,
      pairId: 'pair-1',
      sunbedGroupId: 'group-1',
      pairedBy: null,
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'pair-1' }] as any)

    await reserveItem(SITE_ID, ITEM_ID, undefined, undefined, undefined, undefined, true)

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toEqual([ITEM_ID, 'pair-1'])
  })
})

describe('blockBed with applyToPair = false', () => {
  it('does NOT look up or add group members when applyToPair is false', async () => {
    authenticateAsOwner()

    const res = await blockBed(SITE_ID, ITEM_ID, undefined, undefined, false)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.inventoryItem.findUnique)).not.toHaveBeenCalled()

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toEqual([ITEM_ID])
    expect(guardCall.operationalStatus).toBe('blocked')
    // blockBed must not call prisma.reservation.create directly
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('still adds group member when applyToPair is true (default behavior preserved)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: ITEM_ID,
      pairId: 'pair-1',
      sunbedGroupId: 'group-1',
      pairedBy: null,
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'pair-1' }] as any)

    await blockBed(SITE_ID, ITEM_ID, undefined, undefined, true)

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toEqual([ITEM_ID, 'pair-1'])
  })

  it('rejects blocking an already-occupied bed (guard returns conflict)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)
    mockGuard.mockResolvedValueOnce({ outcome: 'conflict', conflictingReservationId: 'existing' })

    const res = await blockBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/already occupied or blocked/i)
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('blocks stickily — passes a far-future out-of-service end date to the guard', async () => {
    authenticateAsOwner()

    await blockBed(SITE_ID, ITEM_ID, undefined, undefined, false)

    const guardCall = mockGuard.mock.calls[0][0]
    // A block is sticky: `to` is far in the future so it survives the daily
    // rollover (overlaps every day) and the cleanup cron (to is never < now)
    // until the operator taps Unblock.
    expect((guardCall.to as Date).getUTCFullYear()).toBe(2999)
  })
})

describe('unreserveItem with applyToPair = false', () => {
  it('disconnects this item from a 2-item reservation (partner stays walked-in)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      id: RES_ID,
      items: [{ id: ITEM_ID }, { id: 'pair-1' }],
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await unreserveItem(SITE_ID, ITEM_ID, undefined, false)
    expect(res.status).toBe('ok')

    // Update called to disconnect — not deleteMany
    expect(vi.mocked(prisma.reservation.update)).toHaveBeenCalledWith({
      where: { id: RES_ID },
      data: { items: { disconnect: [{ id: ITEM_ID }] } },
    })
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('deletes the whole reservation when it has only 1 item', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      id: RES_ID,
      items: [{ id: ITEM_ID }],
    } as any)
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await unreserveItem(SITE_ID, ITEM_ID, undefined, false)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.reservation.deleteMany)).toHaveBeenCalledWith({
      where: { id: RES_ID, siteId: SITE_ID },
    })
  })

  it('returns error when no walk-in reservation found (single mode)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null)

    const res = await unreserveItem(SITE_ID, ITEM_ID, undefined, false)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/no walk-in reservation found/i)
  })

  it('pair mode (true) still uses deleteMany to free both seats', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await unreserveItem(SITE_ID, ITEM_ID, undefined, true)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.reservation.deleteMany)).toHaveBeenCalled()
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })
})

// ─── Pool Seat Actions ──────────────────────────────────────────────────────

describe('createPoolSeat', () => {
  it('creates first pool seat for parcel with number parcel*10000+9901', async () => {
    authenticateAsOwner()
    // No existing pool seats in the band
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([])
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({} as any)

    const res = await createPoolSeat(SITE_ID, 1)
    expect(res.status).toBe('ok')

    const createCall = vi.mocked(prisma.inventoryItem.create).mock.calls[0][0]
    expect(createCall.data.number).toBe(19901) // parcel 1: 1*10000 + 9900 + 1
    expect(createCall.data.status).toBe('pool')
    expect(createCall.data.group).toBe(1)
    expect(createCall.data.locationLat).toBe('0')
    expect(createCall.data.locationLng).toBe('0')
    expect(createCall.data.siteId).toBe(SITE_ID)
  })

  it('computes next seq from max existing pool number', async () => {
    authenticateAsOwner()
    // Two existing seats: 19901 and 19902 (seq 1 and 2)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { number: 19902 }, // highest first (orderBy: number desc)
      { number: 19901 },
    ] as any)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({} as any)

    const res = await createPoolSeat(SITE_ID, 1)
    expect(res.status).toBe('ok')

    const createCall = vi.mocked(prisma.inventoryItem.create).mock.calls[0][0]
    expect(createCall.data.number).toBe(19903) // seq 3
  })

  it('uses parcel-scoped band — parcel 2 starts at 29901', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([])
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({} as any)

    const res = await createPoolSeat(SITE_ID, 2)
    expect(res.status).toBe('ok')

    const createCall = vi.mocked(prisma.inventoryItem.create).mock.calls[0][0]
    expect(createCall.data.number).toBe(29901) // parcel 2: 2*10000 + 9900 + 1
    expect(createCall.data.group).toBe(2)
  })

  it('rejects invalid parcel number', async () => {
    authenticateAsOwner()
    const res = await createPoolSeat(SITE_ID, 0)
    expect(res.status).toBe('error')
    expect(vi.mocked(prisma.inventoryItem.create)).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated caller', async () => {
    const res = await createPoolSeat(SITE_ID, 1)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(vi.mocked(prisma.inventoryItem.create)).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await createPoolSeat(SITE_ID, 1)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(vi.mocked(prisma.inventoryItem.create)).not.toHaveBeenCalled()
  })
})

describe('deletePoolSeat', () => {
  it('deletes a free pool seat successfully', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'pool',
      number: 19901,
    } as any)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null) // no active reservation
    vi.mocked(prisma.inventoryItem.delete).mockResolvedValue({} as any)

    const res = await deletePoolSeat(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.inventoryItem.delete)).toHaveBeenCalledWith({ where: { id: ITEM_ID } })
  })

  it('rejects when pool seat has an active reservation (occupied)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'pool',
      number: 19901,
    } as any)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({ id: RES_ID } as any) // occupied

    const res = await deletePoolSeat(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/release the seat/i)
    expect(vi.mocked(prisma.inventoryItem.delete)).not.toHaveBeenCalled()
  })

  it('rejects deletion of a non-pool item (regular sunbed)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'active', // not a pool seat
      number: 10101,
    } as any)

    const res = await deletePoolSeat(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/not a pool seat/i)
    expect(vi.mocked(prisma.inventoryItem.delete)).not.toHaveBeenCalled()
  })

  it('rejects when item not found or belongs to different site', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: 'other-site',
      status: 'pool',
      number: 19901,
    } as any)

    const res = await deletePoolSeat(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Item not found')
    expect(vi.mocked(prisma.inventoryItem.delete)).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated caller', async () => {
    const res = await deletePoolSeat(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })
})

describe('unblockBed with applyToPair = false', () => {
  it('disconnects this item from a 2-item block reservation (partner stays blocked)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      id: RES_ID,
      items: [{ id: ITEM_ID }, { id: 'pair-1' }],
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await unblockBed(SITE_ID, ITEM_ID, undefined, false)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.reservation.update)).toHaveBeenCalledWith({
      where: { id: RES_ID },
      data: { items: { disconnect: [{ id: ITEM_ID }] } },
    })
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('deletes the whole block reservation when it has only 1 item', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      id: RES_ID,
      items: [{ id: ITEM_ID }],
    } as any)
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await unblockBed(SITE_ID, ITEM_ID, undefined, false)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.reservation.deleteMany)).toHaveBeenCalledWith({
      where: { id: RES_ID, siteId: SITE_ID },
    })
  })

  it('returns ok and does nothing when no block reservation found (single mode)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null)

    const res = await unblockBed(SITE_ID, ITEM_ID, undefined, false)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('pair mode (true) still uses deleteMany to free both seats', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await unblockBed(SITE_ID, ITEM_ID, undefined, true)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.reservation.deleteMany)).toHaveBeenCalled()
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })
})

// ─── addSeatToGroup ──────────────────────────────────────────────────────────

describe('addSeatToGroup', () => {
  it('rejects unauthenticated caller', async () => {
    const res = await addSeatToGroup(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(vi.mocked(prisma.inventoryItem.create)).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await addSeatToGroup(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(vi.mocked(prisma.inventoryItem.create)).not.toHaveBeenCalled()
  })

  it('rejects when item not found or belongs to a different site', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    const res = await addSeatToGroup(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Item not found')
  })

  it('rejects when anchor is a FREE pool seat (no group to add to)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      group: 1,
      number: 19901,
      status: 'pool',
      sunbedGroupId: null,
      pairId: null,
      pairedBy: null,
    } as any)

    const res = await addSeatToGroup(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/pool seat/i)
  })

  it('allows a GROUP-EXTRA pool seat as anchor — adds another extra to the same group', async () => {
    authenticateAsOwner()
    // A group extra: status 'pool' but already linked to a SunbedGroup.
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      group: 1,
      number: 19901,
      status: 'pool',
      sunbedGroupId: 'group-existing',
      pairId: null,
      pairedBy: null,
    } as any)
    // nextPoolNumber: one existing pool seat in the band (the anchor) → next is 19902
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ number: 19901 }] as any)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({ id: 'new-seat-2' } as any)

    const res = await addSeatToGroup(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')
    // Reuses the anchor's group, never creates a new SunbedGroup.
    expect(vi.mocked(prisma.sunbedGroup.create)).not.toHaveBeenCalled()
    const createCall = vi.mocked(prisma.inventoryItem.create).mock.calls[0][0]
    expect(createCall.data.sunbedGroupId).toBe('group-existing')
    expect(createCall.data.status).toBe('pool')
  })

  it('uses existing sunbedGroupId without creating a new SunbedGroup', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      group: 1,
      number: 10101,
      status: 'active',
      sunbedGroupId: 'group-existing',
      pairId: null,
      pairedBy: null,
    } as any)
    // nextPoolNumber: no existing pool seats in band
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([])
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({ id: 'new-seat-1' } as any)

    const res = await addSeatToGroup(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')

    // No SunbedGroup.create should have been called
    expect(vi.mocked(prisma.sunbedGroup.create)).not.toHaveBeenCalled()

    const createCall = vi.mocked(prisma.inventoryItem.create).mock.calls[0][0]
    expect(createCall.data.sunbedGroupId).toBe('group-existing')
    expect(createCall.data.status).toBe('pool')
    expect(createCall.data.number).toBe(19901) // parcel 1 first pool seat
    expect(createCall.data.locationLat).toBe('0')
    expect(createCall.data.locationLng).toBe('0')
    expect(createCall.data.schematicX).toBeNull()
    expect(createCall.data.schematicY).toBeNull()
  })

  it('self-heals when anchor has pairId: creates SunbedGroup and updates anchor + pair partner', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      group: 2,
      number: 20101,
      status: 'active',
      sunbedGroupId: null,
      pairId: 'pair-item-1',
      pairedBy: null,
    } as any)
    // nextPoolNumber: no existing pool seats for parcel 2
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([])
    vi.mocked(prisma.sunbedGroup.create).mockResolvedValue({ id: 'group-new' } as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({ id: 'new-seat-2' } as any)

    const res = await addSeatToGroup(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')

    // A new SunbedGroup must have been created
    expect(vi.mocked(prisma.sunbedGroup.create)).toHaveBeenCalledWith({ data: { siteId: SITE_ID } })

    // Both the anchor and its pairId partner must have been updated
    const updateCalls = vi.mocked(prisma.inventoryItem.update).mock.calls
    const updatedIds = updateCalls.map(c => (c[0] as any).where.id)
    expect(updatedIds).toContain(ITEM_ID)
    expect(updatedIds).toContain('pair-item-1')
    const updatedGroupIds = updateCalls.map(c => (c[0] as any).data.sunbedGroupId)
    expect(updatedGroupIds).toEqual(['group-new', 'group-new'])

    // Extra seat must be created in parcel 2's pool band
    const createCall = vi.mocked(prisma.inventoryItem.create).mock.calls[0][0]
    expect(createCall.data.number).toBe(29901) // parcel 2 first pool seat
    expect(createCall.data.sunbedGroupId).toBe('group-new')
    expect(createCall.data.group).toBe(2)
  })

  it('self-heals when anchor has pairedBy (back-ref): updates back-ref partner', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      group: 1,
      number: 10102,
      status: 'active',
      sunbedGroupId: null,
      pairId: null,
      pairedBy: { id: 'pair-primary-1' },
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([])
    vi.mocked(prisma.sunbedGroup.create).mockResolvedValue({ id: 'group-backref' } as any)
    vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({ id: 'new-seat-3' } as any)

    const res = await addSeatToGroup(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')

    const updateCalls = vi.mocked(prisma.inventoryItem.update).mock.calls
    const updatedIds = updateCalls.map(c => (c[0] as any).where.id)
    expect(updatedIds).toContain(ITEM_ID)
    expect(updatedIds).toContain('pair-primary-1')
  })

  it('creates the extra seat with correct band number for sequential seats', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      group: 1,
      number: 10101,
      status: 'active',
      sunbedGroupId: 'group-existing',
      pairId: null,
      pairedBy: null,
    } as any)
    // Two seats already in the band: seq 1 and 2
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { number: 19902 },
      { number: 19901 },
    ] as any)
    vi.mocked(prisma.inventoryItem.create).mockResolvedValue({ id: 'new-seat-4' } as any)

    const res = await addSeatToGroup(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')

    const createCall = vi.mocked(prisma.inventoryItem.create).mock.calls[0][0]
    expect(createCall.data.number).toBe(19903) // seq 3
  })

  it('rejects when pool band is exhausted (seq > 99)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      group: 1,
      number: 10101,
      status: 'active',
      sunbedGroupId: 'group-existing',
      pairId: null,
      pairedBy: null,
    } as any)
    // Highest existing is seq 99 (number 19999)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { number: 19999 },
    ] as any)

    const res = await addSeatToGroup(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/maximum pool seats/i)
    expect(vi.mocked(prisma.inventoryItem.create)).not.toHaveBeenCalled()
  })
})

// ─── removeGroupSeat ─────────────────────────────────────────────────────────

describe('removeGroupSeat', () => {
  it('rejects unauthenticated caller', async () => {
    const res = await removeGroupSeat(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(vi.mocked(prisma.inventoryItem.delete)).not.toHaveBeenCalled()
  })

  it('rejects a plain pool seat that has no sunbedGroupId', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'pool',
      sunbedGroupId: null,
    } as any)

    const res = await removeGroupSeat(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/not a group extra seat/i)
    expect(vi.mocked(prisma.inventoryItem.delete)).not.toHaveBeenCalled()
  })

  it('rejects a regular (non-pool) active item even with a sunbedGroupId', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'active',
      sunbedGroupId: 'group-1',
    } as any)

    const res = await removeGroupSeat(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/not a group extra seat/i)
    expect(vi.mocked(prisma.inventoryItem.delete)).not.toHaveBeenCalled()
  })

  it('rejects when item not found or belongs to different site', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: 'other-site',
      status: 'pool',
      sunbedGroupId: 'group-1',
    } as any)

    const res = await removeGroupSeat(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Item not found')
    expect(vi.mocked(prisma.inventoryItem.delete)).not.toHaveBeenCalled()
  })

  it('rejects when the seat has an active reservation today', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'pool',
      sunbedGroupId: 'group-1',
    } as any)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({ id: RES_ID } as any)

    const res = await removeGroupSeat(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/release the seat/i)
    expect(vi.mocked(prisma.inventoryItem.delete)).not.toHaveBeenCalled()
  })

  it('deletes the group extra seat and revalidates when free', async () => {
    const { revalidatePath } = await import('next/cache')
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'pool',
      sunbedGroupId: 'group-1',
    } as any)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null) // no active reservation
    vi.mocked(prisma.inventoryItem.delete).mockResolvedValue({} as any)

    const res = await removeGroupSeat(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.inventoryItem.delete)).toHaveBeenCalledWith({ where: { id: ITEM_ID } })
    expect(vi.mocked(revalidatePath)).toHaveBeenCalled()
  })
})

// ─── compBed ────────────────────────────────────────────────────────────────

describe('compBed', () => {
  it('creates a comp reservation with OP_COMP, isComp:true, and paymentAmount:0', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null) // no pair

    const res = await compBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.status).toBe('paid-in-cash')
    expect(guardCall.operationalStatus).toBe('comp')
    expect(guardCall.isComp).toBe(true)
    expect(guardCall.paymentAmount).toBe(0)
    expect(guardCall.itemIds).toEqual([ITEM_ID])
    expect(guardCall.siteId).toBe(SITE_ID)
    // Guard owns the create — no direct prisma.reservation.create
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('stores guestName and notes when provided', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    await compBed(SITE_ID, ITEM_ID, undefined, true, 'VIP Guest', 'Staff member')

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.guestName).toBe('VIP Guest')
    expect(guardCall.internalNotes).toBe('Staff member')
  })

  it('truncates guestName to 200 chars and notes to 500', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    await compBed(SITE_ID, ITEM_ID, undefined, true, 'A'.repeat(300), 'B'.repeat(600))

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.guestName).toHaveLength(200)
    expect(guardCall.internalNotes).toHaveLength(500)
  })

  it('expands paired item via SunbedGroup when applyToPair is true', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: ITEM_ID,
      pairId: null,
      sunbedGroupId: 'group-1',
      pairedBy: null,
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'pair-1' }] as any)

    await compBed(SITE_ID, ITEM_ID)

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toEqual([ITEM_ID, 'pair-1'])
  })

  it('does NOT expand pair when applyToPair is false', async () => {
    authenticateAsOwner()

    await compBed(SITE_ID, ITEM_ID, undefined, false)
    expect(vi.mocked(prisma.inventoryItem.findUnique)).not.toHaveBeenCalled()

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toEqual([ITEM_ID])
  })

  it('rejects when the guard returns a conflict', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)
    mockGuard.mockResolvedValueOnce({ outcome: 'conflict', conflictingReservationId: 'existing' })

    const res = await compBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/already occupied or blocked/i)
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated caller', async () => {
    const res = await compBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await compBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(mockGuard).not.toHaveBeenCalled()
  })
})

// ─── uncompBed ───────────────────────────────────────────────────────────────

describe('uncompBed', () => {
  it('pair mode: deletes the whole comp reservation via deleteMany', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await uncompBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')

    const deleteCall = vi.mocked(prisma.reservation.deleteMany).mock.calls[0][0]
    const where = deleteCall?.where as any
    expect(where.siteId).toBe(SITE_ID)
    expect(where.operationalStatus).toBe('comp')
    expect(where.items.some.id).toBe(ITEM_ID)
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('single-seat mode: disconnects this item when reservation has >1 item', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      id: RES_ID,
      items: [{ id: ITEM_ID }, { id: 'pair-1' }],
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await uncompBed(SITE_ID, ITEM_ID, undefined, false)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.reservation.update)).toHaveBeenCalledWith({
      where: { id: RES_ID },
      data: { items: { disconnect: [{ id: ITEM_ID }] } },
    })
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('single-seat mode: deletes the whole comp reservation when it has only 1 item', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      id: RES_ID,
      items: [{ id: ITEM_ID }],
    } as any)
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await uncompBed(SITE_ID, ITEM_ID, undefined, false)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.reservation.deleteMany)).toHaveBeenCalledWith({
      where: { id: RES_ID, siteId: SITE_ID },
    })
  })

  it('single-seat mode: returns ok and does nothing when no comp reservation found', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null)

    const res = await uncompBed(SITE_ID, ITEM_ID, undefined, false)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated caller', async () => {
    const res = await uncompBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await uncompBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })
})

// ─── holdBed ────────────────────────────────────────────────────────────────

describe('holdBed', () => {
  it('creates a hold with status=held, operationalStatus=expected, paymentAmount=0 and no checkedInAt', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null) // no pair

    const res = await holdBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('ok')

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.status).toBe('held')
    expect(guardCall.operationalStatus).toBe('expected')
    expect(guardCall.paymentAmount).toBe(0)
    // No checkedInAt — the guest hasn't arrived yet
    expect(guardCall).not.toHaveProperty('checkedInAt')
    expect(guardCall.itemIds).toEqual([ITEM_ID])
    expect(guardCall.siteId).toBe(SITE_ID)
    // Guard owns the create — no direct prisma.reservation.create
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('stores guestName and notes when provided', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    await holdBed(SITE_ID, ITEM_ID, undefined, true, 'Maria', 'VIP table requested')

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.guestName).toBe('Maria')
    expect(guardCall.internalNotes).toBe('VIP table requested')
  })

  it('truncates guestName to 200 chars and notes to 500', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    await holdBed(SITE_ID, ITEM_ID, undefined, true, 'A'.repeat(300), 'B'.repeat(600))

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.guestName).toHaveLength(200)
    expect(guardCall.internalNotes).toHaveLength(500)
  })

  it('sets from=today-start and to=today-end (today-only hold)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)

    await holdBed(SITE_ID, ITEM_ID)

    const guardCall = mockGuard.mock.calls[0][0]
    expect((guardCall.from as Date).getTime()).toBe(dayjs().startOf('day').toDate().getTime())
    expect((guardCall.to as Date).getTime()).toBe(dayjs().endOf('day').toDate().getTime())
  })

  it('expands paired item via SunbedGroup when applyToPair is true (default)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: ITEM_ID,
      pairId: null,
      sunbedGroupId: 'group-1',
      pairedBy: null,
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'pair-1' }] as any)

    await holdBed(SITE_ID, ITEM_ID)

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toEqual([ITEM_ID, 'pair-1'])
  })

  it('does NOT expand pair when applyToPair is false', async () => {
    authenticateAsOwner()

    await holdBed(SITE_ID, ITEM_ID, undefined, false)
    expect(vi.mocked(prisma.inventoryItem.findUnique)).not.toHaveBeenCalled()

    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toEqual([ITEM_ID])
  })

  it('rejects when the guard returns a conflict (bed already occupied)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue(null)
    mockGuard.mockResolvedValueOnce({ outcome: 'conflict', conflictingReservationId: 'existing' })

    const res = await holdBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/already occupied or blocked/i)
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated caller', async () => {
    const res = await holdBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(mockGuard).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await holdBed(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(mockGuard).not.toHaveBeenCalled()
  })
})

// ─── cancelReservation ─────────────────────────────────────────────────────

describe('cancelReservation', () => {
  it('rejects unauthenticated caller', async () => {
    const res = await cancelReservation(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(vi.mocked(prisma.reservation.findFirst)).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await cancelReservation(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(vi.mocked(prisma.reservation.findFirst)).not.toHaveBeenCalled()
  })

  it('finds the active COMPLETE reservation and sets status=canceled when not refunded', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      refundedAt: null,
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    const res = await cancelReservation(SITE_ID, ITEM_ID)

    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.reservation.update)).toHaveBeenCalledWith({
      where: { id: RES_ID },
      data: { status: 'canceled' },
    })
  })

  it('sets status=refunded when a refund was already issued (refundedAt set)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      refundedAt: new Date(),
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    const res = await cancelReservation(SITE_ID, ITEM_ID)

    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.reservation.update)).toHaveBeenCalledWith({
      where: { id: RES_ID },
      data: { status: 'refunded' },
    })
  })

  it('is idempotent: returns ok without calling update when already terminal (canceled/refunded)', async () => {
    authenticateAsOwner()
    // First findFirst (looking for COMPLETE): no match
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null)
    // Second findFirst (looking for already-terminal): match
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({ id: RES_ID } as any)

    const res = await cancelReservation(SITE_ID, ITEM_ID)

    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('returns error when no active or canceled reservation found', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null)

    const res = await cancelReservation(SITE_ID, ITEM_ID)

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/no active reservation found/i)
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })
})

// ─── refundReservation ──────────────────────────────────────────────────────

describe('refundReservation', () => {
  it('rejects unauthenticated caller', async () => {
    const res = await refundReservation(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(vi.mocked(issueReservationRefund)).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await refundReservation(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(vi.mocked(issueReservationRefund)).not.toHaveBeenCalled()
  })

  it('issues the refund and stamps refundedAt (bed stays occupied — no status change)', async () => {
    authenticateAsOwner()
    // site.findUnique must satisfy BOTH the auth lookup (.userId) and the
    // partner-account resolution (.user.partnerAccount.userId).
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      userId: OWNER_ID,
      user: { partnerAccount: { userId: 'pa-1' } },
    } as any)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      paymentRef: 'tr_test123',
      refundedAt: null,
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    const res = await refundReservation(SITE_ID, ITEM_ID)

    expect(res.status).toBe('ok')
    expect(vi.mocked(issueReservationRefund)).toHaveBeenCalledWith('tr_test123', 'pa-1')
    const updateArg = vi.mocked(prisma.reservation.update).mock.calls[0]![0] as any
    expect(updateArg.where).toEqual({ id: RES_ID })
    expect(updateArg.data.refundedAt).toBeInstanceOf(Date)
    // Refund must NOT change the payment status — the bed stays occupied.
    expect(updateArg.data.status).toBeUndefined()
  })

  it('is idempotent: already-refunded reservation does not call Mollie again', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      paymentRef: 'tr_test123',
      refundedAt: new Date(),
    } as any)

    const res = await refundReservation(SITE_ID, ITEM_ID)

    expect(res.status).toBe('ok')
    expect(vi.mocked(issueReservationRefund)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('returns the provider error without stamping refundedAt when the refund fails', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      paymentRef: 'tr_test123',
      refundedAt: null,
    } as any)
    vi.mocked(issueReservationRefund).mockResolvedValueOnce({
      status: 'error',
      error: 'Mollie refund failed (422)',
    })

    const res = await refundReservation(SITE_ID, ITEM_ID)

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/mollie refund failed/i)
    expect((res as { needsReconnect?: boolean }).needsReconnect).toBe(false)
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('flags needsReconnect when the refund 403s for missing permission', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      userId: OWNER_ID,
      user: { partnerAccount: { userId: 'pa-1' } },
    } as any)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      paymentRef: 'tr_test123',
      refundedAt: null,
    } as any)
    vi.mocked(issueReservationRefund).mockResolvedValueOnce({
      status: 'error',
      error: 'Refunds are not enabled on this Mollie connection — reconnect Mollie to grant refund permission.',
      reason: 'permission',
    })

    const res = await refundReservation(SITE_ID, ITEM_ID)

    expect(res.status).toBe('error')
    expect((res as { needsReconnect?: boolean }).needsReconnect).toBe(true)
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('returns error when no paid reservation is found', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null)

    const res = await refundReservation(SITE_ID, ITEM_ID)

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/no paid reservation found/i)
    expect(vi.mocked(issueReservationRefund)).not.toHaveBeenCalled()
  })
})

// ─── moveReservationToSeats ─────────────────────────────────────────────────

describe('moveReservationToSeats', () => {
  it('rejects unauthenticated caller', async () => {
    const res = await moveReservationToSeats(SITE_ID, RES_ID, [ITEM_ID])
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(mockMoveGuard).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await moveReservationToSeats(SITE_ID, RES_ID, [ITEM_ID])
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(mockMoveGuard).not.toHaveBeenCalled()
  })

  it('errors when destination count != reservation seat count', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      siteId: SITE_ID, operationalStatus: 'expected', items: [{ id: 'a' }],
    } as any)
    const res = await moveReservationToSeats(SITE_ID, RES_ID, ['d1', 'd2'])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/same number of seats/i)
    expect(mockMoveGuard).not.toHaveBeenCalled()
  })

  it('relocates a single-seat reservation to the exact destination (no group expansion)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      siteId: SITE_ID, operationalStatus: 'expected', items: [{ id: 'a' }],
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValueOnce([{ id: 'd1' }] as any)
    mockMoveGuard.mockResolvedValueOnce({ outcome: 'moved' } as any)

    const res = await moveReservationToSeats(SITE_ID, RES_ID, ['d1'])
    expect(res.status).toBe('ok')
    expect(mockMoveGuard).toHaveBeenCalledWith(RES_ID, ['d1'])
  })

  it('relocates a 3-seat group booking (active + pool extra) to a 3-seat destination', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      siteId: SITE_ID, operationalStatus: 'walked-in', items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    } as any)
    // destination resolves to 3 real seats (2 active + 1 pool extra)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValueOnce([{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }] as any)
    mockMoveGuard.mockResolvedValueOnce({ outcome: 'moved' } as any)

    const res = await moveReservationToSeats(SITE_ID, RES_ID, ['d1', 'd2', 'd3'])
    expect(res.status).toBe('ok')
    expect(mockMoveGuard).toHaveBeenCalledWith(RES_ID, ['d1', 'd2', 'd3'])
  })

  it('errors when a destination seat is not found or inactive', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      siteId: SITE_ID, operationalStatus: 'expected', items: [{ id: 'a' }],
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValueOnce([] as any)
    const res = await moveReservationToSeats(SITE_ID, RES_ID, ['d1'])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/not available/i)
    expect(mockMoveGuard).not.toHaveBeenCalled()
  })

  it('surfaces a conflict from the guard', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      siteId: SITE_ID, operationalStatus: 'expected', items: [{ id: 'a' }],
    } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValueOnce([{ id: 'd1' }] as any)
    mockMoveGuard.mockResolvedValueOnce({ outcome: 'conflict' } as any)
    const res = await moveReservationToSeats(SITE_ID, RES_ID, ['d1'])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/already reserved/i)
  })

  it('refuses to move a departed/terminal reservation', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      siteId: SITE_ID, operationalStatus: 'departed', items: [{ id: 'a' }],
    } as any)
    const res = await moveReservationToSeats(SITE_ID, RES_ID, ['d1'])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/completed reservation/i)
    expect(mockMoveGuard).not.toHaveBeenCalled()
  })
})

// ─── releaseHold ────────────────────────────────────────────────────────────

describe('releaseHold', () => {
  it('rejects unauthenticated caller', async () => {
    const res = await releaseHold(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await releaseHold(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('deletes the held reservation when found (pair/default mode)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValueOnce({ count: 1 } as any)

    const res = await releaseHold(SITE_ID, ITEM_ID)

    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.reservation.deleteMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          siteId: SITE_ID,
          status: 'held',
          items: { some: { id: ITEM_ID } },
        }),
      })
    )
  })

  it('returns ok (no-op) when no held reservation exists', async () => {
    // In pair mode, deleteMany is always called — count=0 just means nothing was there.
    // The action must NOT treat count=0 as an error (idempotent release).
    authenticateAsOwner()
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValueOnce({ count: 0 } as any)

    const res = await releaseHold(SITE_ID, ITEM_ID)

    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.reservation.deleteMany)).toHaveBeenCalled()
  })
})

// ─── convertHoldToWalkIn ─────────────────────────────────────────────────────

describe('convertHoldToWalkIn', () => {
  it('rejects unauthenticated caller', async () => {
    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(vi.mocked(prisma.reservation.findFirst)).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(vi.mocked(prisma.reservation.findFirst)).not.toHaveBeenCalled()
  })

  it('finds the held reservation by itemId and updates it to paid-in-cash + walked-in', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({ id: RES_ID } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID)

    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.reservation.update)).toHaveBeenCalledWith({
      where: { id: RES_ID },
      data: expect.objectContaining({
        status: 'paid-in-cash',
        operationalStatus: 'walked-in',
        checkedInAt: expect.any(Date),
      }),
    })
  })

  it('applies the passed guestName when non-empty', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({ id: RES_ID } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, 'Maria')

    const updateData = vi.mocked(prisma.reservation.update).mock.calls[0][0].data as any
    expect(updateData.guestName).toBe('Maria')
  })

  it('does NOT set guestName when none is passed (preserves existing hold name)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({ id: RES_ID } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, undefined)

    const updateData = vi.mocked(prisma.reservation.update).mock.calls[0][0].data as any
    expect(updateData).not.toHaveProperty('guestName')
  })

  it('does NOT set guestName when an empty string is passed', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({ id: RES_ID } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, '')

    const updateData = vi.mocked(prisma.reservation.update).mock.calls[0][0].data as any
    expect(updateData).not.toHaveProperty('guestName')
  })

  it('returns error when no held reservation is found for this item today', async () => {
    // Bug case: a held guest arrives on a bed that was already converted or released.
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null)

    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID)

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/no held reservation found/i)
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('queries only status=held reservations (does not match walk-in or paid bookings)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null) // simulates no held res

    await convertHoldToWalkIn(SITE_ID, ITEM_ID)

    const findFirstArgs = vi.mocked(prisma.reservation.findFirst).mock.calls[0][0] as any
    expect(findFirstArgs.where.status).toBe('held')
    expect(findFirstArgs.where.items.some.id).toBe(ITEM_ID)
    expect(findFirstArgs.where.siteId).toBe(SITE_ID)
  })

  // ── until (multi-day) extension ──

  it('today-only (no until): sets to=endOf(today) in the update', async () => {
    // The hold already covers today; converting it without an end date keeps
    // the stay as today-only (to = endOf(today)). No transaction needed.
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({ id: RES_ID } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID)

    expect(res.status).toBe('ok')
    const updateData = vi.mocked(prisma.reservation.update).mock.calls[0][0].data as any
    // `to` must be set to endOf(today)
    expect(updateData.to).toBeInstanceOf(Date)
    expect((updateData.to as Date).getTime()).toBe(dayjs().endOf('day').toDate().getTime())
    // Must not have run the $transaction path — $transaction stays uncalled for today-only
    expect(vi.mocked(prisma.$transaction)).not.toHaveBeenCalled()
  })

  it('multi-day: sets to=endOf(until) and runs atomically inside $transaction', async () => {
    // Extending beyond today must re-check availability. The $transaction mock
    // executes the callback synchronously with the same prisma mock as tx, so
    // we can verify both the hold lookup and the update in one test.
    authenticateAsOwner()
    const until = dayjs().add(3, 'day').format('YYYY-MM-DD')

    // First findFirst (hold lookup inside tx) → found
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      items: [{ id: ITEM_ID }],
    } as any)
    // Second findFirst (conflict check inside tx) → no conflict
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, undefined, until)

    expect(res.status).toBe('ok')
    // Transaction must have been called
    expect(vi.mocked(prisma.$transaction)).toHaveBeenCalled()
    // Update must set the extended to date
    const updateData = vi.mocked(prisma.reservation.update).mock.calls[0][0].data as any
    expect(updateData.to).toBeInstanceOf(Date)
    expect((updateData.to as Date).getTime()).toBe(dayjs(until).endOf('day').toDate().getTime())
    expect(updateData.status).toBe('paid-in-cash')
    expect(updateData.operationalStatus).toBe('walked-in')
  })

  it('multi-day conflict: returns error when another booking overlaps the extended range', async () => {
    // Bug case: operator holds a bed, then tries to extend rent to overlap with a
    // future online booking. The conflict check (excluding the hold itself) must
    // catch this and reject rather than double-booking.
    authenticateAsOwner()
    const until = dayjs().add(5, 'day').format('YYYY-MM-DD')

    // First findFirst (hold lookup) → found with the item
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      items: [{ id: ITEM_ID }],
    } as any)
    // Second findFirst (conflict check) → conflicting reservation exists
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: 'conflicting-res-1',
    } as any)

    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, undefined, until)

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/already reserved for part of this period/i)
    // Update must NOT have been called — conflict aborts the conversion
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('multi-day: self-exclusion — hold is excluded from its own conflict check', async () => {
    // The conflict query must carry `id: { not: hold.id }` so the hold itself
    // does not trigger a false-positive conflict with its own today range.
    authenticateAsOwner()
    const until = dayjs().add(2, 'day').format('YYYY-MM-DD')

    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
      id: RES_ID,
      items: [{ id: ITEM_ID }],
    } as any)
    // No conflict (self correctly excluded)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null)
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce({} as any)

    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, undefined, until)

    expect(res.status).toBe('ok')
    // Verify the conflict query excluded the hold's own id
    const conflictArgs = vi.mocked(prisma.reservation.findFirst).mock.calls[1][0] as any
    expect(conflictArgs.where.id).toEqual({ not: RES_ID })
  })

  it('multi-day: returns error when the held reservation is not found inside transaction', async () => {
    authenticateAsOwner()
    const until = dayjs().add(2, 'day').format('YYYY-MM-DD')
    // findFirst returns null → no held reservation
    vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null)

    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, undefined, until)

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/no held reservation found/i)
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('rejects an invalid until date format', async () => {
    authenticateAsOwner()
    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, undefined, 'not-a-date')
    expect(res.status).toBe('error')
    expect(vi.mocked(prisma.reservation.findFirst)).not.toHaveBeenCalled()
  })

  it('rejects an until date in the past', async () => {
    authenticateAsOwner()
    const past = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, undefined, past)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/in the past/i)
    expect(vi.mocked(prisma.reservation.findFirst)).not.toHaveBeenCalled()
  })

  it('rejects an until range exceeding 90 days', async () => {
    authenticateAsOwner()
    const tooFar = dayjs().add(91, 'day').format('YYYY-MM-DD')
    const res = await convertHoldToWalkIn(SITE_ID, ITEM_ID, undefined, undefined, tooFar)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/90 days/i)
    expect(vi.mocked(prisma.reservation.findFirst)).not.toHaveBeenCalled()
  })
})

// ─── Regression: group-attached pool seat cascades through reserveItem ────────

describe('reserveItem cascade regression: pool seat with sunbedGroupId', () => {
  it('group-extra pool seat cascades sibling members via getGroupMemberIds when applyToPair=true', async () => {
    // This tests that a pool seat (status='pool') WITH a sunbedGroupId correctly
    // triggers the SunbedGroup cascade path in getGroupMemberIds, meaning the
    // sibling regular seat (status='active') gets co-reserved when the pool seat
    // is the reservation anchor.
    authenticateAsOwner()

    const POOL_SEAT_ID = 'pool-seat-1'
    const SIBLING_ID = 'sibling-active-1'
    const GROUP_ID = 'group-1'

    // getGroupMemberIds: pool seat has a sunbedGroupId
    vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
      id: POOL_SEAT_ID,
      pairId: null,
      sunbedGroupId: GROUP_ID,
      pairedBy: null,
    } as any)

    // getGroupMemberIds: findMany for other members of the group (the regular sibling)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { id: SIBLING_ID },
    ] as any)

    const res = await reserveItem(SITE_ID, POOL_SEAT_ID, 'Guest', undefined, undefined, undefined, true)
    expect(res.status).toBe('ok')

    // getGroupMemberIds must have used the sunbedGroupId path (findMany was called)
    expect(vi.mocked(prisma.inventoryItem.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sunbedGroupId: GROUP_ID }),
      })
    )

    // Both the pool seat AND the sibling must reach the guard
    const guardCall = mockGuard.mock.calls[0][0]
    expect(guardCall.itemIds).toContain(POOL_SEAT_ID)
    expect(guardCall.itemIds).toContain(SIBLING_ID)
    // prisma.reservation.create must NOT be called directly
    expect(vi.mocked(prisma.reservation.create)).not.toHaveBeenCalled()
  })
})

// ─── removeFailedReservation ─────────────────────────────────────────────────

describe('removeFailedReservation', () => {
  it('deletes a reservation with canonical payment_failed status and returns ok', async () => {
    // Bug case: Mollie payment fails → user app stamps 'payment_failed'; seat is
    // orphaned until staff manually removes it.
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'payment_failed',
    } as any)
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await removeFailedReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.reservation.deleteMany)).toHaveBeenCalledWith({
      where: { id: RES_ID, siteId: SITE_ID },
    })
  })

  it('deletes a legacy "error" reservation and returns ok', async () => {
    // Legacy rows written before the canonical constant was introduced.
    // The guard must accept 'error' in addition to 'payment_failed'.
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'error',
    } as any)
    vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await removeFailedReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('ok')

    expect(vi.mocked(prisma.reservation.deleteMany)).toHaveBeenCalledWith({
      where: { id: RES_ID, siteId: SITE_ID },
    })
  })

  it('rejects when the reservation status is complete (paid booking — must never be deleted)', async () => {
    // Safety guard: a paid booking with status='complete' must NOT be removable
    // via this action regardless of what the client sends.
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'complete',
    } as any)

    const res = await removeFailedReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/not in a failed-payment state/i)
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('rejects when the reservation status is held (staff hold — not a failed payment)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      status: 'held',
    } as any)

    const res = await removeFailedReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toMatch(/not in a failed-payment state/i)
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('returns error when reservation is not found', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(null)

    const res = await removeFailedReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Reservation not found')
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('returns error when reservation belongs to a different site', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      siteId: 'other-site',
      status: 'payment_failed',
    } as any)

    const res = await removeFailedReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Reservation not found')
    expect(vi.mocked(prisma.reservation.deleteMany)).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated caller', async () => {
    const res = await removeFailedReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(vi.mocked(prisma.reservation.findUnique)).not.toHaveBeenCalled()
  })

  it('rejects non-owner', async () => {
    authenticateAsNonOwner()
    const res = await removeFailedReservation(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(vi.mocked(prisma.reservation.findUnique)).not.toHaveBeenCalled()
  })
})

// ─── collectReservationPayment / getCollectStatus / cancelCollection ─────────

const COLLECT_FROM = new Date('2026-06-18T00:00:00.000Z')
const COLLECT_TO = new Date('2026-06-18T23:59:59.000Z') // ~1 day → round() = 1
const mockCreatePayment = vi.mocked(createReservationMolliePayment)
const mockReverify = vi.mocked(reverifyAndFinalizeReservation)

function walkInForCollect(overrides: Record<string, any> = {}) {
  return {
    siteId: SITE_ID,
    status: 'paid-in-cash',
    operationalStatus: 'walked-in',
    from: COLLECT_FROM,
    to: COLLECT_TO,
    items: [{ price: 10 }, { price: 10 }],
    site: { type: 'paid', price: 8 },
    ...overrides,
  }
}

describe('collectReservationPayment', () => {
  it('rejects a bed that is not a walk-in', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(
      walkInForCollect({ status: 'complete', operationalStatus: 'checked-in' }) as any,
    )
    const res = await collectReservationPayment(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('walk-in')
    expect(mockCreatePayment).not.toHaveBeenCalled()
  })

  it('rejects a free (non-paid) site', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(
      walkInForCollect({ site: { type: 'free', price: null } }) as any,
    )
    const res = await collectReservationPayment(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(mockCreatePayment).not.toHaveBeenCalled()
  })

  it('computes the amount from DB prices, persists it, and creates the payment', async () => {
    process.env.CONSUMER_APP_URL = 'https://app.test'
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(walkInForCollect() as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await collectReservationPayment(SITE_ID, RES_ID)
    expect(res.status).toBe('ok')
    expect((res as any).amount).toBe(20) // (10 + 10) * 1 day
    expect((res as any).checkoutUrl).toBeTruthy()

    // Amount persisted before the provider call (never client-supplied).
    expect(vi.mocked(prisma.reservation.update).mock.calls[0][0].data.paymentAmount).toBe(20)
    // Provider called with the collect metadata + consumer-app URLs.
    const arg = mockCreatePayment.mock.calls[0]
    expect(arg[0]).toBe(RES_ID)
    expect(arg[1].metadataExtra).toEqual({ collect: true })
    expect(arg[1].webhookUrl).toContain('app.test')
    // Standard post-payment redirect, carrying a minted anonId capability.
    expect(arg[1].redirectUrl).toContain('/payment/complete')
    expect(arg[1].redirectUrl).toContain('reservationId=')
    expect(arg[1].redirectUrl).toMatch(/anonId=[0-9a-f-]{36}/)
    // The freshly minted anonId is persisted on the reservation.
    expect(vi.mocked(prisma.reservation.update).mock.calls[0][0].data.anonId).toMatch(/[0-9a-f-]{36}/)
  })

  it('reverts to cash (and clears paymentRef) when the provider fails', async () => {
    process.env.CONSUMER_APP_URL = 'https://app.test'
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(walkInForCollect() as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)
    mockCreatePayment.mockResolvedValueOnce({ status: 'error', error: 'No Mollie', reason: 'no_mollie' })

    const res = await collectReservationPayment(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    const lastUpdate = vi.mocked(prisma.reservation.update).mock.calls.at(-1)![0]
    expect(lastUpdate.data.status).toBe('paid-in-cash')
    expect(lastUpdate.data.paymentRef).toBeNull()
  })

  it('errors when the consumer app URL is not configured', async () => {
    delete process.env.CONSUMER_APP_URL
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(walkInForCollect() as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await collectReservationPayment(SITE_ID, RES_ID)
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('CONSUMER_APP_URL')
    expect(mockCreatePayment).not.toHaveBeenCalled()
  })
})

describe('getCollectStatus', () => {
  it('reports complete without re-verifying', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ siteId: SITE_ID, status: 'complete', paymentRef: 'tr_x' } as any)
    const res = await getCollectStatus(SITE_ID, RES_ID)
    expect((res as any).paymentStatus).toBe('complete')
    expect(mockReverify).not.toHaveBeenCalled()
  })

  it('finalizes a processing payment that has been paid', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ siteId: SITE_ID, status: 'processing', paymentRef: 'tr_x' } as any)
    mockReverify.mockResolvedValueOnce({ settled: 'complete', providerStatus: 'paid' })
    const res = await getCollectStatus(SITE_ID, RES_ID)
    expect((res as any).paymentStatus).toBe('complete')
  })

  it('reverts a processing payment that has failed back to cash', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ siteId: SITE_ID, status: 'processing', paymentRef: 'tr_x' } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)
    mockReverify.mockResolvedValueOnce({ settled: 'failed', providerStatus: 'expired' })
    const res = await getCollectStatus(SITE_ID, RES_ID)
    expect((res as any).paymentStatus).toBe('failed')
    const u = vi.mocked(prisma.reservation.update).mock.calls.at(-1)![0]
    expect(u.data.status).toBe('paid-in-cash')
    expect(u.data.paymentRef).toBeNull()
  })

  it('reports a plain cash walk-in as cash', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ siteId: SITE_ID, status: 'paid-in-cash', paymentRef: null } as any)
    const res = await getCollectStatus(SITE_ID, RES_ID)
    expect((res as any).paymentStatus).toBe('cash')
    expect(mockReverify).not.toHaveBeenCalled()
  })
})

describe('cancelCollection', () => {
  it('reverts an unpaid in-flight collection to cash', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ siteId: SITE_ID, status: 'processing', paymentRef: 'tr_x' } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)
    mockReverify.mockResolvedValueOnce({ settled: 'pending' })
    const res = await cancelCollection(SITE_ID, RES_ID)
    expect((res as any).paymentStatus).toBe('cash')
    const u = vi.mocked(prisma.reservation.update).mock.calls.at(-1)![0]
    expect(u.data.status).toBe('paid-in-cash')
    expect(u.data.paymentRef).toBeNull()
  })

  it('finalizes instead of reverting when the payment actually went through', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ siteId: SITE_ID, status: 'processing', paymentRef: 'tr_x' } as any)
    mockReverify.mockResolvedValueOnce({ settled: 'complete', providerStatus: 'paid' })
    const res = await cancelCollection(SITE_ID, RES_ID)
    expect((res as any).paymentStatus).toBe('complete')
    expect(vi.mocked(prisma.reservation.update)).not.toHaveBeenCalled()
  })

  it('is a no-op for a reservation that is not mid-collection', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ siteId: SITE_ID, status: 'paid-in-cash', paymentRef: null } as any)
    const res = await cancelCollection(SITE_ID, RES_ID)
    expect((res as any).paymentStatus).toBe('cash')
    expect(mockReverify).not.toHaveBeenCalled()
  })
})
