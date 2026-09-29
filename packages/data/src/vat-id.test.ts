import { describe, it, expect } from 'vitest'
import {
  normalizeVatId,
  validateVatId,
  isValidSpanishTaxId,
  isUsableVatId,
} from './vat-id'

// Vectors are computed from the published algorithms and checked by hand, not
// lifted from a library — a checksum test that trusts the same source as the
// implementation proves nothing.
//
//   B22435705  CIF, type B (digit control): even 2+3+7=12, odd 4+8+1+0=13,
//              total 25 → control digit 5. This is Sunbnb's own, on its site.
//   12345678Z  NIF: 12345678 mod 23 = 14 → 'Z'.
//   X1234567L  NIE: X→0, 1234567 mod 23 = 19 → 'L'.
//   12345671   Y-tunnus: 7·1+9·2+10·3+5·4+8·5+4·6+2·7 = 153, 153 mod 11 = 10,
//              check = 11−10 = 1.

describe('normalizeVatId', () => {
  it('strips the punctuation people actually type', () => {
    expect(normalizeVatId(' b-2243.5705 ')).toBe('B22435705')
    expect(normalizeVatId('12 345 678 z')).toBe('12345678Z')
  })

  it('treats null, undefined and blank alike', () => {
    expect(normalizeVatId(null)).toBe('')
    expect(normalizeVatId(undefined)).toBe('')
    expect(normalizeVatId('   ')).toBe('')
  })
})

describe('Spanish tax ids', () => {
  it.each(['B22435705', '12345678Z', 'X1234567L', 'J29503265'])('accepts %s', (id) => {
    expect(isValidSpanishTaxId(id)).toBe(true)
  })

  it('accepts an ES-prefixed form', () => {
    expect(isValidSpanishTaxId('ESB22435705')).toBe(true)
  })

  it('rejects a NIF whose control letter is wrong', () => {
    // One letter off is the single most common typo, and the checksum exists
    // precisely to catch it.
    expect(isValidSpanishTaxId('12345678A')).toBe(false)
  })

  it('rejects a CIF whose control character is wrong', () => {
    expect(isValidSpanishTaxId('B22435704')).toBe(false)
  })

  it('rejects a digit control on an entity type that requires a letter', () => {
    // Type P (local authority) must carry a letter. Same digits, wrong class.
    expect(isValidSpanishTaxId('P2243570' + '5')).toBe(false)
  })

  it.each([
    ['a company name', 'Alonso Beach'],
    ['keyboard mash', 'wdcecec'],
    ['empty-ish', '---'],
    ['too short', 'B2243570'],
    ['too long', 'B224357055'],
  ])('rejects %s', (_label, id) => {
    expect(isValidSpanishTaxId(id)).toBe(false)
  })
})

describe('validateVatId', () => {
  it('reports a missing id as missing, not invalid', () => {
    // A partner who has not filled the field in yet has not made a mistake.
    expect(validateVatId('', 'ES')).toMatchObject({ status: 'missing', error: null })
    expect(validateVatId(null, 'ES').status).toBe('missing')
  })

  it('validates Spain by checksum', () => {
    expect(validateVatId('B22435705', 'ES')).toMatchObject({
      status: 'valid',
      normalized: 'B22435705',
      error: null,
    })
  })

  it('explains a Spanish rejection in terms a partner can act on', () => {
    const r = validateVatId('Alonso Beach', 'ES')
    expect(r.status).toBe('invalid')
    expect(r.error).toContain('NIF')
  })

  it('validates Finland by checksum', () => {
    expect(validateVatId('12345671', 'FI').status).toBe('valid')
    expect(validateVatId('FI12345671', 'FI').status).toBe('valid')
  })

  it('rejects a Y-tunnus whose check digit is wrong', () => {
    expect(validateVatId('12345670', 'FI').status).toBe('invalid')
  })

  it('rejects a Y-tunnus in the remainder-1 band that is never issued', () => {
    // Prefix 0000006 weights to 2·6 = 12, and 12 mod 11 = 1 — the one remainder
    // for which no check digit exists, so no such id is ever issued. Every
    // possible final digit must be rejected, not just a mismatched one.
    for (let d = 0; d <= 9; d++) {
      expect(validateVatId(`0000006${d}`, 'FI').status).toBe('invalid')
    }
  })

  it('accepts a well-formed id from a country we have no checksum for', () => {
    // `unchecked` is the honest answer: the shape holds and we have no rule.
    expect(validateVatId('DE123456789', 'DE').status).toBe('unchecked')
  })

  it('rejects a malformed id from a country we DO have a shape for', () => {
    expect(validateVatId('DE12345', 'DE').status).toBe('invalid')
  })

  it('returns unchecked for a country we know nothing about', () => {
    // Never `invalid` — calling something wrong because WE cannot check it
    // would block a legitimate partner for our own ignorance.
    expect(validateVatId('123456', 'BR').status).toBe('unchecked')
    expect(validateVatId('123456', null).status).toBe('unchecked')
  })

  it('normalizes before judging, so formatting never decides validity', () => {
    expect(validateVatId('b-2243.5705', 'es').status).toBe('valid')
  })
})

describe('isUsableVatId', () => {
  it('treats valid and unchecked as usable, missing and invalid as not', () => {
    expect(isUsableVatId(validateVatId('B22435705', 'ES'))).toBe(true)
    expect(isUsableVatId(validateVatId('DE123456789', 'DE'))).toBe(true)
    expect(isUsableVatId(validateVatId('Alonso Beach', 'ES'))).toBe(false)
    expect(isUsableVatId(validateVatId('', 'ES'))).toBe(false)
  })
})
