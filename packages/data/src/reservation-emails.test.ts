import { afterEach, describe, expect, it, vi } from 'vitest'

// Templates are pure; the module's loaders are not exercised here.
vi.mock('../index', () => ({ default: {} }))

import { confirmationHtml, reservationViewUrl, type ReservationEmailData } from './reservation-emails'

const base: ReservationEmailData = {
  reservationId: 'res_1',
  userEmail: 'guest@example.com',
  siteName: 'Alonso Beach',
  siteId: 'site_1',
  sunbedNumbers: [10305, 10306],
  fromDate: new Date('2026-10-08T00:00:00Z'),
  toDate: new Date('2026-10-08T23:59:59Z'),
  amount: 0,
  amountDue: null,
  guestName: null,
  viewUrl: 'https://sunbnb.app/reservations/res_1?anonId=a1',
}

describe('reservationViewUrl', () => {
  const prev = process.env.CONSUMER_APP_URL
  afterEach(() => {
    process.env.CONSUMER_APP_URL = prev
  })

  it('links a guest booking with its anonId, so the email opens the same view', () => {
    process.env.CONSUMER_APP_URL = 'https://test.sunbnb.app/'
    expect(reservationViewUrl('res_1', 'a-1')).toBe('https://test.sunbnb.app/reservations/res_1?anonId=a-1')
  })

  it('links an account booking without an anonId', () => {
    process.env.CONSUMER_APP_URL = 'https://test.sunbnb.app'
    expect(reservationViewUrl('res_1', null)).toBe('https://test.sunbnb.app/reservations/res_1')
  })

  it('falls back to production when the origin is not configured', () => {
    delete process.env.CONSUMER_APP_URL
    expect(reservationViewUrl('res_1', null)).toBe('https://sunbnb.app/reservations/res_1')
  })
})

describe('confirmationHtml', () => {
  it('links to the reservation view', () => {
    expect(confirmationHtml(base)).toContain('href="https://sunbnb.app/reservations/res_1?anonId=a1"')
  })

  it('states the venue price, and that nothing was charged, for an unpaid-site booking', () => {
    const html = confirmationHtml({ ...base, amountDue: 30 })
    expect(html).toContain('€30.00 — pay at the venue')
    expect(html).toContain('Nothing has been charged')
    expect(html).not.toContain('>Free<')
  })

  it('shows the paid amount for an online payment, with no venue note', () => {
    const html = confirmationHtml({ ...base, amount: 30 })
    expect(html).toContain('€30.00')
    expect(html).not.toContain('pay at the venue')
  })
})
