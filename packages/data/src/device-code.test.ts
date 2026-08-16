/**
 * HW device code rules (track 019).
 *
 * The property that actually matters here is the ROUND TRIP: a minted code must
 * survive normalisation unchanged. Minting and route lookup are on opposite sides
 * of a sticker that gets glued to a potted device — if they ever disagree, the
 * device is unreachable and the only fix is a site visit with a label printer.
 */

import { describe, it, expect } from 'vitest'

import {
  DEVICE_CODE_ALPHABET,
  DEVICE_CODE_LENGTH,
  generateDeviceCode,
  isValidDeviceCode,
  normalizeDeviceCode,
} from './device-code'

describe('alphabet', () => {
  it('is exactly 32 symbols, so a 5-bit mask is unbiased', () => {
    expect(DEVICE_CODE_ALPHABET).toHaveLength(32)
  })

  it('excludes every glyph that is ambiguous on a small label', () => {
    for (const ch of ['I', 'L', 'O']) {
      expect(DEVICE_CODE_ALPHABET).not.toContain(ch)
    }
  })

  it('excludes U, so a sticker cannot mint an accidental obscenity', () => {
    expect(DEVICE_CODE_ALPHABET).not.toContain('U')
  })

  it('has no duplicate symbols', () => {
    expect(new Set(DEVICE_CODE_ALPHABET).size).toBe(DEVICE_CODE_ALPHABET.length)
  })
})

describe('normalizeDeviceCode', () => {
  it('uppercases and folds the Crockford ambiguities', () => {
    expect(normalizeDeviceCode('7qk3m2')).toBe('7QK3M2')
    expect(normalizeDeviceCode(' 7qk3m2 ')).toBe('7QK3M2')
    expect(normalizeDeviceCode('IL0O')).toBe('1100')
  })

  it('is idempotent — normalising twice changes nothing', () => {
    for (const raw of ['7qk3m2', 'IL0O', ' abc123 ', 'ZZZZZZ']) {
      const once = normalizeDeviceCode(raw)
      expect(normalizeDeviceCode(once)).toBe(once)
    }
  })
})

describe('generateDeviceCode', () => {
  it('mints a code of the contracted length', () => {
    expect(generateDeviceCode()).toHaveLength(DEVICE_CODE_LENGTH)
  })

  it('mints only in-alphabet symbols across many draws', () => {
    for (let i = 0; i < 500; i++) {
      for (const ch of generateDeviceCode()) {
        expect(DEVICE_CODE_ALPHABET).toContain(ch)
      }
    }
  })

  it('SURVIVES normalisation unchanged — the mint/lookup round trip', () => {
    // The one that keeps a fielded device reachable. A minted code containing a
    // foldable glyph would normalise to something else at lookup time, and the
    // sticker would point at a device that cannot be found.
    for (let i = 0; i < 500; i++) {
      const code = generateDeviceCode()
      expect(normalizeDeviceCode(code)).toBe(code)
      expect(isValidDeviceCode(code)).toBe(true)
    }
  })

  it('maps every byte value into the alphabet without bias', () => {
    // 256 is a multiple of 32, so masking the low 5 bits is uniform: byte b and
    // b+32 must land on the same symbol, and all 32 symbols must be reachable.
    const seen = new Set<string>()
    for (let b = 0; b < 256; b++) {
      const code = generateDeviceCode(() => new Uint8Array(DEVICE_CODE_LENGTH).fill(b))
      expect(new Set(code).size).toBe(1)
      seen.add(code[0]!)
      expect(code[0]).toBe(DEVICE_CODE_ALPHABET[b & 31])
    }
    expect(seen.size).toBe(32)
  })

  it('is random, not sequential — draws differ', () => {
    // Sequential codes would leak fleet size to anyone reading two stickers.
    const codes = new Set(Array.from({ length: 200 }, () => generateDeviceCode()))
    // Collisions are possible but 200 draws from 1.07e9 colliding more than a
    // couple of times would mean the generator is not random at all.
    expect(codes.size).toBeGreaterThan(190)
  })
})

describe('isValidDeviceCode', () => {
  it('accepts a canonical code and its foldable spellings', () => {
    expect(isValidDeviceCode('7QK3M2')).toBe(true)
    expect(isValidDeviceCode('7qk3m2')).toBe(true)
    // 'i' folds to 1 and 'o' to 0, so this is a valid spelling of 7QK312.
    expect(isValidDeviceCode('7qk3i2')).toBe(true)
  })

  it('rejects wrong lengths', () => {
    expect(isValidDeviceCode('7QK3M')).toBe(false)
    expect(isValidDeviceCode('7QK3M22')).toBe(false)
    expect(isValidDeviceCode('')).toBe(false)
  })

  it('rejects out-of-alphabet symbols', () => {
    expect(isValidDeviceCode('7QK3M-')).toBe(false)
    expect(isValidDeviceCode('7QK3 2')).toBe(false)
    // U is not in the alphabet and does not fold to anything.
    expect(isValidDeviceCode('7QK3MU')).toBe(false)
  })
})
