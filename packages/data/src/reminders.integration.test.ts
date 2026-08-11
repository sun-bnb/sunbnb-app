/**
 * Integration tests for venue-anchored reminder windows (track 017 P2).
 *
 * Regression guard for the "reminder emails miss the window" bug: sendDueReminders
 * and sendRentalDueReminders used a server-local (`setHours(0,0,0,0)`, UTC on
 * Vercel) day window, while consumer bookings are written from the browser's /
 * venue's start-of-day. A booking stored at the venue's midnight (an instant on
 * the *previous* UTC day for a venue east of UTC) fell outside the UTC window and
 * was never reminded — and `reminderSentAt` was stamped regardless, so the miss
 * was unrecoverable.
 *
 * The window is now a ±36h candidate pool filtered per-row against each site's
 * own civil day. These tests pin a site to a large-offset timezone (Asia/Tokyo,
 * UTC+9, no DST) so "the venue's today" is unambiguous regardless of the CI
 * machine's timezone: only a booking starting on the venue's civil today should
 * be reminded — venue-yesterday and venue-tomorrow bookings (both inside the
 * fetch window) must be filtered out.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('./email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: 'mock-email' }),
}))

import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  createTestSite,
  createTestInventoryItem,
  createTestReservation,
  createTestRentalItem,
  createTestRentalBooking,
  resetCounter,
} from './test/fixtures'
import { siteDayBounds } from './site-day'
import { sendDueReminders } from './reservation-emails'
import { sendRentalDueReminders } from './rental-emails'

const TZ = 'Asia/Tokyo' // UTC+9, no DST — venue day is unambiguous

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
})

afterAll(async () => {
  await disconnectDatabase()
})

// Venue-civil-day boundaries for "today" at the venue.
function venueToday() {
  const now = new Date()
  const { start } = siteDayBounds({ timeZone: TZ }, now)
  return {
    start,                                                // venue today 00:00
    yesterdayLastHour: new Date(start.getTime() - 60 * 60 * 1000),   // venue yesterday 23:00
    tomorrowFirstHour: new Date(start.getTime() + 25 * 60 * 60 * 1000), // venue tomorrow ~01:00
  }
}

describe('sendDueReminders — venue civil-day anchoring (track 017 P2)', () => {
  it('reminds only the booking that starts on the venue civil today', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id, { timeZone: TZ })
    const item = await createTestInventoryItem(user.id, site.id)
    const { start, yesterdayLastHour, tomorrowFirstHour } = venueToday()

    const dueToday = await createTestReservation(user.id, site.id, [item.id], {
      from: start,
      to: new Date(start.getTime() + 8 * 60 * 60 * 1000),
      status: 'complete',
      operationalStatus: 'expected',
      reminderSentAt: null,
    })
    const startedYesterday = await createTestReservation(user.id, site.id, [item.id], {
      from: yesterdayLastHour,
      to: new Date(yesterdayLastHour.getTime() + 8 * 60 * 60 * 1000),
      status: 'complete',
      operationalStatus: 'expected',
      reminderSentAt: null,
    })
    const startsTomorrow = await createTestReservation(user.id, site.id, [item.id], {
      from: tomorrowFirstHour,
      to: new Date(tomorrowFirstHour.getTime() + 8 * 60 * 60 * 1000),
      status: 'complete',
      operationalStatus: 'expected',
      reminderSentAt: null,
    })

    const sent = await sendDueReminders()

    expect(sent).toBe(1)
    const after = await prisma.reservation.findMany({
      where: { id: { in: [dueToday.id, startedYesterday.id, startsTomorrow.id] } },
      select: { id: true, reminderSentAt: true },
    })
    const byId = Object.fromEntries(after.map((r) => [r.id, r.reminderSentAt]))
    expect(byId[dueToday.id]).toBeInstanceOf(Date)
    expect(byId[startedYesterday.id]).toBeNull()
    expect(byId[startsTomorrow.id]).toBeNull()
  })
})

describe('sendRentalDueReminders — venue civil-day anchoring (track 017 P2)', () => {
  it('reminds only the rental that starts on the venue civil today', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id, { timeZone: TZ })
    const rentalItem = await createTestRentalItem(site.id)
    const { start, yesterdayLastHour, tomorrowFirstHour } = venueToday()

    const dueToday = await createTestRentalBooking(user.id, site.id, rentalItem.id, {
      from: start,
      to: new Date(start.getTime() + 2 * 60 * 60 * 1000),
      status: 'complete',
      operationalStatus: 'reserved',
      reminderSentAt: null,
    })
    const startedYesterday = await createTestRentalBooking(user.id, site.id, rentalItem.id, {
      from: yesterdayLastHour,
      to: new Date(yesterdayLastHour.getTime() + 2 * 60 * 60 * 1000),
      status: 'complete',
      operationalStatus: 'reserved',
      reminderSentAt: null,
    })
    const startsTomorrow = await createTestRentalBooking(user.id, site.id, rentalItem.id, {
      from: tomorrowFirstHour,
      to: new Date(tomorrowFirstHour.getTime() + 2 * 60 * 60 * 1000),
      status: 'complete',
      operationalStatus: 'reserved',
      reminderSentAt: null,
    })

    const sent = await sendRentalDueReminders()

    expect(sent).toBe(1)
    const after = await prisma.rentalBooking.findMany({
      where: { id: { in: [dueToday.id, startedYesterday.id, startsTomorrow.id] } },
      select: { id: true, reminderSentAt: true },
    })
    const byId = Object.fromEntries(after.map((b) => [b.id, b.reminderSentAt]))
    expect(byId[dueToday.id]).toBeInstanceOf(Date)
    expect(byId[startedYesterday.id]).toBeNull()
    expect(byId[startsTomorrow.id]).toBeNull()
  })
})
