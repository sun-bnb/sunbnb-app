import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rateLimit } from './rate-limit'

describe('rateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows up to maxAttempts requests', () => {
    const key = 'test-allow-' + Math.random()
    for (let i = 0; i < 5; i++) {
      const result = rateLimit(key, { maxAttempts: 5, windowMs: 60000 })
      expect(result.allowed).toBe(true)
    }
  })

  it('blocks after maxAttempts exceeded', () => {
    const key = 'test-block-' + Math.random()
    for (let i = 0; i < 5; i++) {
      rateLimit(key, { maxAttempts: 5, windowMs: 60000 })
    }
    const result = rateLimit(key, { maxAttempts: 5, windowMs: 60000 })
    expect(result.allowed).toBe(false)
  })

  it('returns retryAfterMs when blocked', () => {
    const key = 'test-retry-' + Math.random()
    for (let i = 0; i < 3; i++) {
      rateLimit(key, { maxAttempts: 3, windowMs: 60000 })
    }
    const result = rateLimit(key, { maxAttempts: 3, windowMs: 60000 })
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.retryAfterMs).toBeGreaterThan(0)
      expect(result.retryAfterMs).toBeLessThanOrEqual(60000)
    }
  })

  it('resets after window expires', () => {
    const key = 'test-reset-' + Math.random()
    for (let i = 0; i < 3; i++) {
      rateLimit(key, { maxAttempts: 3, windowMs: 60000 })
    }
    expect(rateLimit(key, { maxAttempts: 3, windowMs: 60000 }).allowed).toBe(false)

    vi.advanceTimersByTime(60001)

    const result = rateLimit(key, { maxAttempts: 3, windowMs: 60000 })
    expect(result.allowed).toBe(true)
  })

  it('respects custom maxAttempts and windowMs', () => {
    const key = 'test-custom-' + Math.random()
    for (let i = 0; i < 2; i++) {
      rateLimit(key, { maxAttempts: 2, windowMs: 10000 })
    }
    expect(rateLimit(key, { maxAttempts: 2, windowMs: 10000 }).allowed).toBe(false)
  })

  it('tracks different keys independently', () => {
    const key1 = 'test-indep-a-' + Math.random()
    const key2 = 'test-indep-b-' + Math.random()
    for (let i = 0; i < 3; i++) {
      rateLimit(key1, { maxAttempts: 3, windowMs: 60000 })
    }
    expect(rateLimit(key1, { maxAttempts: 3, windowMs: 60000 }).allowed).toBe(false)
    expect(rateLimit(key2, { maxAttempts: 3, windowMs: 60000 }).allowed).toBe(true)
  })

  it('works with default options', () => {
    const key = 'test-defaults-' + Math.random()
    const result = rateLimit(key)
    expect(result.allowed).toBe(true)
  })
})
