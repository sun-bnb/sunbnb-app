import { describe, it, expect, beforeEach } from 'vitest'
import { markNewUser, consumeNewUser, isFreshNewUser, resetNewUserSignals, NEW_USER_SESSION_TTL_MS } from './new-user-signal'

describe('new-user signal (GA4 sign_up one-shot)', () => {
  beforeEach(() => resetNewUserSignals())

  it('is true exactly once after the account was created', () => {
    markNewUser('A@b.com', 1000)
    expect(consumeNewUser('a@b.com', 2000)).toBe(true) // case-insensitive email key
    expect(consumeNewUser('a@b.com', 2001)).toBe(false) // second sign-in must be a login
  })

  it('is false for a user that was never marked (returning login)', () => {
    expect(consumeNewUser('old@b.com')).toBe(false)
    expect(consumeNewUser(null)).toBe(false)
  })

  it('does not leak an unconsumed mark into a much later sign-in', () => {
    markNewUser('a@b.com', 0)
    expect(consumeNewUser('a@b.com', 120_000)).toBe(false)
  })

  it('does not cross over to another email', () => {
    markNewUser('a@b.com', 0)
    expect(consumeNewUser('other@b.com', 1)).toBe(false)
  })

  it('session only reports a fresh token timestamp, never a stale or malformed one', () => {
    const now = 10_000_000
    expect(isFreshNewUser(now - 1000, now)).toBe(true)
    expect(isFreshNewUser(now - NEW_USER_SESSION_TTL_MS - 1, now)).toBe(false)
    expect(isFreshNewUser(now + 5000, now)).toBe(false)
    expect(isFreshNewUser(undefined, now)).toBe(false)
    expect(isFreshNewUser(true, now)).toBe(false)
  })
})
