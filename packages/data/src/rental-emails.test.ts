/**
 * Unit tests for rental-emails.ts
 *
 * Requirements tested:
 *   - Recipient selection: anonId ? guestEmail : user.email (mirrors reservation-emails.ts)
 *   - Anonymous with no guestEmail → skip (no email sent)
 *   - Auth user email used when no anonId
 *   - Confirmation, reminder, and cancellation functions call sendEmail once when data is present
 *   - Functions are non-throwing (errors logged, not re-thrown)
 *   - sendRentalDueReminders: findMany where includes reminderSentAt: null (dedup filter)
 *   - sendRentalDueReminders: after successful send, rentalBooking.update called with reminderSentAt
 *   - sendRentalDueReminders: if sendEmail throws, update NOT called (retry will re-send)
 *
 * No DB: prisma is mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock prisma before importing the module under test
vi.mock('../index', () => ({
  default: {
    rentalBooking: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}))

// Mock sendEmail
vi.mock('./email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: 'mock-email' }),
}))

import {
  sendRentalConfirmationEmail,
  sendRentalCancellationEmail,
  sendRentalDueReminders,
} from './rental-emails'
import { sendEmail } from './email'
import prisma from '../index'

// Typed references after imports (after vi.mock hoisting)
const mockSendEmail = vi.mocked(sendEmail)
const mockPrisma = vi.mocked(prisma)

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeBooking(overrides: Record<string, any> = {}) {
  return {
    id: 'booking-1',
    paymentRef: 'pi_demo_123',
    siteId: 'site-1',
    rentalItemId: 'item-1',
    userId: 'user-1',
    // Relative to now: sendRentalDueReminders filters to bookings whose `from`
    // is today in the venue's civil day, so a fixed past date would be dropped.
    from: new Date(),
    to: new Date(Date.now() + 2 * 60 * 60 * 1000),
    quantity: 1,
    durationType: 'hours',
    totalPrice: 20.0,
    paymentAmount: 20.0,
    status: 'complete',
    operationalStatus: 'reserved',
    guestName: null,
    anonId: null,
    guestEmail: null,
    guestContact: null,
    user: { email: 'customer@example.com', name: 'Test Customer' },
    site: { name: 'Test Beach', id: 'site-1' },
    rentalItem: { name: 'Surfboard' },
    ...overrides,
  }
}

// ─── sendRentalConfirmationEmail ────────────────────────────────────────────

describe('sendRentalConfirmationEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends to user.email for an authenticated booking (no anonId)', async () => {
    mockPrisma.rentalBooking.findUnique.mockResolvedValue(makeBooking())

    await sendRentalConfirmationEmail('booking-1')

    expect(mockSendEmail).toHaveBeenCalledOnce()
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'customer@example.com' })
    )
  })

  it('sends to guestEmail for an anonymous booking with guestEmail', async () => {
    mockPrisma.rentalBooking.findUnique.mockResolvedValue(
      makeBooking({
        anonId: 'anon-uuid-1234',
        guestEmail: 'guest@example.com',
        user: { email: 'owner@partner.com', name: 'Site Owner' }, // FK placeholder
      })
    )

    await sendRentalConfirmationEmail('booking-1')

    expect(mockSendEmail).toHaveBeenCalledOnce()
    const call = mockSendEmail.mock.calls[0]![0]
    // Must use guestEmail, not the site owner's email (FK placeholder)
    expect(call.to).toBe('guest@example.com')
    expect(call.to).not.toBe('owner@partner.com')
  })

  it('skips sending when anonymous booking has no guestEmail (QR/POS anon)', async () => {
    mockPrisma.rentalBooking.findUnique.mockResolvedValue(
      makeBooking({
        anonId: 'anon-uuid-1234',
        guestEmail: null, // no email captured at POS
        user: { email: 'owner@partner.com', name: 'Site Owner' },
      })
    )

    await sendRentalConfirmationEmail('booking-1')

    // No email must be sent — anon with no guestEmail = silent skip
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('skips sending when booking is not found', async () => {
    mockPrisma.rentalBooking.findUnique.mockResolvedValue(null)

    await sendRentalConfirmationEmail('nonexistent')

    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('does not throw when sendEmail rejects (non-blocking)', async () => {
    mockPrisma.rentalBooking.findUnique.mockResolvedValue(makeBooking())
    mockSendEmail.mockRejectedValueOnce(new Error('SMTP error'))

    // Must not throw — failure is logged, not re-thrown
    await expect(sendRentalConfirmationEmail('booking-1')).resolves.toBeUndefined()
  })

  it('does not throw when prisma rejects (non-blocking)', async () => {
    mockPrisma.rentalBooking.findUnique.mockRejectedValueOnce(new Error('DB error'))

    await expect(sendRentalConfirmationEmail('booking-1')).resolves.toBeUndefined()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('includes site name and item name in the subject / body', async () => {
    mockPrisma.rentalBooking.findUnique.mockResolvedValue(makeBooking())

    await sendRentalConfirmationEmail('booking-1')

    const call = mockSendEmail.mock.calls[0]![0]
    expect(call.subject).toContain('Test Beach')
    expect(call.html).toContain('Surfboard')
  })
})

// ─── sendRentalCancellationEmail ────────────────────────────────────────────

describe('sendRentalCancellationEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends to user.email for an authenticated booking', async () => {
    mockPrisma.rentalBooking.findUnique.mockResolvedValue(makeBooking())

    await sendRentalCancellationEmail('booking-1')

    expect(mockSendEmail).toHaveBeenCalledOnce()
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'customer@example.com' })
    )
  })

  it('sends to guestEmail for an anonymous booking', async () => {
    mockPrisma.rentalBooking.findUnique.mockResolvedValue(
      makeBooking({
        anonId: 'anon-uuid-1234',
        guestEmail: 'guest@example.com',
        user: { email: 'owner@partner.com', name: 'Site Owner' },
      })
    )

    await sendRentalCancellationEmail('booking-1')

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'guest@example.com' })
    )
  })

  it('skips sending when anonymous booking has no guestEmail', async () => {
    mockPrisma.rentalBooking.findUnique.mockResolvedValue(
      makeBooking({ anonId: 'anon-uuid-1234', guestEmail: null })
    )

    await sendRentalCancellationEmail('booking-1')

    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('does not throw when sendEmail rejects', async () => {
    mockPrisma.rentalBooking.findUnique.mockResolvedValue(makeBooking())
    mockSendEmail.mockRejectedValueOnce(new Error('SMTP error'))

    await expect(sendRentalCancellationEmail('booking-1')).resolves.toBeUndefined()
  })
})

// ─── sendRentalDueReminders ─────────────────────────────────────────────────

describe('sendRentalDueReminders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends reminders to all due bookings', async () => {
    const booking1 = makeBooking({ id: 'b1', user: { email: 'a@example.com', name: 'A' } })
    const booking2 = makeBooking({ id: 'b2', user: { email: 'b@example.com', name: 'B' } })
    mockPrisma.rentalBooking.findMany.mockResolvedValue([booking1, booking2])

    const count = await sendRentalDueReminders()

    expect(count).toBe(2)
    expect(mockSendEmail).toHaveBeenCalledTimes(2)
  })

  it('uses guestEmail for anonymous bookings in due reminders', async () => {
    const anonBooking = makeBooking({
      id: 'b-anon',
      anonId: 'anon-uuid',
      guestEmail: 'anon@example.com',
      user: { email: 'owner@partner.com', name: 'Site Owner' },
    })
    mockPrisma.rentalBooking.findMany.mockResolvedValue([anonBooking])

    const count = await sendRentalDueReminders()

    expect(count).toBe(1)
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'anon@example.com' })
    )
  })

  it('skips anonymous bookings without guestEmail in due reminders', async () => {
    const anonNoEmail = makeBooking({
      id: 'b-anon-noemail',
      anonId: 'anon-uuid',
      guestEmail: null,
      user: { email: 'owner@partner.com', name: 'Site Owner' },
    })
    mockPrisma.rentalBooking.findMany.mockResolvedValue([anonNoEmail])

    const count = await sendRentalDueReminders()

    expect(count).toBe(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('returns 0 when no due bookings', async () => {
    mockPrisma.rentalBooking.findMany.mockResolvedValue([])

    const count = await sendRentalDueReminders()

    expect(count).toBe(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('continues past a failing email send and counts only successes', async () => {
    const booking1 = makeBooking({ id: 'b1', user: { email: 'a@example.com', name: 'A' } })
    const booking2 = makeBooking({ id: 'b2', user: { email: 'b@example.com', name: 'B' } })
    mockPrisma.rentalBooking.findMany.mockResolvedValue([booking1, booking2])

    // First call fails, second succeeds
    mockSendEmail
      .mockRejectedValueOnce(new Error('SMTP error'))
      .mockResolvedValueOnce({ id: 'mock-email' })

    const count = await sendRentalDueReminders()

    expect(count).toBe(1)
    expect(mockSendEmail).toHaveBeenCalledTimes(2)
  })

  it('passes reminderSentAt: null in the findMany where clause (dedup filter)', async () => {
    mockPrisma.rentalBooking.findMany.mockResolvedValue([])

    await sendRentalDueReminders()

    expect(mockPrisma.rentalBooking.findMany).toHaveBeenCalledOnce()
    const callArg = mockPrisma.rentalBooking.findMany.mock.calls[0]![0]
    expect(callArg.where).toMatchObject({ reminderSentAt: null })
  })

  it('calls rentalBooking.update with reminderSentAt after a successful send', async () => {
    const booking = makeBooking({ id: 'b-mark', user: { email: 'user@example.com', name: 'U' } })
    mockPrisma.rentalBooking.findMany.mockResolvedValue([booking])
    mockPrisma.rentalBooking.update.mockResolvedValue(booking as any)

    await sendRentalDueReminders()

    expect(mockPrisma.rentalBooking.update).toHaveBeenCalledOnce()
    const updateCall = mockPrisma.rentalBooking.update.mock.calls[0]![0]
    expect(updateCall.where).toEqual({ id: 'b-mark' })
    expect(updateCall.data.reminderSentAt).toBeInstanceOf(Date)
  })

  it('does NOT call rentalBooking.update when sendEmail throws (retry must re-send)', async () => {
    const booking = makeBooking({ id: 'b-fail', user: { email: 'user@example.com', name: 'U' } })
    mockPrisma.rentalBooking.findMany.mockResolvedValue([booking])
    mockSendEmail.mockRejectedValueOnce(new Error('SMTP failure'))

    const count = await sendRentalDueReminders()

    // Failed send → not marked as reminded → retry cron will attempt again
    expect(count).toBe(0)
    expect(mockPrisma.rentalBooking.update).not.toHaveBeenCalled()
  })
})
