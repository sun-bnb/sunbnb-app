import { describe, it, expect } from 'vitest'
import { gaAuthEventFor, hasFired, markFired, shouldFire, NEW_ACCOUNT_WINDOW_MS, type OnceStorage } from './analytics'

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0)

function memoryStorage(): OnceStorage {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }
}

describe('gaAuthEventFor', () => {
  it('a user row created seconds ago is a sign_up', () => {
    const r = gaAuthEventFor(new Date(NOW - 5_000), 'google', NOW)
    expect(r).toEqual({ event: 'sign_up', method: 'google', at: NOW })
  })

  it('an older account is a login, not a sign_up', () => {
    expect(gaAuthEventFor(new Date(NOW - NEW_ACCOUNT_WINDOW_MS - 1), 'google', NOW)?.event).toBe('login')
    expect(gaAuthEventFor('2025-01-01T00:00:00Z', 'google', NOW)?.event).toBe('login')
  })

  it('returns null when it cannot tell, rather than guessing sign_up', () => {
    expect(gaAuthEventFor(null, 'google', NOW)).toBeNull()
    expect(gaAuthEventFor(undefined, 'google', NOW)).toBeNull()
    expect(gaAuthEventFor('garbage', 'google', NOW)).toBeNull()
    expect(gaAuthEventFor(new Date(NOW), undefined, NOW)).toBeNull()
  })

  it('a createdAt in the future (clock skew) is not treated as new', () => {
    expect(gaAuthEventFor(new Date(NOW + 60_000), 'google', NOW)?.event).toBe('login')
  })

  it('carries no personal identifiers', () => {
    const r = gaAuthEventFor(new Date(NOW), 'credentials', NOW)!
    expect(Object.keys(r).sort()).toEqual(['at', 'event', 'method'])
  })
})

describe('once-only guard', () => {
  it('fires the first time and never again for the same key', () => {
    const s = memoryStorage()
    expect(shouldFire(s, 'site_created:a')).toBe(true)
    markFired(s, 'site_created:a')
    expect(hasFired(s, 'site_created:a')).toBe(true)
    expect(shouldFire(s, 'site_created:a')).toBe(false)
  })

  it('keys are independent (a second site still fires)', () => {
    const s = memoryStorage()
    markFired(s, 'site_created:a')
    expect(shouldFire(s, 'site_created:b')).toBe(true)
  })

  it('a throwing storage never breaks the page', () => {
    const bad: OnceStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(() => markFired(bad, 'k')).not.toThrow()
    expect(shouldFire(bad, 'k')).toBe(true)
  })
})
