/**
 * Partner codes (track 021). The rules matter because this string is flashed
 * into potted hardware and read off labels by people in glare — the same
 * constraints the device code was designed under, which is why it reuses them.
 */

import { describe, it, expect } from 'vitest'
import {
  generatePartnerCode,
  normalizePartnerCode,
  isValidPartnerCode,
  PARTNER_CODE_PREFIX,
} from './partner-code'
import { isValidDeviceCode } from './device-code'

describe('normalizePartnerCode', () => {
  it('folds the ambiguous glyphs Crockford exists to remove', () => {
    // I and L read as 1, O as 0, U as V — the confusions that actually happen
    // when someone types a code off a sticker.
    expect(normalizePartnerCode('p-il0uz')).toBe('P-11 0VZ'.replace(' ', ''))
  })

  it('accepts the code with or without its prefix, and restores it', () => {
    expect(normalizePartnerCode('4KQ9M')).toBe('P-4KQ9M')
    expect(normalizePartnerCode('P-4KQ9M')).toBe('P-4KQ9M')
    expect(normalizePartnerCode('p4kq9m')).toBe('P-4KQ9M')
  })

  it('strips whitespace and stray punctuation rather than rejecting outright', () => {
    expect(normalizePartnerCode('  p-4kq 9m ')).toBe('P-4KQ9M')
  })
})

describe('isValidPartnerCode', () => {
  it('accepts a well-formed code in any spelling', () => {
    expect(isValidPartnerCode('P-4KQ9M')).toBe(true)
    expect(isValidPartnerCode('p4kq9m')).toBe(true)
  })

  it('rejects wrong lengths', () => {
    expect(isValidPartnerCode('P-4KQ9')).toBe(false)
    expect(isValidPartnerCode('P-4KQ9MX')).toBe(false)
    expect(isValidPartnerCode('')).toBe(false)
  })
})

describe('generatePartnerCode', () => {
  it('always produces a code that validates and round-trips through normalisation', () => {
    for (let i = 0; i < 200; i++) {
      const code = generatePartnerCode()
      expect(isValidPartnerCode(code), code).toBe(true)
      expect(normalizePartnerCode(code)).toBe(code)
    }
  })

  it('is random rather than sequential — a sequence would leak the customer count', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generatePartnerCode()))
    expect(codes.size).toBeGreaterThan(40)
  })

  // The prefix is the whole point of the format: both identifiers are short
  // Crockford strings that sit side by side in firmware config and in support
  // conversations, and confusing them is a real 7am-on-a-beach mistake.
  it('can never be mistaken for a DEVICE code', () => {
    for (let i = 0; i < 50; i++) {
      const partner = generatePartnerCode()
      expect(partner.startsWith(PARTNER_CODE_PREFIX)).toBe(true)
      expect(isValidDeviceCode(partner)).toBe(false)
    }
  })
})
