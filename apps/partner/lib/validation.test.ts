import { describe, it, expect } from 'vitest'
import {
  validateImageFile,
  safeBlobKey,
  validatePassword,
  isValidSiteStatus,
  isValidPaymentProvider,
  isValidOrderStatus,
  isValidOrderPaymentType,
  isValidRentalPaymentType,
  isValidProductCategory,
  isValidItemStatus,
} from './validation'

// ─── validateImageFile ──────────────────────────────────────────────────────

describe('validateImageFile', () => {
  function fakeFile(type: string, size: number): File {
    return { type, size } as File
  }

  it('accepts valid JPEG under size limit', () => {
    expect(validateImageFile(fakeFile('image/jpeg', 1024))).toEqual({ ok: true })
  })

  it('accepts valid PNG', () => {
    expect(validateImageFile(fakeFile('image/png', 5_000_000))).toEqual({ ok: true })
  })

  it('accepts valid WebP', () => {
    expect(validateImageFile(fakeFile('image/webp', 100))).toEqual({ ok: true })
  })

  it('rejects disallowed MIME type', () => {
    const result = validateImageFile(fakeFile('application/pdf', 1024))
    expect(result).toMatchObject({ ok: false })
    expect((result as any).error).toContain('Invalid image type')
  })

  it('rejects file over 10 MB', () => {
    const result = validateImageFile(fakeFile('image/jpeg', 11 * 1024 * 1024))
    expect(result).toMatchObject({ ok: false })
    expect((result as any).error).toContain('too large')
  })

  it('rejects empty file', () => {
    const result = validateImageFile(fakeFile('image/jpeg', 0))
    expect(result).toMatchObject({ ok: false })
  })

  it('accepts file exactly at 10 MB limit', () => {
    expect(validateImageFile(fakeFile('image/jpeg', 10 * 1024 * 1024))).toEqual({ ok: true })
  })
})

// ─── validatePassword ───────────────────────────────────────────────────────

describe('validatePassword', () => {
  it('accepts strong password', () => {
    expect(validatePassword('Passw0rd')).toEqual({ ok: true })
  })

  it('rejects too short', () => {
    const result = validatePassword('Pw1')
    expect(result).toMatchObject({ ok: false })
    expect((result as any).error).toContain('at least 8')
  })

  it('rejects missing lowercase', () => {
    const result = validatePassword('PASSWORD1')
    expect(result).toMatchObject({ ok: false })
    expect((result as any).error).toContain('lowercase')
  })

  it('rejects missing uppercase', () => {
    const result = validatePassword('password1')
    expect(result).toMatchObject({ ok: false })
    expect((result as any).error).toContain('uppercase')
  })

  it('rejects missing digit', () => {
    const result = validatePassword('Password')
    expect(result).toMatchObject({ ok: false })
    expect((result as any).error).toContain('number')
  })

  it('rejects empty string', () => {
    const result = validatePassword('')
    expect(result).toMatchObject({ ok: false })
  })
})

// ─── Enum validators ────────────────────────────────────────────────────────

describe('isValidSiteStatus', () => {
  it('accepts active', () => expect(isValidSiteStatus('active')).toBe(true))
  it('accepts hidden', () => expect(isValidSiteStatus('hidden')).toBe(true))
  it('rejects arbitrary string', () => expect(isValidSiteStatus('deleted')).toBe(false))
})

describe('isValidOrderStatus', () => {
  it('accepts complete', () => expect(isValidOrderStatus('complete')).toBe(true))
  it('accepts accepted', () => expect(isValidOrderStatus('accepted')).toBe(true))
  it('rejects unknown status', () => expect(isValidOrderStatus('unknown')).toBe(false))
})

describe('isValidOrderPaymentType', () => {
  it('accepts paid', () => expect(isValidOrderPaymentType('paid')).toBe(true))
  it('accepts unpaid', () => expect(isValidOrderPaymentType('unpaid')).toBe(true))
  it('rejects free', () => expect(isValidOrderPaymentType('free')).toBe(false))
})

describe('isValidProductCategory', () => {
  it('accepts food', () => expect(isValidProductCategory('food')).toBe(true))
  it('accepts drink', () => expect(isValidProductCategory('drink')).toBe(true))
  it('rejects unknown', () => expect(isValidProductCategory('electronics')).toBe(false))
})

// ─── isValidPaymentProvider ─────────────────────────────────────────────────

describe('isValidPaymentProvider', () => {
  it('accepts mollie', () => expect(isValidPaymentProvider('mollie')).toBe(true))
  it('rejects stripe (consumer Stripe removed)', () => expect(isValidPaymentProvider('stripe')).toBe(false))
  it('rejects empty string', () => expect(isValidPaymentProvider('')).toBe(false))
  it('rejects arbitrary string', () => expect(isValidPaymentProvider('paypal')).toBe(false))
})

// ─── isValidRentalPaymentType ───────────────────────────────────────────────

describe('isValidRentalPaymentType', () => {
  it('accepts paid', () => expect(isValidRentalPaymentType('paid')).toBe(true))
  it('accepts unpaid', () => expect(isValidRentalPaymentType('unpaid')).toBe(true))
  it('rejects free', () => expect(isValidRentalPaymentType('free')).toBe(false))
  it('rejects empty string', () => expect(isValidRentalPaymentType('')).toBe(false))
  it('rejects arbitrary string', () => expect(isValidRentalPaymentType('cash')).toBe(false))
})

// ─── isValidItemStatus ──────────────────────────────────────────────────────

describe('isValidItemStatus', () => {
  it('accepts active', () => expect(isValidItemStatus('active')).toBe(true))
  it('accepts disabled', () => expect(isValidItemStatus('disabled')).toBe(true))
  it('accepts pool', () => expect(isValidItemStatus('pool')).toBe(true))
  it('rejects inactive (not in enum)', () => expect(isValidItemStatus('inactive')).toBe(false))
  it('rejects empty string', () => expect(isValidItemStatus('')).toBe(false))
  it('rejects arbitrary string', () => expect(isValidItemStatus('deleted')).toBe(false))
})

// ─── safeBlobKey ────────────────────────────────────────────────────────────

describe('safeBlobKey', () => {
  function fakeFile(type: string): File {
    return { type, size: 1024 } as File
  }

  it('uses a UUID so the key is path-traversal-safe regardless of filename', () => {
    const key = safeBlobKey('sites/site-1/products', fakeFile('image/jpeg'))
    // Must not contain any user-supplied characters — only uuid + ext
    expect(key).toMatch(/^sites\/site-1\/products\/[0-9a-f-]{36}\.jpg$/)
  })

  it('produces unique keys on successive calls (UUID randomness)', () => {
    const f = fakeFile('image/png')
    const k1 = safeBlobKey('sites/s1/photos', f)
    const k2 = safeBlobKey('sites/s1/photos', f)
    expect(k1).not.toBe(k2)
  })

  it('maps MIME types to correct extensions', () => {
    expect(safeBlobKey('p', fakeFile('image/jpeg'))).toMatch(/\.jpg$/)
    expect(safeBlobKey('p', fakeFile('image/png'))).toMatch(/\.png$/)
    expect(safeBlobKey('p', fakeFile('image/webp'))).toMatch(/\.webp$/)
    expect(safeBlobKey('p', fakeFile('image/gif'))).toMatch(/\.gif$/)
    expect(safeBlobKey('p', fakeFile('image/svg+xml'))).toMatch(/\.svg$/)
  })

  it('falls back to "bin" for unknown MIME type', () => {
    expect(safeBlobKey('p', fakeFile('application/octet-stream'))).toMatch(/\.bin$/)
  })

  it('does not allow path traversal via prefix (key structure = prefix/uuid.ext)', () => {
    // The prefix itself is always code-controlled; the UUID segment is never
    // user-input-derived — verify the UUID sits after the last slash
    const key = safeBlobKey('sites/site-1/cover', fakeFile('image/webp'))
    const parts = key.split('/')
    // last segment is uuid.ext — must not start with '..' or contain '..'
    const segment = parts[parts.length - 1]
    expect(segment).not.toContain('..')
    expect(segment).toMatch(/^[0-9a-f-]{36}\.webp$/)
  })
})
