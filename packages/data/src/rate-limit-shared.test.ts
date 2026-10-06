import { describe, expect, it } from 'vitest'
import { counterKey, windowStart } from './rate-limit-shared'

describe('windowStart', () => {
  it('puts every moment of a window on the same start', () => {
    const hour = 3_600_000
    expect(windowStart(Date.UTC(2026, 9, 6, 10, 0, 0), hour)).toBe(Date.UTC(2026, 9, 6, 10))
    expect(windowStart(Date.UTC(2026, 9, 6, 10, 59, 59, 999), hour)).toBe(Date.UTC(2026, 9, 6, 10))
    expect(windowStart(Date.UTC(2026, 9, 6, 11), hour)).toBe(Date.UTC(2026, 9, 6, 11))
  })
})

describe('counterKey', () => {
  it('never stores the raw subject (an IP or an email address)', () => {
    const key = counterKey('demo:203.0.113.7', 0)
    expect(key).not.toContain('203.0.113.7')
    expect(key).toMatch(/^[0-9a-f]{64}:0$/)
  })
  it('separates scopes, subjects and windows', () => {
    const keys = new Set([counterKey('a:1', 0), counterKey('b:1', 0), counterKey('a:2', 0), counterKey('a:1', 60_000)])
    expect(keys.size).toBe(4)
  })
})
