import { describe, it, expect } from 'vitest'
import { isDemoPayment, isValidEntityId } from './stripe'

describe('isDemoPayment', () => {
  it('returns true for pi_demo_ prefix', () => {
    expect(isDemoPayment('pi_demo_123')).toBe(true)
  })

  it('returns true for pi_demo_ with no suffix', () => {
    expect(isDemoPayment('pi_demo_')).toBe(true)
  })

  it('returns false for real Stripe payment intents', () => {
    expect(isDemoPayment('pi_real_123')).toBe(false)
  })

  it('returns false for Mollie payment refs', () => {
    expect(isDemoPayment('tr_abc')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isDemoPayment(null)).toBe(false)
  })
})

describe('isValidEntityId', () => {
  it('accepts valid CUID', () => {
    expect(isValidEntityId('cm1234567890abcdefghijklmn')).toBe(true)
  })

  it('accepts valid UUID v4', () => {
    expect(isValidEntityId('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })

  it('rejects random string', () => {
    expect(isValidEntityId('not-a-valid-id')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidEntityId('')).toBe(false)
  })

  it('rejects SQL injection string', () => {
    expect(isValidEntityId("'; DROP TABLE users; --")).toBe(false)
  })

  it('rejects short CUID-like string', () => {
    expect(isValidEntityId('c123')).toBe(false)
  })
})
