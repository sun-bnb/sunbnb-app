import { describe, it, expect } from 'vitest'
import { diffBasis, isEmptyDiff, summarizeDiff, type Diff } from './types'

const change = (target: string, field: string, before: string | number | null, after: string | number | null) => ({ target, field, label: field, before, after })

describe('diffBasis', () => {
  it('ignores the order of changes (jsonb does not preserve payload key order)', () => {
    const a: Diff = { changes: [change('Brand', 'brandName', null, 'X'), change('Brand', 'tagline', null, 'Y')] }
    const b: Diff = { changes: [change('Brand', 'tagline', null, 'Y'), change('Brand', 'brandName', null, 'X')] }
    expect(diffBasis(a)).toBe(diffBasis(b))
  })

  it('differs when a BEFORE value differs (the data moved), a field is added, or a create/delete appears', () => {
    const base: Diff = { changes: [change('Site', 'price', 9, 10)] }
    expect(diffBasis({ changes: [change('Site', 'price', 11, 10)] })).not.toBe(diffBasis(base))
    expect(diffBasis({ changes: [...base.changes, change('Site', 'vat', 21, 10)] })).not.toBe(diffBasis(base))
    expect(diffBasis({ ...base, creates: [{ target: 'Product "A"', fields: {} }] })).not.toBe(diffBasis(base))
    expect(diffBasis({ ...base, deletes: [{ target: 'Product "A"', label: 'x' }] })).not.toBe(diffBasis(base))
  })

  it('does not depend on the AFTER value (it is derived from the payload) or warnings', () => {
    expect(diffBasis({ changes: [change('Site', 'price', 9, 10)], warnings: ['w'] })).toBe(diffBasis({ changes: [change('Site', 'price', 9, 99)] }))
  })
})

describe('isEmptyDiff / summarizeDiff', () => {
  it('empty only when no change, create or delete', () => {
    expect(isEmptyDiff({ changes: [] })).toBe(true)
    expect(isEmptyDiff({ changes: [], creates: [{ target: 'T', fields: {} }] })).toBe(false)
    expect(isEmptyDiff({ changes: [], deletes: [{ target: 'T', label: '' }] })).toBe(false)
  })

  it('one change reads as "Changed site price 9 → 9.5"; several fields list the labels; creates and removals are named', () => {
    expect(summarizeDiff({ changes: [change('Site', 'price', 9, 9.5)] })).toBe('Changed site price 9 → 9.5')
    expect(summarizeDiff({ changes: [change('Site', 'price', 9, 9.5), change('Site', 'vat', 21, 10)] })).toBe('Changed site: price, vat')
    expect(summarizeDiff({ changes: [], creates: [{ target: 'Product "A"', fields: {} }], deletes: [{ target: 'Product "B"', label: '' }] })).toBe('Added Product "A". Removed Product "B"')
    expect(summarizeDiff({ changes: [change('Site', 'name', 'Old name', null)] })).toBe('Changed site name "Old name" → empty')
  })

  it('stays short', () => {
    const long = 'x'.repeat(500)
    expect(summarizeDiff({ changes: [change('Site', 'description', long, long + 'y')] }).length).toBeLessThanOrEqual(300)
  })
})

describe('summarizeDiff with a handler-authored summary', () => {
  it('uses it verbatim instead of narrating raw before/after values (which for images are blob URLs)', () => {
    const d: Diff = {
      changes: [change('Cover photo', 'image', 'https://abc.public.blob.vercel-storage.com/old.jpg', 'photo "beach.jpg"')],
      summary: 'Set Cover photo to beach.jpg',
    }
    expect(summarizeDiff(d)).toBe('Set Cover photo to beach.jpg')
    expect(summarizeDiff({ ...d, summary: undefined })).toContain('https://')
  })
})
