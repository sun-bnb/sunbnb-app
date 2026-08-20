/**
 * Site code rules (track 022).
 *
 * Two properties carry real consequences, and both involve a printed card:
 *
 *  1. The ROUND TRIP — a minted code must survive normalisation unchanged.
 *     Minting (wizard/backfill) and lookup (the `/q/…` routes) sit on opposite
 *     sides of a card glued to a lounger; if they disagree, every card at that
 *     venue is unreachable and the fix is a reprint.
 *  2. The LENGTH BUDGET — the code was sized so the whole printed URL stays
 *     inside QR byte-mode version 3. Growing it is a silent, physical
 *     regression: the card still works, it just stops scanning at arm's length.
 *
 * Alphabet properties (32 symbols, no ambiguous glyphs, unbiased byte mapping)
 * are tested once in `device-code.test.ts` — this module reuses that alphabet
 * rather than declaring its own, so re-asserting them here would test nothing.
 */

import { describe, it, expect } from 'vitest'

import {
  SITE_CODE_PREFIX,
  SITE_CODE_BODY_LENGTH,
  generateSiteCode,
  isValidSiteCode,
  normalizeSiteCode,
  isSiteCodeCollision,
} from './site-code'
import { DEVICE_CODE_ALPHABET, isValidDeviceCode } from './device-code'
import { isValidPartnerCode } from './partner-code'

describe('normalizeSiteCode', () => {
  it('folds a lowercase hand-typed URL segment to the stored form', () => {
    // The realistic input: someone reads the card aloud and another types it
    // into a phone browser, which will not shift-key the path.
    expect(normalizeSiteCode('s-k7m2x9')).toBe('S-K7M2X9')
  })

  it('folds the Crockford ambiguities a person actually mistypes', () => {
    // I and L read as 1, O as 0, U as V.
    expect(normalizeSiteCode('S-IL0UZ3')).toBe('S-110VZ3')
  })

  it('accepts the code with or without its prefix, and restores it', () => {
    expect(normalizeSiteCode('K7M2X9')).toBe('S-K7M2X9')
    expect(normalizeSiteCode('S-K7M2X9')).toBe('S-K7M2X9')
    expect(normalizeSiteCode('sk7m2x9')).toBe('S-K7M2X9')
  })

  it('strips whitespace and stray punctuation rather than rejecting outright', () => {
    expect(normalizeSiteCode('  s-k7m 2x9 ')).toBe('S-K7M2X9')
  })

  it('is idempotent — normalising twice changes nothing', () => {
    for (const raw of ['s-k7m2x9', 'K7M2X9', ' il0u12 ', 'ZZZZZZ']) {
      const once = normalizeSiteCode(raw)
      expect(normalizeSiteCode(once)).toBe(once)
    }
  })
})

describe('isValidSiteCode', () => {
  it('accepts a well-formed code in any spelling', () => {
    expect(isValidSiteCode('S-K7M2X9')).toBe(true)
    expect(isValidSiteCode('sk7m2x9')).toBe(true)
    // 'i' folds to 1, so this is a valid spelling of S-1K7M2X.
    expect(isValidSiteCode('S-iK7M2X')).toBe(true)
  })

  it('rejects wrong lengths', () => {
    expect(isValidSiteCode('S-K7M2X')).toBe(false)
    expect(isValidSiteCode('S-K7M2X99')).toBe(false)
    expect(isValidSiteCode('')).toBe(false)
    expect(isValidSiteCode('S-')).toBe(false)
  })
})

describe('generateSiteCode', () => {
  it('mints a prefixed code of the contracted body length', () => {
    const code = generateSiteCode()
    expect(code.startsWith(SITE_CODE_PREFIX)).toBe(true)
    expect(code.slice(SITE_CODE_PREFIX.length)).toHaveLength(SITE_CODE_BODY_LENGTH)
  })

  it('SURVIVES normalisation unchanged — the mint/lookup round trip', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateSiteCode()
      expect(normalizeSiteCode(code)).toBe(code)
      expect(isValidSiteCode(code)).toBe(true)
    }
  })

  it('mints only in-alphabet symbols', () => {
    for (let i = 0; i < 200; i++) {
      for (const ch of generateSiteCode().slice(SITE_CODE_PREFIX.length)) {
        expect(DEVICE_CODE_ALPHABET).toContain(ch)
      }
    }
  })

  it('is random, not sequential — a sequence would leak the venue count', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateSiteCode()))
    expect(codes.size).toBeGreaterThan(190)
  })

  it('maps bytes through the 5-bit mask, so the injected-random contract holds', () => {
    const code = generateSiteCode(() => new Uint8Array(SITE_CODE_BODY_LENGTH).fill(33))
    // 33 & 31 = 1 → the alphabet's second symbol, for every position.
    expect(code).toBe(`${SITE_CODE_PREFIX}${DEVICE_CODE_ALPHABET[1]!.repeat(SITE_CODE_BODY_LENGTH)}`)
  })
})

describe('the printed URL length budget', () => {
  // Track 022 sized the code against QR byte-mode ECC-M version 3, whose cap is
  // 42 characters. Blowing it does not break anything visibly — the card still
  // resolves — it just pushes the symbol to version 4 (33×33 instead of 29×29)
  // and quietly costs scan distance in glare, on every card already printed.
  const QR_V3_BYTE_CAPACITY = 42
  const ORIGIN = 'https://sunbnb.app/q/'
  // The largest unit address observed in real data (parcel 13, row 15, seq 25).
  const WORST_ADDRESS = '13-15-25'

  it('keeps the worst-case printed URL inside one QR version-3 symbol', () => {
    const url = `${ORIGIN}${generateSiteCode()}/${WORST_ADDRESS}`
    expect(url.length).toBeLessThanOrEqual(QR_V3_BYTE_CAPACITY)
  })

  it('still fits once a venue outgrows two-digit parcels and seqs', () => {
    // The 4 characters of headroom belong to the ADDRESS, not to the code: this
    // is what they are being kept for. `123-150-250` is the address format at a
    // venue an order of magnitude past anything built today.
    const url = `${ORIGIN}${generateSiteCode()}/123-150-250`
    expect(url.length).toBeLessThanOrEqual(QR_V3_BYTE_CAPACITY)
  })

  it('pins the body length that budget was computed from', () => {
    // Independent of DEVICE_CODE_LENGTH on purpose: that constant is documented
    // as widening to 8 above ~100k devices, and inheriting the change here would
    // spend the 4 characters of margin above without anyone deciding to.
    expect(SITE_CODE_BODY_LENGTH).toBe(6)
  })
})

describe('cross-family confusion', () => {
  it('a MINTED site code is never accepted as a device or partner code', () => {
    // The direction that matters: what we print must not be readable as another
    // family's identifier by the code that looks those up.
    for (let i = 0; i < 50; i++) {
      const code = generateSiteCode()
      expect(isValidDeviceCode(code), code).toBe(false)
      expect(isValidPartnerCode(code), code).toBe(false)
    }
  })

  it('deliberately accepts a BARE body, which a device code also satisfies', () => {
    // Asymmetry by choice, not by accident. Prefix-optional exists so a
    // hand-typed `/q/k7m2x9/1-1-1` still resolves. The cost is that a bare
    // 6-symbol device code parses as a site code body — harmless, because the
    // lookup it feeds is scoped to the Site table and simply finds nothing.
    // If this ever stops being harmless, require the prefix HERE, not in
    // normalizeSiteCode (the routes depend on normalisation being forgiving).
    expect(isValidSiteCode('NWJMDB')).toBe(true)
    expect(normalizeSiteCode('NWJMDB')).toBe('S-NWJMDB')
  })
})

describe('isSiteCodeCollision', () => {
  it('recognises the code constraint', () => {
    expect(isSiteCodeCollision({ code: 'P2002', meta: { target: ['code'] } })).toBe(true)
    expect(isSiteCodeCollision({ code: 'P2002', meta: { target: 'Site_code_key' } })).toBe(true)
  })

  it('does NOT swallow a different unique constraint on Site', () => {
    // A restaurantId clash retried five times with fresh site codes would burn
    // the retries and then surface as the wrong error entirely.
    expect(isSiteCodeCollision({ code: 'P2002', meta: { target: ['restaurantId'] } })).toBe(false)
  })

  it('ignores errors that are not unique violations at all', () => {
    expect(isSiteCodeCollision({ code: 'P2025' })).toBe(false)
    expect(isSiteCodeCollision(new Error('connection lost'))).toBe(false)
    expect(isSiteCodeCollision(null)).toBe(false)
    expect(isSiteCodeCollision(undefined)).toBe(false)
  })

  it('treats an unattributable P2002 as a collision, so creation is not stranded', () => {
    expect(isSiteCodeCollision({ code: 'P2002' })).toBe(true)
    expect(isSiteCodeCollision({ code: 'P2002', meta: {} })).toBe(true)
  })
})
