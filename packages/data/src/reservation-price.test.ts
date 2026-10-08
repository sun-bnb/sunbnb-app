import { describe, expect, it } from 'vitest'
import { reservationDays, reservationListPrice } from './reservation-price'

const day = (d: number, h = 0, m = 0, s = 0, ms = 0) => new Date(Date.UTC(2026, 9, d, h, m, s, ms))

describe('reservationDays', () => {
  it('counts a start-of-day to end-of-day booking as one day', () => {
    expect(reservationDays(day(8), day(8, 23, 59, 59, 999))).toBe(1)
  })

  it('counts a three-day booking as three', () => {
    expect(reservationDays(day(8), day(10, 23, 59, 59, 999))).toBe(3)
  })
})

describe('reservationListPrice', () => {
  const oneDay = { from: day(8), to: day(8, 23, 59, 59, 999) }

  it('falls back to the site price for seats without their own', () => {
    expect(reservationListPrice({ sitePrice: 15, itemPrices: [null, null], ...oneDay })).toBe(30)
  })

  it('uses a seat’s own price over the site price', () => {
    expect(reservationListPrice({ sitePrice: 15, itemPrices: [25, null], ...oneDay })).toBe(40)
  })

  it('multiplies by the number of days', () => {
    expect(reservationListPrice({ sitePrice: 12.5, itemPrices: [null, null], from: day(8), to: day(10, 23, 59, 59, 999) })).toBe(75)
  })

  it('is 0 when nothing is priced', () => {
    expect(reservationListPrice({ sitePrice: null, itemPrices: [null], ...oneDay })).toBe(0)
  })

  it('rounds to cents', () => {
    expect(reservationListPrice({ sitePrice: 0.1, itemPrices: [null, null, null], ...oneDay })).toBe(0.3)
  })
})
