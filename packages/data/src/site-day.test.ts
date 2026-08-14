/**
 * Unit tests for src/site-day.ts
 *
 * All pure — no DB, no Prisma. Tests cover:
 *   - resolveSiteTimeZone: stored tz, coord-derived tz, null/invalid fallback
 *   - siteDayKey: correct civil date in non-UTC tz, DST boundary
 *   - siteDayBounds: UTC start/end instants for a civil day in tz
 *   - DST boundary: spring-forward (Madrid, last Sunday March)
 */

import { describe, it, expect } from 'vitest'
import { resolveSiteTimeZone, siteDayKey, siteDayBounds, siteDateBounds, siteAnchoredDay, siteMonthBounds, deriveTimeZoneFromCoords, isValidTimeZone, DEFAULT_TZ } from './site-day'

// ─── resolveSiteTimeZone ─────────────────────────────────────────────────────

describe('resolveSiteTimeZone', () => {
  it('returns stored timeZone if set', () => {
    expect(resolveSiteTimeZone({ timeZone: 'America/New_York' })).toBe('America/New_York')
  })

  it('trims whitespace from stored timeZone', () => {
    expect(resolveSiteTimeZone({ timeZone: '  Europe/Helsinki  ' })).toBe('Europe/Helsinki')
  })

  it('derives timezone from coords (Madrid beach club — should be Europe/Madrid)', () => {
    // Marbella, Spain: ~36.51°N, -4.88°E
    const tz = resolveSiteTimeZone({ latitude: 36.51, longitude: -4.88 })
    expect(tz).toBe('Europe/Madrid')
  })

  it('derives timezone from coords (Tenerife — Atlantic/Canary or Europe/Madrid boundary)', () => {
    // Santa Cruz de Tenerife: 28.47°N, -16.25°E — should be Atlantic/Canary
    const tz = resolveSiteTimeZone({ latitude: 28.47, longitude: -16.25 })
    // tz-lookup assigns this as Atlantic/Canary
    expect(tz).toBe('Atlantic/Canary')
  })

  it('falls back to Europe/Madrid when no tz and no coords', () => {
    expect(resolveSiteTimeZone({})).toBe('Europe/Madrid')
  })

  it('falls back to Europe/Madrid when timeZone is null', () => {
    expect(resolveSiteTimeZone({ timeZone: null })).toBe('Europe/Madrid')
  })

  it('falls back to Europe/Madrid when timeZone is empty string', () => {
    expect(resolveSiteTimeZone({ timeZone: '' })).toBe('Europe/Madrid')
  })

  it('falls back to Europe/Madrid when coords are null', () => {
    expect(resolveSiteTimeZone({ latitude: null, longitude: null })).toBe('Europe/Madrid')
  })

  it('prefers stored timeZone over coords', () => {
    // Even if coords say Atlantic/Canary, the stored tz wins
    const tz = resolveSiteTimeZone({
      timeZone: 'Europe/Helsinki',
      latitude: 28.47,
      longitude: -16.25,
    })
    expect(tz).toBe('Europe/Helsinki')
  })
})

// ─── isValidTimeZone / DEFAULT_TZ ────────────────────────────────────────────

describe('isValidTimeZone', () => {
  it('accepts real IANA zones', () => {
    expect(isValidTimeZone('Europe/Madrid')).toBe(true)
    expect(isValidTimeZone('Atlantic/Canary')).toBe(true)
    expect(isValidTimeZone('America/New_York')).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
  })

  it('rejects junk / empty / non-strings', () => {
    expect(isValidTimeZone('Not/AZone')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
    expect(isValidTimeZone(undefined as unknown as string)).toBe(false)
    expect(isValidTimeZone(null as unknown as string)).toBe(false)
  })
})

describe('DEFAULT_TZ', () => {
  it('is Europe/Madrid and a valid zone', () => {
    expect(DEFAULT_TZ).toBe('Europe/Madrid')
    expect(isValidTimeZone(DEFAULT_TZ)).toBe(true)
  })
})

// ─── deriveTimeZoneFromCoords ────────────────────────────────────────────────

describe('deriveTimeZoneFromCoords', () => {
  it('derives Europe/Madrid for Marbella coords', () => {
    expect(deriveTimeZoneFromCoords(36.51, -4.88)).toBe('Europe/Madrid')
  })

  it('derives Atlantic/Canary for Tenerife coords (the Canary residual case)', () => {
    expect(deriveTimeZoneFromCoords(28.47, -16.25)).toBe('Atlantic/Canary')
  })

  it('derives Europe/Helsinki for Helsinki coords', () => {
    expect(deriveTimeZoneFromCoords(60.17, 24.94)).toBe('Europe/Helsinki')
  })

  it('returns null when coordinates are missing', () => {
    expect(deriveTimeZoneFromCoords(null, null)).toBeNull()
    expect(deriveTimeZoneFromCoords(undefined, undefined)).toBeNull()
    expect(deriveTimeZoneFromCoords(36.51, null)).toBeNull()
  })

  it('returns null for non-finite coordinates', () => {
    expect(deriveTimeZoneFromCoords(NaN, 0)).toBeNull()
    expect(deriveTimeZoneFromCoords(Infinity, 0)).toBeNull()
  })
})

// ─── siteDayKey ──────────────────────────────────────────────────────────────

describe('siteDayKey', () => {
  it('returns YYYY-MM-DD in UTC for a UTC+0 tz', () => {
    // 2024-07-14T12:00:00Z should be "2024-07-14" in UTC (Europe/London in summer = BST = UTC+1)
    // Use a zone we know is UTC+0 in winter
    const site = { timeZone: 'UTC' }
    const d = new Date('2024-01-15T10:30:00Z')
    expect(siteDayKey(site, d)).toBe('2024-01-15')
  })

  it('rolls over to next day for a UTC+2 site when UTC time is 23:30', () => {
    // Europe/Madrid in summer (July) is UTC+2.
    // 2024-07-14T23:30:00Z = 2024-07-15T01:30 local → should return "2024-07-15"
    const site = { timeZone: 'Europe/Madrid' }
    const d = new Date('2024-07-14T23:30:00Z')
    expect(siteDayKey(site, d)).toBe('2024-07-15')
  })

  it('stays on same day for a UTC+2 site when UTC time is 22:59', () => {
    // 2024-07-14T22:59:00Z = 2024-07-15T00:59 local → "2024-07-15"
    // ... wait, 22:59 UTC + 2 = 00:59 local → still 15th
    // Let's use 21:30Z which is 23:30 local → "2024-07-14"
    const site = { timeZone: 'Europe/Madrid' }
    const d = new Date('2024-07-14T21:30:00Z')
    expect(siteDayKey(site, d)).toBe('2024-07-14')
  })

  it('uses current date when now is omitted', () => {
    const site = { timeZone: 'UTC' }
    const result = siteDayKey(site)
    // Should be a valid YYYY-MM-DD
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('handles UTC-5 (New York winter) correctly', () => {
    // 2024-01-15T04:00:00Z = 2024-01-14T23:00 EST → "2024-01-14"
    const site = { timeZone: 'America/New_York' }
    const d = new Date('2024-01-15T04:00:00Z')
    expect(siteDayKey(site, d)).toBe('2024-01-14')
  })
})

// ─── siteDayBounds ───────────────────────────────────────────────────────────

describe('siteDayBounds', () => {
  it('returns UTC midnight..23:59:59.999 for a UTC site', () => {
    const site = { timeZone: 'UTC' }
    const d = new Date('2024-03-15T10:00:00Z')
    const { start, end } = siteDayBounds(site, d)

    expect(start.toISOString()).toBe('2024-03-15T00:00:00.000Z')
    expect(end.toISOString()).toBe('2024-03-15T23:59:59.999Z')
  })

  it('returns correct bounds for Europe/Madrid in summer (UTC+2)', () => {
    // Summer: Madrid midnight = 22:00 UTC previous day
    // Day: 2024-07-14 (local). start = 2024-07-13T22:00:00Z, end = 2024-07-14T21:59:59.999Z
    const site = { timeZone: 'Europe/Madrid' }
    const d = new Date('2024-07-14T10:00:00Z')  // 12:00 local — clearly within the day
    const { start, end } = siteDayBounds(site, d)

    expect(start.toISOString()).toBe('2024-07-13T22:00:00.000Z')
    expect(end.toISOString()).toBe('2024-07-14T21:59:59.999Z')
  })

  it('returns correct bounds for Europe/Madrid in winter (UTC+1)', () => {
    // Winter: Madrid midnight = 23:00 UTC previous day
    // Day: 2024-01-15 (local). start = 2024-01-14T23:00:00Z, end = 2024-01-15T22:59:59.999Z
    const site = { timeZone: 'Europe/Madrid' }
    const d = new Date('2024-01-15T10:00:00Z')  // 11:00 local
    const { start, end } = siteDayBounds(site, d)

    expect(start.toISOString()).toBe('2024-01-14T23:00:00.000Z')
    expect(end.toISOString()).toBe('2024-01-15T22:59:59.999Z')
  })

  it('handles the DST spring-forward transition in Europe/Madrid (last Sunday March 2024)', () => {
    // In 2024, Madrid clocks spring forward on 2024-03-31 at 02:00 local → 03:00.
    // On 2024-03-31: midnight local = 2024-03-30T23:00:00Z (UTC+1 before the clock change).
    // End of day: 2024-03-31T21:59:59.999Z (UTC+2 after the clock change).
    // The day is only 23 hours long — that's correct DST behaviour.
    const site = { timeZone: 'Europe/Madrid' }
    const d = new Date('2024-03-31T12:00:00Z')  // 14:00 local (already on summer time)
    const { start, end } = siteDayBounds(site, d)

    // start: 2024-03-30T23:00:00Z (local midnight = UTC+1 before spring-forward)
    expect(start.toISOString()).toBe('2024-03-30T23:00:00.000Z')
    // end: 23h later + 999ms (day is 23 hours due to spring-forward)
    // Local 23:59:59.999 on 2024-03-31 = UTC 21:59:59.999 (now UTC+2)
    expect(end.toISOString()).toBe('2024-03-31T21:59:59.999Z')
  })

  it('uses current time when now is omitted', () => {
    const site = { timeZone: 'UTC' }
    const { start, end } = siteDayBounds(site)
    expect(start).toBeInstanceOf(Date)
    expect(end).toBeInstanceOf(Date)
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000 - 1)
  })

  it('start and end are exactly 24h - 1ms apart for a non-DST day', () => {
    const site = { timeZone: 'Europe/Madrid' }
    const d = new Date('2024-07-14T10:00:00Z')
    const { start, end } = siteDayBounds(site, d)
    // Non-DST day in July: exactly 24h
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000 - 1)
  })

  it('derives bounds from coords when no timeZone stored', () => {
    // Marbella coords → Europe/Madrid
    const site = { latitude: 36.51, longitude: -4.88 }
    const d = new Date('2024-07-14T10:00:00Z')
    const { start } = siteDayBounds(site, d)
    // Same as Europe/Madrid summer: start = 2024-07-13T22:00:00Z
    expect(start.toISOString()).toBe('2024-07-13T22:00:00.000Z')
  })
})

// ─── siteDateBounds ──────────────────────────────────────────────────────────

describe('siteDateBounds', () => {
  it('returns UTC midnight..23:59:59.999 for a UTC site', () => {
    const { start, end } = siteDateBounds({ timeZone: 'UTC' }, '2025-08-31')
    expect(start.toISOString()).toBe('2025-08-31T00:00:00.000Z')
    expect(end.toISOString()).toBe('2025-08-31T23:59:59.999Z')
  })

  it('anchors the civil date to the venue day for Europe/Madrid in summer (UTC+2)', () => {
    // Aug 31 (local) = [Aug 30 22:00Z, Aug 31 21:59:59.999Z]
    const { start, end } = siteDateBounds({ timeZone: 'Europe/Madrid' }, '2025-08-31')
    expect(start.toISOString()).toBe('2025-08-30T22:00:00.000Z')
    expect(end.toISOString()).toBe('2025-08-31T21:59:59.999Z')
  })

  it('produces the same bounds as siteDayBounds for an instant within that day', () => {
    const site = { timeZone: 'Europe/Madrid' }
    const byKey = siteDateBounds(site, '2024-07-14')
    const byInstant = siteDayBounds(site, new Date('2024-07-14T10:00:00Z'))
    expect(byKey.start.toISOString()).toBe(byInstant.start.toISOString())
    expect(byKey.end.toISOString()).toBe(byInstant.end.toISOString())
  })

  it('handles the DST spring-forward day (Madrid, 2024-03-31 is 23h)', () => {
    const { start, end } = siteDateBounds({ timeZone: 'Europe/Madrid' }, '2024-03-31')
    expect(start.toISOString()).toBe('2024-03-30T23:00:00.000Z')
    expect(end.toISOString()).toBe('2024-03-31T21:59:59.999Z')
  })

  it('the next civil day starts exactly 1ms after this day ends (exclusive-bound contract)', () => {
    const site = { timeZone: 'Europe/Madrid' }
    const aug31 = siteDateBounds(site, '2025-08-31')
    const sep01 = siteDateBounds(site, '2025-09-01')
    expect(sep01.start.getTime()).toBe(aug31.end.getTime() + 1)
  })

  it('throws on a malformed date key', () => {
    expect(() => siteDateBounds({ timeZone: 'UTC' }, '2025-8-1')).toThrow(/YYYY-MM-DD/)
    expect(() => siteDateBounds({ timeZone: 'UTC' }, 'garbage')).toThrow()
  })

  it('anchors correctly for a timezone WEST of UTC (America/Los_Angeles, UTC-7 summer)', () => {
    // Regression guard for the localMidnight west-of-UTC bug: the naive-UTC
    // instant reads as the previous local day, so a time-of-day-only offset
    // correction produced the wrong day's midnight.
    const { start, end } = siteDateBounds({ timeZone: 'America/Los_Angeles' }, '2025-08-13')
    expect(start.toISOString()).toBe('2025-08-13T07:00:00.000Z') // Aug 13 00:00 PDT
    expect(end.toISOString()).toBe('2025-08-14T06:59:59.999Z')   // Aug 13 23:59:59.999 PDT
  })

  it('anchors correctly for New York in winter (UTC-5)', () => {
    const { start } = siteDateBounds({ timeZone: 'America/New_York' }, '2025-01-15')
    expect(start.toISOString()).toBe('2025-01-15T05:00:00.000Z') // Jan 15 00:00 EST
  })
})

// ─── siteAnchoredDay ─────────────────────────────────────────────────────────

describe('siteAnchoredDay', () => {
  const madrid = { timeZone: 'Europe/Madrid' }

  it('anchors a bare YYYY-MM-DD civil date to the venue day', () => {
    const { start, end } = siteAnchoredDay(madrid, '2025-08-13')
    // Same as siteDateBounds — Madrid summer UTC+2
    expect(start.toISOString()).toBe('2025-08-12T22:00:00.000Z')
    expect(end.toISOString()).toBe('2025-08-13T21:59:59.999Z')
  })

  it('anchors a bare civil date west of UTC without the off-by-one a UTC parse would cause', () => {
    // new Date("2025-08-13") is midnight UTC = still Aug 12 in Los Angeles; the
    // bare-date branch must NOT read it as an instant.
    const { start } = siteAnchoredDay({ timeZone: 'America/Los_Angeles' }, '2025-08-13')
    // Aug 13 00:00 PDT (UTC-7) = Aug 13 07:00Z
    expect(start.toISOString()).toBe('2025-08-13T07:00:00.000Z')
  })

  it('recovers the venue day from a browser-midnight instant (same tz as venue)', () => {
    // A Madrid browser sends midnight of Aug 13 = Aug 12 22:00Z
    const browserMidnight = '2025-08-12T22:00:00.000Z'
    const { start, end } = siteAnchoredDay(madrid, browserMidnight)
    expect(start.toISOString()).toBe('2025-08-12T22:00:00.000Z')
    expect(end.toISOString()).toBe('2025-08-13T21:59:59.999Z')
  })

  it('recovers the venue day from a browser-midnight instant (browser west of venue)', () => {
    // A UK browser (UTC+1 summer) sends midnight of Aug 13 = Aug 12 23:00Z;
    // the Madrid venue day it falls in is still Aug 13.
    const ukMidnight = '2025-08-12T23:00:00.000Z'
    const { start } = siteAnchoredDay(madrid, ukMidnight)
    expect(start.toISOString()).toBe('2025-08-12T22:00:00.000Z') // venue Aug 13 start
  })

  it('accepts a Date instance', () => {
    const { start } = siteAnchoredDay(madrid, new Date('2025-08-13T10:00:00.000Z'))
    expect(start.toISOString()).toBe('2025-08-12T22:00:00.000Z')
  })
})

// ─── siteMonthBounds ─────────────────────────────────────────────────────────

describe('siteMonthBounds', () => {
  it('spans a full UTC month for a UTC site', () => {
    const { start, end } = siteMonthBounds({ timeZone: 'UTC' }, 2025, 8)
    expect(start.toISOString()).toBe('2025-08-01T00:00:00.000Z')
    expect(end.toISOString()).toBe('2025-08-31T23:59:59.999Z')
  })

  it('anchors the month to the venue day for Europe/Madrid (Aug, UTC+2)', () => {
    // Venue August = [Jul 31 22:00Z, Aug 31 21:59:59.999Z]. The first two UTC
    // hours of Aug 1 belong to the venue's July, not August.
    const { start, end } = siteMonthBounds({ timeZone: 'Europe/Madrid' }, 2025, 8)
    expect(start.toISOString()).toBe('2025-07-31T22:00:00.000Z')
    expect(end.toISOString()).toBe('2025-08-31T21:59:59.999Z')
  })

  it('handles the December → next-year rollover', () => {
    const { start, end } = siteMonthBounds({ timeZone: 'Europe/Madrid' }, 2025, 12)
    expect(start.toISOString()).toBe('2025-11-30T23:00:00.000Z') // Dec 1 00:00 CET (UTC+1)
    expect(end.toISOString()).toBe('2025-12-31T22:59:59.999Z')   // Dec 31 23:59:59.999 CET
  })

  it('handles February (28 days) correctly', () => {
    const { start, end } = siteMonthBounds({ timeZone: 'UTC' }, 2025, 2)
    expect(start.toISOString()).toBe('2025-02-01T00:00:00.000Z')
    expect(end.toISOString()).toBe('2025-02-28T23:59:59.999Z')
  })

  it("the next month's start is exactly 1ms after this month's end", () => {
    const site = { timeZone: 'Europe/Madrid' }
    const aug = siteMonthBounds(site, 2025, 8)
    const sep = siteMonthBounds(site, 2025, 9)
    expect(sep.start.getTime()).toBe(aug.end.getTime() + 1)
  })

  it('throws on an out-of-range month', () => {
    expect(() => siteMonthBounds({ timeZone: 'UTC' }, 2025, 0)).toThrow(/1-12/)
    expect(() => siteMonthBounds({ timeZone: 'UTC' }, 2025, 13)).toThrow(/1-12/)
  })
})
