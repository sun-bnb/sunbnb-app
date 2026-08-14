import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  zonedWallClockToUtc,
  zonedDayBounds,
  getZonedParts,
  civilDayOfWeek,
  parseCivilDate,
} from './tz'

const HOUR = 60 * 60 * 1000

describe('DEFAULT_TIME_ZONE', () => {
  it('is a valid IANA zone', () => {
    expect(isValidTimeZone(DEFAULT_TIME_ZONE)).toBe(true)
  })
})

describe('isValidTimeZone', () => {
  it('accepts real zones', () => {
    expect(isValidTimeZone('Europe/Madrid')).toBe(true)
    expect(isValidTimeZone('America/New_York')).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
  })
  it('rejects junk', () => {
    expect(isValidTimeZone('Not/AZone')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
    // @ts-expect-error testing runtime guard
    expect(isValidTimeZone(null)).toBe(false)
  })
})

describe('zonedWallClockToUtc — venue wall-clock → UTC instant', () => {
  it('Europe/Madrid summer is UTC+2 (CEST)', () => {
    expect(zonedWallClockToUtc(2026, 7, 1, 20, 0, 'Europe/Madrid').toISOString()).toBe(
      '2026-07-01T18:00:00.000Z',
    )
  })
  it('Europe/Madrid winter is UTC+1 (CET)', () => {
    expect(zonedWallClockToUtc(2026, 1, 1, 20, 0, 'Europe/Madrid').toISOString()).toBe(
      '2026-01-01T19:00:00.000Z',
    )
  })
  it('America/New_York summer is UTC-4 (EDT)', () => {
    expect(zonedWallClockToUtc(2026, 7, 1, 19, 0, 'America/New_York').toISOString()).toBe(
      '2026-07-01T23:00:00.000Z',
    )
  })
  it('America/New_York winter crosses UTC midnight (EST UTC-5)', () => {
    expect(zonedWallClockToUtc(2026, 1, 1, 19, 0, 'America/New_York').toISOString()).toBe(
      '2026-01-02T00:00:00.000Z',
    )
  })
  it('handles the spring-forward day with a normal afternoon time', () => {
    // Madrid clocks jump 02:00→03:00 on 2026-03-29; noon is unambiguous CEST.
    expect(zonedWallClockToUtc(2026, 3, 29, 12, 0, 'Europe/Madrid').toISOString()).toBe(
      '2026-03-29T10:00:00.000Z',
    )
  })
})

describe('zonedDayBounds — DST-safe venue civil-day window', () => {
  it('is exactly 24h on a normal Madrid summer day', () => {
    const { start, end } = zonedDayBounds(2026, 7, 1, 'Europe/Madrid')
    expect(start.toISOString()).toBe('2026-06-30T22:00:00.000Z') // Jul 1 00:00 CEST (UTC+2)
    expect(end.toISOString()).toBe('2026-07-01T22:00:00.000Z')   // Jul 2 00:00 CEST
    expect(end.getTime() - start.getTime()).toBe(24 * HOUR)
  })

  it('is 23h on the Madrid spring-forward day (clocks skip 02:00→03:00)', () => {
    // 2026-03-29: the naive `start + 24h` would overrun into Mar 30.
    const { start, end } = zonedDayBounds(2026, 3, 29, 'Europe/Madrid')
    expect(start.toISOString()).toBe('2026-03-28T23:00:00.000Z') // Mar 29 00:00 CET (UTC+1)
    expect(end.toISOString()).toBe('2026-03-29T22:00:00.000Z')   // Mar 30 00:00 CEST (UTC+2)
    expect(end.getTime() - start.getTime()).toBe(23 * HOUR)
  })

  it('is 25h on the Madrid fall-back day (clocks repeat 02:00→03:00)', () => {
    // 2026-10-25: the naive `start + 24h` would fall an hour short, dropping the
    // last local hour's reservations/slots from the day window.
    const { start, end } = zonedDayBounds(2026, 10, 25, 'Europe/Madrid')
    expect(start.toISOString()).toBe('2026-10-24T22:00:00.000Z') // Oct 25 00:00 CEST (UTC+2)
    expect(end.toISOString()).toBe('2026-10-25T23:00:00.000Z')   // Oct 26 00:00 CET (UTC+1)
    expect(end.getTime() - start.getTime()).toBe(25 * HOUR)
  })

  it('rolls over month/year boundaries (Dec 31 → Jan 1)', () => {
    const { start, end } = zonedDayBounds(2026, 12, 31, 'Europe/Madrid')
    expect(start.toISOString()).toBe('2026-12-30T23:00:00.000Z') // Dec 31 00:00 CET
    expect(end.toISOString()).toBe('2026-12-31T23:00:00.000Z')   // Jan 1 00:00 CET
  })
})

describe('getZonedParts — UTC instant → venue wall-clock', () => {
  it('reads Madrid local time + weekday', () => {
    const p = getZonedParts(new Date('2026-07-01T18:00:00Z'), 'Europe/Madrid')
    expect(p).toEqual({ year: 2026, month: 7, day: 1, hour: 20, minute: 0, weekday: 3 })
  })
  it('rolls back across UTC midnight for a western zone', () => {
    const p = getZonedParts(new Date('2026-01-02T00:00:00Z'), 'America/New_York')
    expect(p.year).toBe(2026)
    expect(p.month).toBe(1)
    expect(p.day).toBe(1)
    expect(p.hour).toBe(19)
  })
})

describe('civilDayOfWeek', () => {
  it('matches known dates (0=Sun)', () => {
    expect(civilDayOfWeek(2026, 1, 1)).toBe(4) // Thursday
    expect(civilDayOfWeek(2026, 7, 1)).toBe(3) // Wednesday
    expect(civilDayOfWeek(2026, 5, 22)).toBe(5) // Friday
  })
})

describe('parseCivilDate', () => {
  it('parses a strict ISO date', () => {
    expect(parseCivilDate('2026-05-22')).toEqual({ year: 2026, month: 5, day: 22 })
  })
  it('rejects malformed input', () => {
    expect(parseCivilDate('bad')).toBeNull()
    expect(parseCivilDate('2026-13-01')).toBeNull()
    expect(parseCivilDate('2026-00-10')).toBeNull()
    expect(parseCivilDate('2026-5-2')).toBeNull()
  })
})
