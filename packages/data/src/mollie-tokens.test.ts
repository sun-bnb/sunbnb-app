import { describe, it, expect } from 'vitest'
import { isMollieTokenFresh, mollieTokenExpiresAtFrom } from './mollie-tokens'

describe('isMollieTokenFresh', () => {
  const now = new Date('2026-05-25T12:00:00Z')

  it('is false when no expiry is stored', () => {
    expect(isMollieTokenFresh(null, now)).toBe(false)
    expect(isMollieTokenFresh(undefined, now)).toBe(false)
  })

  it('is false when already expired', () => {
    expect(isMollieTokenFresh(new Date('2026-05-25T11:00:00Z'), now)).toBe(false)
  })

  it('is false within the 120s safety buffer of expiry (refresh proactively)', () => {
    // 60s before the real expiry — inside the buffer, so treated as not fresh.
    expect(isMollieTokenFresh(new Date('2026-05-25T12:01:00Z'), now)).toBe(false)
  })

  it('is true when comfortably before expiry', () => {
    expect(isMollieTokenFresh(new Date('2026-05-25T12:30:00Z'), now)).toBe(true)
  })
})

describe('mollieTokenExpiresAtFrom', () => {
  it('is null for missing / zero / negative expires_in', () => {
    expect(mollieTokenExpiresAtFrom(null)).toBeNull()
    expect(mollieTokenExpiresAtFrom(undefined)).toBeNull()
    expect(mollieTokenExpiresAtFrom(0)).toBeNull()
    expect(mollieTokenExpiresAtFrom(-5)).toBeNull()
  })

  it('is now + expires_in seconds for a positive value', () => {
    const before = Date.now()
    const d = mollieTokenExpiresAtFrom(3600)
    expect(d).toBeInstanceOf(Date)
    const deltaMs = d!.getTime() - before
    expect(deltaMs).toBeGreaterThanOrEqual(3600_000 - 1000)
    expect(deltaMs).toBeLessThanOrEqual(3600_000 + 1000)
  })
})
