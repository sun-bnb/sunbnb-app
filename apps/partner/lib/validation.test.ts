import { describe, it, expect } from 'vitest'
import {
  validateImageFile,
  safeBlobKey,
  validatePassword,
  isValidSiteStatus,
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
