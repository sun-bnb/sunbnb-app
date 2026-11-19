import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'

import { availabilityTone, formatStay, selectedChip, singleDayRange, visibleDayCount } from './day-strip'

const days = ['2026-11-19', '2026-11-20', '2026-11-21'].map((date) => ({ date }))

describe('availabilityTone', () => {
  it('is full at zero free seats, and for a venue with no seats', () => {
    expect(availabilityTone({ available: 0, total: 40 })).toBe('full')
    expect(availabilityTone({ available: 0, total: 0 })).toBe('full')
  })

  it('flags the last 10% of a large venue as few', () => {
    expect(availabilityTone({ available: 10, total: 100 })).toBe('few')
    expect(availabilityTone({ available: 11, total: 100 })).toBe('free')
  })

  it('never calls more than 2 free seats on a small venue "few" just because of the percentage floor', () => {
    expect(availabilityTone({ available: 2, total: 8 })).toBe('few')
    expect(availabilityTone({ available: 3, total: 8 })).toBe('free')
  })
})

describe('singleDayRange', () => {
  it('round-trips to the same civil day the reservation submit sends', () => {
    const [from, to] = singleDayRange('2026-11-21')
    expect(dayjs(from).format('YYYY-MM-DD')).toBe('2026-11-21')
    expect(dayjs(to).format('YYYY-MM-DD')).toBe('2026-11-21')
  })
})

describe('selectedChip', () => {
  it('selects the strip day for a single-day range inside the strip', () => {
    expect(selectedChip(singleDayRange('2026-11-20'), days)).toBe('2026-11-20')
  })

  it('selects "other" for a multi-day stay', () => {
    const range: [string, string] = [singleDayRange('2026-11-19')[0], singleDayRange('2026-11-21')[1]]
    expect(selectedChip(range, days)).toBe('other')
  })

  it('selects "other" for a single day beyond the strip', () => {
    expect(selectedChip(singleDayRange('2026-12-24'), days)).toBe('other')
  })

  it('selects nothing before a range exists', () => {
    expect(selectedChip(null, days)).toBeNull()
    expect(selectedChip([null, null], days)).toBeNull()
  })
})

describe('visibleDayCount', () => {
  it('fits 4 tiles on a 320px phone and 5 on a 390px phone (drawer padding removed)', () => {
    expect(visibleDayCount(320 - 24, 7)).toBe(4)
    expect(visibleDayCount(390 - 24, 7)).toBe(5)
  })

  it('never shows more days than were fetched, nor more than a week', () => {
    expect(visibleDayCount(2000, 7)).toBe(7)
    expect(visibleDayCount(2000, 5)).toBe(5)
  })

  it('keeps at least 3 days even on a very narrow container', () => {
    expect(visibleDayCount(100, 7)).toBe(3)
  })
})

describe('formatStay', () => {
  it('shows one day for a same-day range and a range otherwise', () => {
    const [from, to] = singleDayRange('2026-11-19')
    expect(formatStay('en-GB', from, to)).toBe('Thu 19 Nov')
    expect(formatStay('en-GB', from, singleDayRange('2026-11-21')[1])).toMatch(/19.*21 Nov/)
  })
})
