import { describe, it, expect } from 'vitest'
import { isDemoPayment, isValidEntityId } from './payment-ids'

describe('isDemoPayment', () => {
  it('is true for the pi_demo_ prefix', () => {
    expect(isDemoPayment('pi_demo_1700000000000')).toBe(true)
  })
  it('is false for real refs', () => {
    expect(isDemoPayment('tr_abc123')).toBe(false)
    expect(isDemoPayment('pi_real_123')).toBe(false)
  })
  it('is false for null', () => {
    expect(isDemoPayment(null)).toBe(false)
  })
})

describe('isValidEntityId', () => {
  it('accepts a CUID', () => {
    expect(isValidEntityId('cmlzlhxf70000pnee1jwug8jx')).toBe(true)
  })
  it('accepts a UUID v4', () => {
    expect(isValidEntityId('123e4567-e89b-42d3-a456-426614174000')).toBe(true)
  })
  it('rejects malformed ids', () => {
    expect(isValidEntityId('not-an-id')).toBe(false)
    expect(isValidEntityId('')).toBe(false)
    expect(isValidEntityId('"; DROP TABLE')).toBe(false)
  })
})
