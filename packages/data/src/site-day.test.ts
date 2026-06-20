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
import { resolveSiteTimeZone, siteDayKey, siteDayBounds } from './site-day'

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
